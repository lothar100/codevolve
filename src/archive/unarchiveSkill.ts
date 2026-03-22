/**
 * API Gateway handler for POST /skills/:id/unarchive
 *
 * Reverses archival: restores previous status, regenerates embedding,
 * increments problem skill_count, writes audit record, emits Kinesis event,
 * and auto-unarchives the parent problem if it was archived.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, SKILLS_TABLE, PROBLEMS_TABLE } from "../shared/dynamo.js";
import { success, error } from "../shared/response.js";
import { validate } from "../shared/validation.js";
import { emitEvent } from "../shared/emitEvent.js";
import {
  generateEmbedding,
  writeArchiveAuditRecord,
  unarchiveProblemIfArchived,
} from "./archiveUtils.js";

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
  // 3. Guard: must be archived
  // -------------------------------------------------------------------------
  if (skill.status !== "archived") {
    return error(409, "CONFLICT", "Skill is not archived");
  }

  const now = new Date().toISOString();
  // Fall back to "verified" when previous_status is absent. Skills that were
  // in active circulation (and thus eligible to be archived) must have had at
  // least a "verified" status — "unsolved" and "partial" skills are not expected
  // to be in the archive workflow. This default avoids permanently downgrading a
  // skill that was archived before the previous_status field was introduced.
  const previousStatus = (skill.previous_status as string) ?? "verified";
  const versionNumber = skill.version_number as number;

  // -------------------------------------------------------------------------
  // 4. Regenerate embedding from skill content
  // -------------------------------------------------------------------------
  const embeddingText = [
    skill.name,
    skill.description,
    ...(Array.isArray(skill.domain) ? skill.domain : []),
    ...(Array.isArray(skill.tags) ? skill.tags : []),
  ].join(" ");

  const embedding = await generateEmbedding(embeddingText);

  // -------------------------------------------------------------------------
  // 5. Update skill: restore status, remove archive fields, set embedding
  // -------------------------------------------------------------------------
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: { skill_id: skillId, version_number: versionNumber },
        UpdateExpression:
          "SET #status = :restored_status, #updated_at = :now, #embedding = :embedding, " +
          "#unarchived_at = :now " +
          "REMOVE #archived_at, #archive_reason, #previous_status",
        ConditionExpression: "#status = :archived",
        ExpressionAttributeNames: {
          "#status": "status",
          "#updated_at": "updated_at",
          "#embedding": "embedding",
          "#archived_at": "archived_at",
          "#archive_reason": "archive_reason",
          "#previous_status": "previous_status",
          "#unarchived_at": "unarchived_at",
        },
        ExpressionAttributeValues: {
          ":archived": "archived",
          ":restored_status": previousStatus,
          ":now": now,
          ":embedding": embedding,
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
      return error(409, "CONFLICT", "Skill is not archived");
    }
    throw err;
  }

  // -------------------------------------------------------------------------
  // 6. Increment skill_count on Problems table
  // -------------------------------------------------------------------------
  await docClient.send(
    new UpdateCommand({
      TableName: PROBLEMS_TABLE,
      Key: { problem_id: skill.problem_id as string },
      UpdateExpression:
        "SET #skill_count = #skill_count + :one, #updated_at = :now",
      ExpressionAttributeNames: {
        "#skill_count": "skill_count",
        "#updated_at": "updated_at",
      },
      ExpressionAttributeValues: {
        ":one": 1,
        ":now": now,
      },
    }),
  );

  // -------------------------------------------------------------------------
  // 7. Write audit record
  // -------------------------------------------------------------------------
  await writeArchiveAuditRecord({
    entityId: skillId,
    entityType: "skill",
    action: "unarchive",
    reason: "manual",
    triggeredBy: "api_manual",
    previousStatus: "archived",
    skillVersion: versionNumber,
  });

  // -------------------------------------------------------------------------
  // 8. Emit Kinesis unarchive event (fire-and-forget)
  // -------------------------------------------------------------------------
  await emitEvent({
    event_type: "unarchive",
    skill_id: skillId,
    intent: `unarchive:${previousStatus}`,
    latency_ms: 0,
    confidence: null,
    cache_hit: false,
    input_hash: null,
    success: true,
  });

  // -------------------------------------------------------------------------
  // 9. If parent problem is archived, auto-unarchive it
  // -------------------------------------------------------------------------
  await unarchiveProblemIfArchived(skill.problem_id as string);

  // -------------------------------------------------------------------------
  // 10. Return restored skill
  // -------------------------------------------------------------------------
  const restoredSkill = {
    skill_id: skillId,
    problem_id: skill.problem_id,
    name: skill.name,
    description: skill.description,
    version: versionNumber,
    version_label: skill.version_label,
    is_canonical: skill.is_canonical,
    status: previousStatus,
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

  return success(200, { skill: restoredSkill });
}
