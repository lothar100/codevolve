/**
 * Rule 4: Archive Evaluation → ArchiveQueue
 *
 * Evaluates active skills and problems against archive thresholds and enqueues
 * candidates for the Archive Handler Lambda to process.
 *
 * Gated to once per 23 hours via a timestamp stored in codevolve-config.
 * Supports dry-run mode: writes to codevolve-archive-dry-run instead of SQS.
 *
 * See docs/decision-engine.md §4.4 for full specification.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { KinesisClient, PutRecordCommand } from "@aws-sdk/client-kinesis";

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

const CONFIG_TABLE = process.env.CONFIG_TABLE ?? "codevolve-config";
const SKILLS_TABLE = process.env.SKILLS_TABLE ?? "codevolve-skills";
const PROBLEMS_TABLE = process.env.PROBLEMS_TABLE ?? "codevolve-problems";
const ARCHIVE_QUEUE_URL = process.env.ARCHIVE_QUEUE_URL ?? "";
const ARCHIVE_DRY_RUN_TABLE =
  process.env.ARCHIVE_DRY_RUN_TABLE ?? "codevolve-archive-dry-run";
const EVENTS_STREAM = process.env.EVENTS_STREAM ?? "codevolve-events";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const THREE_SIXTY_FIVE_DAYS_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_PER_CYCLE_DEFAULT = 50;
const HIGH_IMPACT_EXECUTION_THRESHOLD = 100;
const LOW_CONFIDENCE_THRESHOLD = 0.30;
const LOW_CONFIDENCE_MIN_EXECUTIONS = 5;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ArchiveReason =
  | "staleness_90d"
  | "staleness_365d"
  | `staleness_domain_${string}`
  | "low_confidence"
  | "high_failure_rate"
  | "zero_usage"
  | "problem_no_active_skills";

interface ArchiveCandidate {
  target_type: "skill" | "problem";
  target_id: string;
  reason: ArchiveReason;
  triggered_at: string;
  // Severity fields for sorting — not included in the SQS message
  failure_rate?: number;
  confidence?: number;
  staleness_ms?: number;
  execution_count?: number;
}

interface SkillRecord {
  skill_id: string;
  version_number: number;
  status: string;
  is_canonical?: boolean;
  evolve_in_progress?: boolean;
  created_at: string;
  unarchived_at?: string;
  last_executed_at?: string;
  confidence: number;
  execution_count: number;
  tags?: string[];
}

interface ProblemRecord {
  problem_id: string;
  last_resolve_at?: string;
}

interface ConfigRecord {
  last_archive_evaluation?: string;
  use_clickhouse?: boolean;
  dry_run?: boolean;
  staleness_days?: number;
  zero_usage_age_days?: number;
  max_per_cycle?: number;
}

// ---------------------------------------------------------------------------
// Gate check
// ---------------------------------------------------------------------------

async function readConfig(
  dynamoClient: DynamoDBDocumentClient,
): Promise<ConfigRecord> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: CONFIG_TABLE,
      Key: { pk: "archive_eval", sk: "last_run" },
    }),
  );
  return (result.Item as ConfigRecord | undefined) ?? {};
}

function isWithinLast23Hours(isoTimestamp: string): boolean {
  const then = new Date(isoTimestamp).getTime();
  const now = Date.now();
  return now - then < TWENTY_THREE_HOURS_MS;
}

// ---------------------------------------------------------------------------
// Exemption check
// ---------------------------------------------------------------------------

function isExempt(skill: SkillRecord, now: number): boolean {
  if (skill.status === "archived") return true;
  if (skill.is_canonical === true) return true;
  if (skill.evolve_in_progress === true) return true;

  const createdAt = new Date(skill.created_at).getTime();
  if (now - createdAt < THIRTY_DAYS_MS) return true;

  if (skill.unarchived_at != null) {
    const unarchivedAt = new Date(skill.unarchived_at).getTime();
    if (now - unarchivedAt < FOURTEEN_DAYS_MS) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Trigger evaluation
// ---------------------------------------------------------------------------

function evaluateStaleness(
  skill: SkillRecord,
  now: number,
): ArchiveReason | null {
  const referenceTime = skill.last_executed_at
    ? new Date(skill.last_executed_at).getTime()
    : new Date(skill.created_at).getTime();

  const isSeasonal = Array.isArray(skill.tags) && skill.tags.includes("seasonal");
  const threshold = isSeasonal ? THREE_SIXTY_FIVE_DAYS_MS : NINETY_DAYS_MS;
  const elapsed = now - referenceTime;

  if (elapsed > threshold) {
    return isSeasonal ? "staleness_365d" : "staleness_90d";
  }

  return null;
}

function evaluateLowConfidence(skill: SkillRecord): ArchiveReason | null {
  if (
    skill.confidence < LOW_CONFIDENCE_THRESHOLD &&
    skill.execution_count >= LOW_CONFIDENCE_MIN_EXECUTIONS
  ) {
    return "low_confidence";
  }
  return null;
}

function evaluateZeroUsage(skill: SkillRecord, now: number): ArchiveReason | null {
  if (skill.execution_count === 0) {
    const createdAt = new Date(skill.created_at).getTime();
    if (now - createdAt > SIXTY_DAYS_MS) {
      return "zero_usage";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidate severity sort
// ---------------------------------------------------------------------------

function sortBySeverity(candidates: ArchiveCandidate[]): ArchiveCandidate[] {
  return [...candidates].sort((a, b) => {
    // failure_rate DESC
    const aFr = a.failure_rate ?? 0;
    const bFr = b.failure_rate ?? 0;
    if (bFr !== aFr) return bFr - aFr;

    // confidence ASC
    const aConf = a.confidence ?? 1;
    const bConf = b.confidence ?? 1;
    if (aConf !== bConf) return aConf - bConf;

    // staleness DESC
    const aStaleness = a.staleness_ms ?? 0;
    const bStaleness = b.staleness_ms ?? 0;
    return bStaleness - aStaleness;
  });
}

// ---------------------------------------------------------------------------
// SQS + Kinesis emission
// ---------------------------------------------------------------------------

async function emitArchiveWarning(
  kinesisClient: KinesisClient,
  skill: SkillRecord,
  reason: ArchiveReason,
  triggeredAt: string,
): Promise<void> {
  try {
    const payload = {
      event_type: "archive_warning",
      skill_id: skill.skill_id,
      execution_count: skill.execution_count,
      trigger: reason,
      confidence: skill.confidence,
      triggered_at: triggeredAt,
    };
    await kinesisClient.send(
      new PutRecordCommand({
        StreamName: EVENTS_STREAM,
        PartitionKey: skill.skill_id,
        Data: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (err) {
    console.error("[archiveEvaluation] Failed to emit archive_warning (swallowed):", err);
  }
}

async function sendToArchiveQueue(
  sqsClient: SQSClient,
  candidate: ArchiveCandidate,
): Promise<void> {
  const message = {
    target_type: candidate.target_type,
    target_id: candidate.target_id,
    reason: candidate.reason,
    triggered_at: candidate.triggered_at,
  };
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: ARCHIVE_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }),
  );
}

async function writeToDryRunTable(
  dynamoClient: DynamoDBDocumentClient,
  candidate: ArchiveCandidate,
): Promise<void> {
  await dynamoClient.send(
    new PutCommand({
      TableName: ARCHIVE_DRY_RUN_TABLE,
      Item: {
        target_id: candidate.target_id,
        target_type: candidate.target_type,
        reason: candidate.reason,
        triggered_at: candidate.triggered_at,
        evaluated_at: new Date().toISOString(),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Skill scanning
// ---------------------------------------------------------------------------

async function scanActiveSkills(
  dynamoClient: DynamoDBDocumentClient,
): Promise<SkillRecord[]> {
  const skills: SkillRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: SKILLS_TABLE,
        FilterExpression: "#status <> :archived",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":archived": "archived" },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      }),
    );

    for (const item of result.Items ?? []) {
      skills.push(item as SkillRecord);
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey != null);

  return skills;
}

// ---------------------------------------------------------------------------
// Problem archive evaluation
// ---------------------------------------------------------------------------

async function evaluateProblems(
  dynamoClient: DynamoDBDocumentClient,
  now: number,
): Promise<ArchiveCandidate[]> {
  const candidates: ArchiveCandidate[] = [];
  const triggeredAt = new Date(now).toISOString();

  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: PROBLEMS_TABLE,
        FilterExpression: "attribute_not_exists(#status) OR #status <> :archived",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":archived": "archived" },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      }),
    );

    for (const item of (result.Items ?? []) as ProblemRecord[]) {
      // Check last_resolve_at: must be more than 90 days ago (or null)
      if (item.last_resolve_at != null) {
        const resolveTime = new Date(item.last_resolve_at).getTime();
        if (now - resolveTime <= NINETY_DAYS_MS) {
          continue;
        }
      }

      // Count active skills with confidence > 0.50 for this problem
      const skillsResult = await dynamoClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          IndexName: "GSI-problem-status",
          KeyConditionExpression: "problem_id = :pid",
          FilterExpression:
            "#status <> :archived AND confidence > :conf_threshold",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":pid": item.problem_id,
            ":archived": "archived",
            ":conf_threshold": 0.50,
          },
          Select: "COUNT",
        }),
      );

      const activeHighConfidenceCount = skillsResult.Count ?? 0;
      if (activeHighConfidenceCount === 0) {
        candidates.push({
          target_type: "problem",
          target_id: item.problem_id,
          reason: "problem_no_active_skills",
          triggered_at: triggeredAt,
        });
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey != null);

  return candidates;
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

export async function evaluateArchive(
  dynamoClient: DynamoDBDocumentClient,
  sqsClient: SQSClient,
  kinesisClient: KinesisClient,
): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. 24-hour gate
  // -------------------------------------------------------------------------
  const config = await readConfig(dynamoClient);

  if (
    config.last_archive_evaluation != null &&
    isWithinLast23Hours(config.last_archive_evaluation)
  ) {
    console.log("[archiveEvaluation] Skipping — last run was within 23 hours");
    return;
  }

  const isDryRun = config.dry_run === true;
  const useClickhouse = config.use_clickhouse === true;
  const maxPerCycle = config.max_per_cycle ?? MAX_PER_CYCLE_DEFAULT;
  const now = Date.now();
  const triggeredAt = new Date(now).toISOString();

  console.log(
    `[archiveEvaluation] Starting evaluation. dry_run=${isDryRun}, use_clickhouse=${useClickhouse}`,
  );

  // -------------------------------------------------------------------------
  // 2. Collect all active skills
  // -------------------------------------------------------------------------
  const allSkills = await scanActiveSkills(dynamoClient);

  // -------------------------------------------------------------------------
  // 3. Evaluate each skill against exemptions and triggers
  // -------------------------------------------------------------------------
  const skillCandidates: ArchiveCandidate[] = [];

  for (const skill of allSkills) {
    if (isExempt(skill, now)) {
      continue;
    }

    // Evaluate triggers in order — first match wins
    let reason: ArchiveReason | null = null;
    let staleness_ms: number | undefined;

    // Trigger 1: Staleness
    const stalenessReason = evaluateStaleness(skill, now);
    if (stalenessReason != null) {
      reason = stalenessReason;
      const referenceTime = skill.last_executed_at
        ? new Date(skill.last_executed_at).getTime()
        : new Date(skill.created_at).getTime();
      staleness_ms = now - referenceTime;
    }

    // Trigger 2: Low Confidence
    if (reason == null) {
      reason = evaluateLowConfidence(skill);
    }

    // Trigger 3: High Failure Rate — Phase 3 only, skip when use_clickhouse != true
    // (ClickHouse query not implemented in Phase 2; skipped per spec)
    if (reason == null && useClickhouse) {
      // Phase 3: ClickHouse Query D would be executed here.
      // Deferred to Phase 3 per IMPL-10-E spec.
    }

    // Trigger 4: Zero Usage
    if (reason == null) {
      reason = evaluateZeroUsage(skill, now);
    }

    if (reason != null) {
      skillCandidates.push({
        target_type: "skill",
        target_id: skill.skill_id,
        reason,
        triggered_at: triggeredAt,
        confidence: skill.confidence,
        staleness_ms,
        execution_count: skill.execution_count,
        // failure_rate is only available via ClickHouse (Phase 3)
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Evaluate problems
  // -------------------------------------------------------------------------
  const problemCandidates = await evaluateProblems(dynamoClient, now);

  // -------------------------------------------------------------------------
  // 5. Combine, sort by severity, apply per-cycle limit
  // -------------------------------------------------------------------------
  const allCandidates = sortBySeverity([...skillCandidates, ...problemCandidates]);
  const deferred = Math.max(0, allCandidates.length - maxPerCycle);
  const toProcess = allCandidates.slice(0, maxPerCycle);

  if (deferred > 0) {
    console.warn(
      `[archiveEvaluation] archive.candidates_deferred=${deferred} — per-cycle limit reached`,
    );
    // CloudWatch metric emission would happen here in production (via CloudWatch SDK).
    // Logged for now; Amber configures the CloudWatch alarm in DESIGN-04.
  }

  // -------------------------------------------------------------------------
  // 6. Enqueue candidates (or write to dry-run table)
  // -------------------------------------------------------------------------
  let processedCount = 0;

  for (const candidate of toProcess) {
    const isSkill = candidate.target_type === "skill";
    const executionCount = candidate.execution_count ?? 0;

    // Emit Kinesis archive_warning for high-impact skills before SQS send
    if (isSkill && executionCount > HIGH_IMPACT_EXECUTION_THRESHOLD) {
      const skill = allSkills.find((s) => s.skill_id === candidate.target_id);
      if (skill != null) {
        await emitArchiveWarning(kinesisClient, skill, candidate.reason, triggeredAt);
      }
    }

    if (isDryRun) {
      await writeToDryRunTable(dynamoClient, candidate);
    } else {
      await sendToArchiveQueue(sqsClient, candidate);
    }

    processedCount++;
  }

  console.log(
    `[archiveEvaluation] Done. processed=${processedCount}, deferred=${deferred}, dry_run=${isDryRun}`,
  );

  // -------------------------------------------------------------------------
  // 7. Update last_archive_evaluation timestamp (only after full run completes)
  // -------------------------------------------------------------------------
  await dynamoClient.send(
    new UpdateCommand({
      TableName: CONFIG_TABLE,
      Key: { pk: "archive_eval", sk: "last_run" },
      UpdateExpression: "SET last_archive_evaluation = :now",
      ExpressionAttributeValues: { ":now": new Date(now).toISOString() },
    }),
  );

  console.log("[archiveEvaluation] last_archive_evaluation updated");
}
