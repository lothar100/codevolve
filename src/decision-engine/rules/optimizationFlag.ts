/**
 * Rule 2: Optimization Flag
 *
 * Identifies high-traffic skills with poor p95 latency and marks them for
 * review by the /evolve pipeline or a human operator.
 *
 * Trigger condition:
 *   latency_p95_ms > 5000  AND  execution_count >= 20  AND  needs_optimization <> true
 *   status IN ('verified', 'optimized')
 *
 * Action: UpdateItem SET needs_optimization = true, optimization_flagged_at = <now>
 *
 * Idempotent: ConditionalCheckFailedException is caught silently.
 *
 * Data source (Phase 2): codevolve-skills DynamoDB records (denormalized latency EMA).
 * Data source (Phase 3): ClickHouse Query B (true p95 over 7-day window).
 */

import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILLS_TABLE = process.env.SKILLS_TABLE ?? "codevolve-skills";
const GSI_STATUS_UPDATED = "GSI-status-updated";

const LATENCY_THRESHOLD_MS = 5000;
const MIN_EXECUTION_COUNT = 20;

const ELIGIBLE_STATUSES = new Set(["verified", "optimized"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillRecord {
  skill_id: string;
  version_number: number;
  status: string;
  latency_p95_ms?: number;
  execution_count?: number;
  needs_optimization?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Evaluate Rule 2 (Optimization Flag) against the codevolve-skills table.
 *
 * Queries GSI-status-updated for skills with status 'verified' or 'optimized',
 * filters for those exceeding the latency and execution count thresholds,
 * and writes needs_optimization = true for each matching skill.
 *
 * @param dynamoClient - DynamoDBDocumentClient instance (injectable for testing)
 */
export async function evaluateOptimizationFlag(
  dynamoClient: DynamoDBDocumentClient,
): Promise<void> {
  const candidates = await scanEligibleSkills(dynamoClient);

  if (candidates.length === 0) {
    console.log("[optimizationFlag] No candidates to flag.");
    return;
  }

  console.log(
    `[optimizationFlag] Flagging ${candidates.length} skill(s) for optimization.`,
  );

  await Promise.all(
    candidates.map((skill) => flagSkill(dynamoClient, skill)),
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Query GSI-status-updated for skills that need optimization flagging.
 *
 * One QueryCommand per eligible status (DynamoDB GSI partition key requires
 * equality condition — cannot use IN). FilterExpression reduces returned
 * items to only those exceeding the latency and execution count thresholds.
 */
async function scanEligibleSkills(
  dynamoClient: DynamoDBDocumentClient,
): Promise<SkillRecord[]> {
  const allCandidates: SkillRecord[] = [];

  for (const status of ELIGIBLE_STATUSES) {
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

    do {
      const response = await dynamoClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          IndexName: GSI_STATUS_UPDATED,
          KeyConditionExpression: "#status = :status",
          FilterExpression:
            "latency_p95_ms > :latencyThreshold" +
            " AND execution_count >= :minExecutions" +
            " AND (attribute_not_exists(needs_optimization) OR needs_optimization = :false)",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":status": status,
            ":latencyThreshold": LATENCY_THRESHOLD_MS,
            ":minExecutions": MIN_EXECUTION_COUNT,
            ":false": false,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      if (response.Items && response.Items.length > 0) {
        allCandidates.push(...(response.Items as SkillRecord[]));
      }

      lastEvaluatedKey = response.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey !== undefined);
  }

  return allCandidates;
}

/**
 * Write needs_optimization = true to a single skill record.
 * Uses a ConditionExpression to guard against redundant writes
 * (idempotent: ConditionalCheckFailedException is caught silently).
 */
async function flagSkill(
  dynamoClient: DynamoDBDocumentClient,
  skill: SkillRecord,
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: {
          skill_id: skill.skill_id,
          version_number: skill.version_number,
        },
        UpdateExpression:
          "SET needs_optimization = :true, optimization_flagged_at = :now",
        ConditionExpression:
          "attribute_not_exists(needs_optimization) OR needs_optimization = :false",
        ExpressionAttributeValues: {
          ":true": true,
          ":false": false,
          ":now": now,
        },
      }),
    );

    console.log(
      `[optimizationFlag] Flagged skill ${skill.skill_id} v${skill.version_number}` +
        ` (latency_p95_ms=${skill.latency_p95_ms}, execution_count=${skill.execution_count})`,
    );
  } catch (err: unknown) {
    if (isConditionalCheckFailedException(err)) {
      // Already flagged by a concurrent invocation — safe to ignore.
      console.log(
        `[optimizationFlag] Skill ${skill.skill_id} already flagged (ConditionalCheckFailed — skipped).`,
      );
      return;
    }
    throw err;
  }
}

/**
 * Type-safe check for ConditionalCheckFailedException.
 */
function isConditionalCheckFailedException(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: string }).name === "ConditionalCheckFailedException"
  );
}
