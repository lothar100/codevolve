/**
 * Decision Engine — Rule 1: Auto-Cache Trigger
 *
 * Queries codevolve-skills for skills with execution_count >= 50 and
 * auto_cache not already set to true, then marks each qualifying skill
 * with auto_cache = true so that the /execute handler starts caching results.
 *
 * Phase 2 behavior: execution_count threshold only (input_repeat_rate check
 * is deferred to Phase 3 when ClickHouse is live).
 *
 * All writes use a ConditionExpression to make this rule fully idempotent.
 * ConditionalCheckFailedException is caught silently.
 */

import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const SKILLS_TABLE = process.env.SKILLS_TABLE ?? "codevolve-skills";

// GSI-status-updated has status as its partition key. We cannot use IN (...) on
// a key condition, so we issue one Query per eligible status value.
const ELIGIBLE_STATUSES = ["partial", "verified", "optimized"] as const;

const EXECUTION_COUNT_THRESHOLD = 50;

interface SkillRecord {
  skill_id: string;
  version_number: number;
  execution_count?: number;
  auto_cache?: boolean;
}

/**
 * Query all skills for a given status that have execution_count >= threshold
 * and auto_cache not set to true. Uses GSI-status-updated.
 */
async function queryEligibleSkillsByStatus(
  dynamoClient: DynamoDBDocumentClient,
  status: string,
): Promise<SkillRecord[]> {
  const results: SkillRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        IndexName: "GSI-status-updated",
        KeyConditionExpression: "#status = :status",
        FilterExpression:
          "execution_count >= :threshold AND (attribute_not_exists(auto_cache) OR auto_cache = :false)",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": status,
          ":threshold": EXECUTION_COUNT_THRESHOLD,
          ":false": false,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const items = (response.Items ?? []) as SkillRecord[];
    results.push(...items);
    lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey !== undefined);

  return results;
}

/**
 * Write auto_cache = true on a single skill record. The ConditionExpression
 * makes this safe to run multiple times — if another invocation already set
 * auto_cache = true, the condition fails and is caught silently.
 */
async function setAutoCache(
  dynamoClient: DynamoDBDocumentClient,
  skillId: string,
  versionNumber: number,
): Promise<void> {
  const now = new Date().toISOString();

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
          ":now": now,
        },
      }),
    );
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ConditionalCheckFailedException"
    ) {
      // Another invocation already set auto_cache = true — this is fine.
      return;
    }
    throw err;
  }
}

/**
 * Evaluate Rule 1: Auto-Cache Trigger.
 *
 * Queries codevolve-skills via GSI-status-updated for all eligible statuses,
 * then issues an UpdateItem for each matching skill.
 */
export async function evaluateAutoCache(dynamoClient: DynamoDBDocumentClient): Promise<void> {
  // Collect all qualifying skills across all eligible statuses.
  const allSkills: SkillRecord[] = [];

  for (const status of ELIGIBLE_STATUSES) {
    const skills = await queryEligibleSkillsByStatus(dynamoClient, status);
    allSkills.push(...skills);
  }

  // Update each qualifying skill. Failures from ConditionalCheckFailedException
  // are handled inside setAutoCache and do not interrupt other updates.
  for (const skill of allSkills) {
    await setAutoCache(dynamoClient, skill.skill_id, skill.version_number);
  }
}
