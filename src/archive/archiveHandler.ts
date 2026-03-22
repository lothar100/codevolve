/**
 * SQS-triggered Lambda handler for processing archive messages from the Decision Engine.
 *
 * Reads a batch of messages from codevolve-archive-queue and performs the archive
 * operation for each skill. Idempotent: ConditionExpression prevents double-processing.
 * Partial failure handling: returns batchItemFailures for messages that need retry.
 */

import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, SKILLS_TABLE, PROBLEMS_TABLE } from "../shared/dynamo.js";
import { emitEvent } from "../shared/emitEvent.js";
import {
  invalidateCacheForSkill,
  archiveProblemIfAllSkillsArchived,
  writeArchiveAuditRecord,
} from "./archiveUtils.js";

// ---------------------------------------------------------------------------
// SQS message shape (from Decision Engine)
// ---------------------------------------------------------------------------

interface ArchiveMessage {
  action: "archive";
  skill_id: string;
  problem_id: string;
  reason: string;
  triggered_by: string;
  evaluation_timestamp: string;
  metrics_snapshot?: Record<string, unknown>;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const message: ArchiveMessage = JSON.parse(record.body);
      await processArchiveMessage(message);
    } catch (err) {
      console.error(
        `Failed to process message ${record.messageId}:`,
        err,
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

async function processArchiveMessage(message: ArchiveMessage): Promise<void> {
  const { skill_id: skillId, problem_id: problemId, reason, triggered_by: triggeredBy } = message;
  const now = new Date().toISOString();

  console.log(`Processing archive for skill ${skillId}, reason: ${reason}`);

  // -------------------------------------------------------------------------
  // 1. Get latest version of the skill
  // -------------------------------------------------------------------------
  const queryResult = await docClient.send(
    new QueryCommand({
      TableName: SKILLS_TABLE,
      KeyConditionExpression: "skill_id = :sid",
      ExpressionAttributeValues: { ":sid": skillId },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );

  const skill = queryResult.Items?.[0];
  if (!skill) {
    console.warn(`Skill ${skillId} not found, skipping archive`);
    return; // No-op, don't retry
  }

  // Already archived — idempotent no-op
  if (skill.status === "archived") {
    console.log(`Skill ${skillId} is already archived, skipping`);
    return;
  }

  // Canonical skill — block archival
  if (skill.is_canonical === true) {
    console.warn(`Skill ${skillId} is canonical, emitting archive_blocked event`);
    // Use "fail" event_type for blocked archive — this is a genuine failure/rejection,
    // not a successful archive operation.
    await emitEvent({
      event_type: "fail",
      skill_id: skillId,
      intent: "archive_blocked:canonical_skill",
      latency_ms: 0,
      confidence: null,
      cache_hit: false,
      input_hash: null,
      success: false,
    });
    return; // Don't retry — canonical status must be changed first
  }

  const previousStatus = skill.status as string;
  const versionNumber = skill.version_number as number;

  // -------------------------------------------------------------------------
  // 2. Update skill status to archived + nullify embedding (single update)
  // -------------------------------------------------------------------------
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: { skill_id: skillId, version_number: versionNumber },
        UpdateExpression:
          "SET #status = :archived, #archived_at = :now, #archive_reason = :reason, " +
          "#previous_status = :prev_status, #updated_at = :now, #embedding = :null_val",
        ConditionExpression:
          "#status <> :archived AND attribute_not_exists(#active_execution_lock)",
        ExpressionAttributeNames: {
          "#status": "status",
          "#archived_at": "archived_at",
          "#archive_reason": "archive_reason",
          "#previous_status": "previous_status",
          "#updated_at": "updated_at",
          "#embedding": "embedding",
          "#active_execution_lock": "active_execution_lock",
        },
        ExpressionAttributeValues: {
          ":archived": "archived",
          ":now": now,
          ":reason": reason,
          ":prev_status": previousStatus,
          ":null_val": null,
        },
      }),
    );
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ConditionalCheckFailedException"
    ) {
      // ConditionExpression failed — either already archived (idempotent no-op)
      // or active_execution_lock was set between our read and write attempt.
      // Re-query the skill to determine the correct action.
      const recheck = await docClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          KeyConditionExpression: "skill_id = :sid",
          ExpressionAttributeValues: { ":sid": skillId },
          ScanIndexForward: false,
          Limit: 1,
          ProjectionExpression: "#s, active_execution_lock",
          ExpressionAttributeNames: { "#s": "status" },
        }),
      );
      const current = recheck.Items?.[0];
      if (current?.status === "archived") {
        console.log(`Skill ${skillId} is now archived (concurrent archival), skipping`);
        return; // Idempotent no-op
      }
      // Not yet archived — likely blocked by active_execution_lock. Re-throw to trigger SQS retry.
      console.log(`Skill ${skillId} condition check failed (active execution lock or race), will retry`);
      throw err;
    }
    throw err;
  }

  // DynamoDB update succeeded — remaining operations should not prevent message acknowledgment
  // EXCEPT cache invalidation failure, which should trigger a retry (the DynamoDB update
  // will be a no-op on retry due to ConditionExpression)

  // -------------------------------------------------------------------------
  // 3. Invalidate cache entries
  // -------------------------------------------------------------------------
  await invalidateCacheForSkill(skillId);

  // -------------------------------------------------------------------------
  // 4. Decrement skill_count on Problems table (floor guard: only when > 0)
  // -------------------------------------------------------------------------
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: PROBLEMS_TABLE,
        Key: { problem_id: problemId },
        UpdateExpression:
          "SET #skill_count = #skill_count - :one, #updated_at = :now",
        ConditionExpression: "#skill_count > :zero",
        ExpressionAttributeNames: {
          "#skill_count": "skill_count",
          "#updated_at": "updated_at",
        },
        ExpressionAttributeValues: {
          ":one": 1,
          ":zero": 0,
          ":now": now,
        },
      }),
    );
  } catch (err: unknown) {
    // ConditionalCheckFailedException means skill_count is already 0 — safe to ignore.
    // Any other error is logged but does not fail the message acknowledgment (the skill
    // status update already succeeded; skill_count is informational).
    if (
      !(
        err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name: string }).name === "ConditionalCheckFailedException"
      )
    ) {
      console.error(`Failed to decrement skill_count for problem ${problemId}:`, err);
      // Don't fail the whole message for this — audit record and event are more important
    }
  }

  // -------------------------------------------------------------------------
  // 5. Write audit record
  // -------------------------------------------------------------------------
  await writeArchiveAuditRecord({
    entityId: skillId,
    entityType: "skill",
    action: "archive",
    reason: `decision_engine:${reason}`,
    triggeredBy: triggeredBy ?? "decision_engine",
    previousStatus,
    skillVersion: versionNumber,
    metadata: message.metrics_snapshot,
  });

  // -------------------------------------------------------------------------
  // 6. Emit Kinesis archive event (fire-and-forget)
  // -------------------------------------------------------------------------
  await emitEvent({
    event_type: "archive",
    skill_id: skillId,
    intent: `archive:${reason}`,
    latency_ms: 0,
    confidence: null,
    cache_hit: false,
    input_hash: null,
    success: true,
  });

  // -------------------------------------------------------------------------
  // 7. Check if all skills for parent problem are now archived
  // -------------------------------------------------------------------------
  await archiveProblemIfAllSkillsArchived(problemId);

  console.log(`Successfully archived skill ${skillId} (reason: ${reason})`);
}
