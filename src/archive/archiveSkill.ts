/**
 * API Gateway handler for POST /skills/:id/archive
 *
 * Soft-archives a skill: updates status, nullifies embedding, invalidates cache,
 * decrements problem skill_count, writes audit record, emits Kinesis event,
 * and auto-archives the parent problem if all skills are now archived.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, SKILLS_TABLE, PROBLEMS_TABLE } from "../shared/dynamo.js";
import { success, error } from "../shared/response.js";
import { validate } from "../shared/validation.js";
import { emitEvent } from "../shared/emitEvent.js";
import {
  invalidateCacheForSkill,
  archiveProblemIfAllSkillsArchived,
  writeArchiveAuditRecord,
} from "./archiveUtils.js";
import { invalidateCloudFrontPaths } from "../shared/cloudfrontInvalidation.js";

const PathParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  // -------------------------------------------------------------------------
  // 1. Validate path parameter
  // -------------------------------------------------------------------------
  const pathValidation = validate(PathParamsSchema, event.pathParameters ?? {});
  if (!pathValidation.success) {
    return error(400, "VALIDATION_ERROR", "Invalid skill ID", pathValidation.error.details);
  }
  const skillId = pathValidation.data.id;

  // -------------------------------------------------------------------------
  // 2. Get latest version of the skill
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
    return error(404, "NOT_FOUND", `Skill ${skillId} not found`);
  }

  // -------------------------------------------------------------------------
  // 3. Guards
  // -------------------------------------------------------------------------

  // Already archived
  if (skill.status === "archived") {
    return error(409, "CONFLICT", "Skill is already archived");
  }

  // Canonical skill — must demote first
  if (skill.is_canonical === true) {
    return error(
      422,
      "PRECONDITION_FAILED",
      "Cannot archive a canonical skill. Demote it first via POST /skills/:id/demote-canonical",
    );
  }

  // Active execution lock
  if (skill.active_execution_lock) {
    return error(
      409,
      "CONFLICT",
      "Skill has an active execution in progress. Try again later.",
    );
  }

  const now = new Date().toISOString();
  const previousStatus = skill.status as string;
  const versionNumber = skill.version_number as number;

  // -------------------------------------------------------------------------
  // 4. Update skill: set status to archived, store previous_status, set archived_at
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
          ":reason": "manual",
          ":prev_status": previousStatus,
          ":null_val": null,
        },
        ReturnValues: "ALL_NEW",
      }),
    );
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ConditionalCheckFailedException"
    ) {
      return error(409, "CONFLICT", "Skill is already archived or has an active execution lock");
    }
    throw err;
  }

  // -------------------------------------------------------------------------
  // 5. Invalidate cache entries (fire-and-forget is acceptable for API response,
  //    but we await here for correctness)
  // -------------------------------------------------------------------------
  await invalidateCacheForSkill(skillId);

  // Invalidate CloudFront edge cache — archived skill must not appear in cached responses.
  // Fire-and-forget: never throws, failure logged internally.
  void invalidateCloudFrontPaths([
    `/skills/${skillId}`,
    `/skills*`,
    `/problems/${skill.problem_id as string}`,
    `/problems*`,
  ]);

  // -------------------------------------------------------------------------
  // 6. Decrement skill_count on Problems table (floor guard: only when > 0)
  // -------------------------------------------------------------------------
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: PROBLEMS_TABLE,
        Key: { problem_id: skill.problem_id as string },
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
    if (
      !(
        err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name: string }).name === "ConditionalCheckFailedException"
      )
    ) {
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // 7. Write audit record
  // -------------------------------------------------------------------------
  await writeArchiveAuditRecord({
    entityId: skillId,
    entityType: "skill",
    action: "archive",
    reason: "manual",
    triggeredBy: "api_manual",
    previousStatus,
    skillVersion: versionNumber,
  });

  // -------------------------------------------------------------------------
  // 8. Emit Kinesis archive event (fire-and-forget)
  // -------------------------------------------------------------------------
  await emitEvent({
    event_type: "archive",
    skill_id: skillId,
    intent: "archive:manual",
    latency_ms: 0,
    confidence: null,
    cache_hit: false,
    input_hash: null,
    success: true,
  });

  // -------------------------------------------------------------------------
  // 9. Check if all skills for parent problem are now archived
  // -------------------------------------------------------------------------
  await archiveProblemIfAllSkillsArchived(skill.problem_id as string);

  // -------------------------------------------------------------------------
  // 10. Return updated skill
  // -------------------------------------------------------------------------
  const updatedSkill = {
    skill_id: skillId,
    problem_id: skill.problem_id,
    name: skill.name,
    description: skill.description,
    version: versionNumber,
    version_label: skill.version_label,
    is_canonical: skill.is_canonical,
    status: "archived",
    language: skill.language,
    domain: skill.domain,
    tags: skill.tags,
    inputs: skill.inputs,
    outputs: skill.outputs,
    examples: skill.examples,
    tests: skill.tests,
    implementation: skill.implementation,
    confidence: skill.confidence,
    latency_p50_ms: skill.latency_p50_ms ?? null,
    latency_p95_ms: skill.latency_p95_ms ?? null,
    created_at: skill.created_at,
    updated_at: now,
  };

  return success(200, { skill: updatedSkill });
}
