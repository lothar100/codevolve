/**
 * Shared archive utilities used by both API Gateway handlers and the SQS handler.
 *
 * Implements: cache invalidation, problem auto-archive check, audit record writing,
 * and Bedrock embedding generation.
 */

import {
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  docClient,
  SKILLS_TABLE,
  CACHE_TABLE,
  ARCHIVE_TABLE,
  PROBLEMS_TABLE,
} from "../shared/dynamo.js";
import { emitEvent } from "../shared/emitEvent.js";

// ---------------------------------------------------------------------------
// Bedrock client
// ---------------------------------------------------------------------------

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

const BEDROCK_MODEL_ID = "amazon.titan-embed-text-v2:0";

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/**
 * Query all cache entries for a skill and batch-delete them.
 * Idempotent: deleting non-existent keys is a no-op.
 */
export async function invalidateCacheForSkill(skillId: string): Promise<number> {
  let deletedCount = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: CACHE_TABLE,
        KeyConditionExpression: "skill_id = :sid",
        ExpressionAttributeValues: { ":sid": skillId },
        ProjectionExpression: "skill_id, input_hash",
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = queryResult.Items ?? [];
    if (items.length === 0) break;

    // BatchWriteItem supports max 25 items per call
    const batches: Array<Array<Record<string, unknown>>> = [];
    for (let i = 0; i < items.length; i += 25) {
      batches.push(items.slice(i, i + 25));
    }

    for (const batch of batches) {
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [CACHE_TABLE]: batch.map((item) => ({
              DeleteRequest: {
                Key: {
                  skill_id: item.skill_id,
                  input_hash: item.input_hash,
                },
              },
            })),
          },
        }),
      );
      deletedCount += batch.length;
    }

    exclusiveStartKey = queryResult.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return deletedCount;
}

// ---------------------------------------------------------------------------
// Problem auto-archive check
// ---------------------------------------------------------------------------

/**
 * Check if ALL skills for a problem are archived. If so, archive the problem.
 * Returns true if the problem was archived.
 */
export async function archiveProblemIfAllSkillsArchived(
  problemId: string,
): Promise<boolean> {
  // Query all skills for this problem using GSI-problem-status
  const result = await docClient.send(
    new QueryCommand({
      TableName: SKILLS_TABLE,
      IndexName: "GSI-problem-status",
      KeyConditionExpression: "problem_id = :pid",
      ExpressionAttributeValues: { ":pid": problemId },
      ProjectionExpression: "#s",
      ExpressionAttributeNames: { "#s": "status" },
    }),
  );

  const skills = result.Items ?? [];
  if (skills.length === 0) return false;

  const allArchived = skills.every((s) => s.status === "archived");
  if (!allArchived) return false;

  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: PROBLEMS_TABLE,
        Key: { problem_id: problemId },
        UpdateExpression: "SET #status = :archived, #archived_at = :now, #updated_at = :now",
        ConditionExpression: "#status <> :archived",
        ExpressionAttributeNames: {
          "#status": "status",
          "#archived_at": "archived_at",
          "#updated_at": "updated_at",
        },
        ExpressionAttributeValues: {
          ":archived": "archived",
          ":now": now,
        },
      }),
    );

    // Write audit record for problem
    await writeArchiveAuditRecord({
      entityId: problemId,
      entityType: "problem",
      action: "archive",
      reason: "all_skills_archived",
      triggeredBy: "system",
      previousStatus: "active",
    });

    // Emit Kinesis event for problem archival
    await emitEvent({
      event_type: "archive",
      skill_id: null,
      intent: `problem_archived:${problemId}`,
      latency_ms: 0,
      confidence: null,
      cache_hit: false,
      input_hash: null,
      success: true,
    });

    return true;
  } catch (err: unknown) {
    // ConditionalCheckFailedException means already archived — idempotent
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ConditionalCheckFailedException"
    ) {
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

export interface AuditRecordParams {
  entityId: string;
  entityType: "skill" | "problem";
  action: "archive" | "unarchive";
  reason: string;
  triggeredBy: string;
  previousStatus: string;
  skillVersion?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Write an audit record to the codevolve-archive table.
 */
export async function writeArchiveAuditRecord(
  params: AuditRecordParams,
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: ARCHIVE_TABLE,
      Item: {
        entity_id: params.entityId,
        action_timestamp: now,
        entity_type: params.entityType,
        action: params.action,
        reason: params.reason,
        triggered_by: params.triggeredBy,
        previous_status: params.previousStatus,
        ...(params.skillVersion !== undefined
          ? { skill_version: String(params.skillVersion) }
          : {}),
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Embedding generation
// ---------------------------------------------------------------------------

/**
 * Generate an embedding vector using Bedrock Titan Text Embeddings V2.
 * Returns a number array (1024 dimensions).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text,
      }),
    }),
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.embedding as number[];
}

// ---------------------------------------------------------------------------
// Problem unarchive helper
// ---------------------------------------------------------------------------

/**
 * Unarchive a problem if it is currently archived.
 * Used when a skill is unarchived — if the parent problem was archived, restore it.
 */
export async function unarchiveProblemIfArchived(
  problemId: string,
): Promise<boolean> {
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: PROBLEMS_TABLE,
        Key: { problem_id: problemId },
        UpdateExpression:
          "SET #status = :active, #updated_at = :now REMOVE #archived_at",
        ConditionExpression: "#status = :archived",
        ExpressionAttributeNames: {
          "#status": "status",
          "#archived_at": "archived_at",
          "#updated_at": "updated_at",
        },
        ExpressionAttributeValues: {
          ":active": "active",
          ":archived": "archived",
          ":now": now,
        },
      }),
    );

    // Write audit record for problem unarchive
    await writeArchiveAuditRecord({
      entityId: problemId,
      entityType: "problem",
      action: "unarchive",
      reason: "skill_unarchived",
      triggeredBy: "system",
      previousStatus: "archived",
    });

    return true;
  } catch (err: unknown) {
    // ConditionalCheckFailedException means not archived — no-op
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ConditionalCheckFailedException"
    ) {
      return false;
    }
    throw err;
  }
}

export { bedrockClient };
