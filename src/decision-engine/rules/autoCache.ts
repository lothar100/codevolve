import { QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const SKILLS_TABLE = process.env.SKILLS_TABLE ?? "codevolve-skills";
const ANALYTICS_BUCKETS_TABLE =
  process.env.ANALYTICS_BUCKETS_TABLE ?? "codevolve-analytics-buckets";

const ELIGIBLE_STATUSES = ["partial", "verified", "optimized"] as const;
const EXECUTION_COUNT_THRESHOLD = 50;
const INTENT_REPEAT_RATE_THRESHOLD = 0.3;
const INTENT_LOOKBACK_DAYS = 30;

interface SkillRecord {
  skill_id: string;
  version_number: number;
}

interface Candidate {
  skill_id: string;
  total_intents: number;
  repeated_intents: number;
  intent_repeat_rate: number;
}

function analyticsUnavailable(err: unknown) {
  if (err == null || typeof err !== "object") return false;
  const name = "name" in err && typeof err.name === "string" ? err.name : "";
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  return name === "ResourceNotFoundException" || name === "AccessDeniedException" || /table.*not found|analytics.*unavailable/i.test(message);
}

async function queryEligibleSkillsByStatus(
  dynamoClient: DynamoDBDocumentClient,
  status: string,
  requireExecutionThreshold: boolean,
): Promise<SkillRecord[]> {
  const results: SkillRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  const expressionAttributeValues: Record<string, unknown> = { ":status": status, ":false": false };
  if (requireExecutionThreshold) expressionAttributeValues[":threshold"] = EXECUTION_COUNT_THRESHOLD;
  do {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        IndexName: "GSI-status-updated",
        KeyConditionExpression: "#status = :status",
        FilterExpression: requireExecutionThreshold
          ? "execution_count >= :threshold AND (attribute_not_exists(auto_cache) OR auto_cache = :false)"
          : "(attribute_not_exists(auto_cache) OR auto_cache = :false)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: expressionAttributeValues,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    results.push(...((response.Items ?? []) as SkillRecord[]));
    lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey !== undefined);
  return results;
}

async function loadEligibleSkills(dynamoClient: DynamoDBDocumentClient, requireExecutionThreshold: boolean) {
  const skills: SkillRecord[] = [];
  for (const status of ELIGIBLE_STATUSES) {
    skills.push(...(await queryEligibleSkillsByStatus(dynamoClient, status, requireExecutionThreshold)));
  }
  return skills;
}

async function repetitionCandidates(dynamoClient: DynamoDBDocumentClient): Promise<Candidate[]> {
  const rows: Array<Record<string, unknown>> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  const cutoff = Date.now() - INTENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  do {
    const response = await dynamoClient.send(
      new ScanCommand({
        TableName: ANALYTICS_BUCKETS_TABLE,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    rows.push(...((response.Items ?? []) as Array<Record<string, unknown>>));
    lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey !== undefined);

  const map = new Map<string, { total: number; repeated: number }>();
  for (const row of rows) {
    if (row.granularity !== "day" || row.event_type !== "resolve" || row.scope_type !== "skill") continue;
    const bucketStart = typeof row.bucket_start === "string" ? row.bucket_start : "";
    if (bucketStart && Date.parse(bucketStart) < cutoff) continue;
    const skill_id = typeof row.scope_id === "string" ? row.scope_id : "";
    if (!skill_id) continue;
    const current = map.get(skill_id) ?? { total: 0, repeated: 0 };
    current.total += typeof row.total_count === "number" ? row.total_count : Number(row.total_count ?? 0);
    current.repeated +=
      typeof row.repeated_input_count === "number"
        ? row.repeated_input_count
        : Number(row.repeated_input_count ?? 0);
    map.set(skill_id, current);
  }

  return [...map.entries()]
    .map(([skill_id, summary]) => ({
      skill_id,
      total_intents: summary.total,
      repeated_intents: summary.repeated,
      intent_repeat_rate: summary.total > 0 ? summary.repeated / summary.total : 0,
    }))
    .filter(
      (candidate) =>
        candidate.total_intents >= EXECUTION_COUNT_THRESHOLD &&
        candidate.intent_repeat_rate >= INTENT_REPEAT_RATE_THRESHOLD,
    )
    .sort(
      (left, right) =>
        right.total_intents * right.intent_repeat_rate -
        left.total_intents * left.intent_repeat_rate,
    );
}

async function setAutoCache(dynamoClient: DynamoDBDocumentClient, skillId: string, versionNumber: number) {
  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: { skill_id: skillId, version_number: versionNumber },
        UpdateExpression: "SET auto_cache = :true, auto_cache_set_at = :now",
        ConditionExpression: "attribute_not_exists(auto_cache) OR auto_cache = :false",
        ExpressionAttributeValues: {
          ":true": true,
          ":false": false,
          ":now": new Date().toISOString(),
        },
      }),
    );
  } catch (err: unknown) {
    if (err && typeof err === "object" && "name" in err && err.name === "ConditionalCheckFailedException") return;
    throw err;
  }
}

export async function evaluateAutoCache(dynamoClient: DynamoDBDocumentClient): Promise<void> {
  let candidates: Set<string>;
  let skills: SkillRecord[];
  try {
    candidates = new Set((await repetitionCandidates(dynamoClient)).map((candidate) => candidate.skill_id));
    skills = (await loadEligibleSkills(dynamoClient, false)).filter((skill) => candidates.has(skill.skill_id));
  } catch (err) {
    if (!analyticsUnavailable(err)) throw err;
    console.warn("[autoCache] Falling back to execution_count threshold:", err);
    skills = await loadEligibleSkills(dynamoClient, true);
  }

  for (const skill of skills) {
    await setAutoCache(dynamoClient, skill.skill_id, skill.version_number);
  }
}
