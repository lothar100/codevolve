/**
 * POST /validate/:skill_id — Accept caller-provided test results, update confidence, emit event.
 *
 * Skills are local CLI tools — the caller runs the tests in their own environment
 * and reports the results here. This endpoint updates the skill's confidence score
 * and status based on the reported outcomes.
 *
 * Flow:
 *   1. Extract skill_id from path
 *   2. Fetch skill from DynamoDB → 404 if not found, 409 if archived
 *   3. Parse caller-provided pass_count / fail_count / total_tests
 *   4. Compute confidence = pass_count / total_tests
 *   5. Status transition
 *   6. UpdateItem — write confidence, status, test counts, last_validated_at
 *   7. Emit Kinesis validate event
 *   8. If confidence < 0.7: send to GapQueue
 *   9. Return ValidationResponse
 *
 * STATUS TRANSITIONS:
 *   partial  → verified   if confidence >= 0.85 AND fail_count === 0
 *   verified → optimized  if already verified AND confidence === 1.0
 *   any      → partial    if confidence < 0.85 (revert/cap)
 *   unsolved → partial    if any tests pass
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import type { SkillStatus } from "../shared/types.js";

const CONFIDENCE_VERIFIED_THRESHOLD = 0.85;
const CONFIDENCE_OPTIMIZED_THRESHOLD = 1.0;
const CONFIDENCE_EVOLVE_THRESHOLD = 0.7;

const sqsClient = new SQSClient({ region: process.env.AWS_REGION ?? "us-east-2" });

const ValidateRequestSchema = z.object({
  pass_count: z.number().int().min(0),
  fail_count: z.number().int().min(0),
  total_tests: z.number().int().min(1),
});

function computeStatus(
  currentStatus: SkillStatus,
  confidence: number,
  failCount: number,
): SkillStatus {
  if (currentStatus === "archived") return "archived";
  if (confidence < CONFIDENCE_VERIFIED_THRESHOLD) {
    if (currentStatus === "unsolved" && confidence === 0) return "unsolved";
    return "partial";
  }
  if (failCount === 0) {
    if (confidence >= CONFIDENCE_OPTIMIZED_THRESHOLD) {
      if (currentStatus === "verified" || currentStatus === "optimized") return "optimized";
      return "verified";
    }
    return "verified";
  }
  return "partial";
}

async function sendToGapQueue(skillId: string, confidence: number): Promise<void> {
  const gapQueueUrl = process.env.GAP_QUEUE_URL ?? "";
  if (!gapQueueUrl) {
    console.warn("[validate] GAP_QUEUE_URL not set — skipping gap queue send");
    return;
  }
  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: gapQueueUrl,
        MessageBody: JSON.stringify({
          skill_id: skillId,
          confidence,
          triggered_at: new Date().toISOString(),
          reason: "low_confidence",
        }),
      }),
    );
  } catch (err) {
    console.error("[validate] Failed to send to GapQueue (swallowed):", err);
  }
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();

  const skillId = event.pathParameters?.skill_id ?? event.pathParameters?.id;
  if (!skillId) {
    return error(400, "VALIDATION_ERROR", "Missing skill_id path parameter");
  }

  // Fetch skill
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
    if (item.status === "archived") {
      return error(409, "SKILL_ARCHIVED", `Skill ${skillId} is archived and cannot be validated`);
    }
    skill = item as Record<string, unknown>;
  } catch (err) {
    console.error("[validate] DynamoDB fetch error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  // Parse request body
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const validation = validate(ValidateRequestSchema, body);
  if (!validation.success) {
    return error(400, validation.error.code, validation.error.message, validation.error.details);
  }

  const { pass_count: passCount, fail_count: failCount, total_tests: totalTests } =
    validation.data as { pass_count: number; fail_count: number; total_tests: number };

  if (passCount + failCount !== totalTests) {
    return error(400, "VALIDATION_ERROR", "pass_count + fail_count must equal total_tests");
  }

  const versionNumber = skill.version_number as number;
  const currentStatus = (skill.status as SkillStatus) ?? "unsolved";
  const latencyP95 = (skill.latency_p95_ms as number | null) ?? null;

  const confidence = passCount / totalTests;
  const newStatus = computeStatus(currentStatus, confidence, failCount);
  const lastValidatedAt = new Date().toISOString();

  const shouldRemoveOptimizationFlag = latencyP95 !== null && latencyP95 <= 5000;
  const updateExpression =
    "SET confidence = :confidence, test_pass_count = :pass_count, test_fail_count = :fail_count, last_validated_at = :last_validated_at, #status = :status" +
    (shouldRemoveOptimizationFlag ? " REMOVE optimization_flagged" : "");

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: { skill_id: skillId, version_number: versionNumber },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":confidence": confidence,
          ":pass_count": passCount,
          ":fail_count": failCount,
          ":last_validated_at": lastValidatedAt,
          ":status": newStatus,
        },
      }),
    );
  } catch (err) {
    console.error("[validate] DynamoDB update error:", err);
    return error(500, "INTERNAL_ERROR", "Failed to persist validation results");
  }

  const latencyMs = Date.now() - startTime;

  emitEvent({
    event_type: "validate",
    skill_id: skillId,
    intent: null,
    latency_ms: latencyMs,
    confidence,
    cache_hit: false,
    input_hash: null,
    success: failCount === 0,
  }).catch((e) => console.warn("[validate] emitEvent failed (swallowed):", e));

  if (confidence < CONFIDENCE_EVOLVE_THRESHOLD) {
    sendToGapQueue(skillId, confidence).catch((e) =>
      console.warn("[validate] sendToGapQueue failed (swallowed):", e),
    );
  }

  return success(200, {
    skill_id: skillId,
    version: versionNumber,
    total_tests: totalTests,
    pass_count: passCount,
    fail_count: failCount,
    confidence,
    status: newStatus,
    last_validated_at: lastValidatedAt,
  });
}
