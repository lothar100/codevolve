/**
 * POST /execute — Log that a skill was run locally and emit an analytics event.
 *
 * Skills are local CLI tools — the caller fetches the implementation via /skills/:id
 * and runs it in their own environment. This endpoint acknowledges the execution
 * and records it in the analytics pipeline.
 *
 * Flow:
 *   1. Parse request (skill_id + optional inputs/notes)
 *   2. Verify skill exists in DynamoDB → 404 if not found
 *   3. Increment execution_count (fire-and-forget)
 *   4. Emit Kinesis execute event (fire-and-forget)
 *   5. Return acknowledgement
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";

const ExecuteRequestSchema = z.object({
  skill_id: z.string().uuid(),
  inputs: z.record(z.unknown()).optional().default({}),
});

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const validation = validate(ExecuteRequestSchema, body);
  if (!validation.success) {
    return error(400, validation.error.code, validation.error.message, validation.error.details);
  }

  const { skill_id: skillId } = validation.data as { skill_id: string; inputs: Record<string, unknown> };

  // Verify skill exists
  let skill: Record<string, unknown>;
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        KeyConditionExpression: "skill_id = :sid",
        ExpressionAttributeValues: { ":sid": skillId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    const item = result.Items?.[0];
    if (!item) return error(404, "NOT_FOUND", `Skill ${skillId} not found`);
    if (item.status === "archived") return error(404, "NOT_FOUND", `Skill ${skillId} is archived`);
    skill = item as Record<string, unknown>;
  } catch (err) {
    console.error("[execute] DynamoDB fetch error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  const versionNumber = skill.version_number as number;
  const skillConfidence = (skill.confidence as number) ?? 0;

  // Increment execution_count (fire-and-forget)
  docClient.send(
    new UpdateCommand({
      TableName: SKILLS_TABLE,
      Key: { skill_id: skillId, version_number: versionNumber },
      UpdateExpression: "ADD execution_count :one SET last_executed_at = :now",
      ExpressionAttributeValues: { ":one": 1, ":now": new Date().toISOString() },
    }),
  ).catch((e) => console.warn("[execute] execution_count update failed (swallowed):", e));

  // Emit analytics event (fire-and-forget)
  emitEvent({
    event_type: "execute",
    skill_id: skillId,
    intent: null,
    latency_ms: 0,
    confidence: skillConfidence,
    cache_hit: false,
    input_hash: null,
    success: true,
  }).catch((e) => console.warn("[execute] emitEvent failed (swallowed):", e));

  return success(200, {
    skill_id: skillId,
    acknowledged: true,
    message: "Execution logged. Run the implementation locally.",
  });
}
