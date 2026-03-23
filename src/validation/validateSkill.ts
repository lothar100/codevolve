/**
 * POST /validate/:skill_id — Run a skill's test suite and update its
 * confidence score, status, and latency metrics in DynamoDB.
 *
 * Full flow (ARCH-08):
 *   1.  Parse path parameter skill_id
 *   2.  Parse and validate request body (Zod)
 *   3.  Fetch latest skill version from codevolve-skills → 404 if missing/archived
 *   4.  Merge additional_tests (if supplied) into skill.tests for this run only
 *   5.  Invoke runTests → per-test results + aggregate latency
 *   6.  Compute new_confidence = passCount / totalTests (0 if no tests)
 *   7.  Determine new_status from confidence:
 *         confidence === 0              → "unsolved"
 *         0 < confidence < 0.85        → "partial"
 *         confidence >= 0.85           → "verified"
 *       ("optimized" is set only by promote-canonical, not here)
 *       ("archived" is never touched by validate)
 *   8.  Build UpdateExpression:
 *         SET confidence, status, updated_at, last_validated_at,
 *             latency_p50_ms, latency_p95_ms,
 *             test_pass_count, test_fail_count
 *         Conditional REMOVE optimization_flagged when latencyP95Ms <= 5000
 *   9.  Write to DynamoDB (fire-and-forget)
 *  10.  Emit validate analytics event (fire-and-forget, never throws)
 *  11.  Evolve trigger: if new_confidence < 0.7, send skill_id to the evolve
 *       gap queue (SQS) fire-and-forget
 *  12.  Return ValidateResponse
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import { SkillTestSchema } from "../shared/validation.js";
import type { Skill, SkillStatus, SkillTest } from "../shared/types.js";
import { runTests } from "./testRunner.js";

// ---------------------------------------------------------------------------
// SQS client (for evolve gap queue)
// ---------------------------------------------------------------------------

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

// Read at call time so tests can set process.env after module load.
function getEvolveGapQueueUrl(): string {
  return process.env.EVOLVE_GAP_QUEUE_URL ?? "";
}

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const ValidateRequestSchema = z.object({
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(300000)
    .optional()
    .default(30000),
  additional_tests: z.array(SkillTestSchema).max(128).optional().default([]),
});

type ValidateRequest = {
  timeout_ms: number;
  additional_tests: SkillTest[];
};

// ---------------------------------------------------------------------------
// Status transition logic (§6)
// ---------------------------------------------------------------------------

function deriveStatus(
  newConfidence: number,
  currentStatus: SkillStatus,
): SkillStatus {
  // "optimized" and "archived" are never downgraded by validate.
  if (currentStatus === "archived") return "archived";
  if (currentStatus === "optimized") {
    // Even optimized skills can be demoted if confidence falls below threshold.
    // Spec says optimized is set only via promote-canonical, but validate can
    // still move it back to partial/unsolved if tests regress.
    if (newConfidence === 0) return "unsolved";
    if (newConfidence < 0.85) return "partial";
    return "verified"; // stays verified; promote-canonical re-elevates to optimized
  }

  if (newConfidence === 0) return "unsolved";
  if (newConfidence < 0.85) return "partial";
  return "verified";
}

// ---------------------------------------------------------------------------
// Evolve gap trigger (fire-and-forget)
// ---------------------------------------------------------------------------

async function triggerEvolveGap(skillId: string): Promise<void> {
  const queueUrl = getEvolveGapQueueUrl();
  if (!queueUrl) {
    console.warn(
      "[validate] EVOLVE_GAP_QUEUE_URL not set — skipping evolve trigger",
    );
    return;
  }
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        skill_id: skillId,
        reason: "confidence_below_threshold",
        triggered_at: new Date().toISOString(),
      }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();

  // 1. Extract skill_id from path parameter.
  const skillId = event.pathParameters?.skill_id;
  if (!skillId) {
    return error(400, "VALIDATION_ERROR", "Missing path parameter: skill_id");
  }

  // 2. Parse and validate request body.
  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const bodyValidation = validate(ValidateRequestSchema, rawBody);
  if (!bodyValidation.success) {
    return error(
      400,
      bodyValidation.error.code,
      bodyValidation.error.message,
      bodyValidation.error.details,
    );
  }

  const request = bodyValidation.data as ValidateRequest;
  const timeoutMs = request.timeout_ms;
  const additionalTests = request.additional_tests;

  // 3. Fetch latest skill version from DynamoDB.
  let skill: Skill;
  let versionNumber: number;
  try {
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        KeyConditionExpression: "skill_id = :sid",
        ExpressionAttributeValues: { ":sid": skillId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );

    const item = queryResult.Items?.[0];
    if (!item) {
      return error(404, "NOT_FOUND", `Skill ${skillId} not found`);
    }
    if (item.status === "archived") {
      return error(404, "NOT_FOUND", `Skill ${skillId} is archived`);
    }

    skill = item as unknown as Skill;
    versionNumber = item.version_number as number;
  } catch (err) {
    console.error("validate: DynamoDB fetch error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  const previousConfidence = skill.confidence ?? 0;

  // 4. Merge additional_tests into skill.tests for this run only.
  const mergedSkill: Skill = {
    ...skill,
    tests: [...(skill.tests ?? []), ...additionalTests],
  };

  // 5. Run tests — may throw if language is unsupported.
  let testResult: Awaited<ReturnType<typeof runTests>>;
  try {
    testResult = await runTests(mergedSkill, timeoutMs);
  } catch (runErr) {
    const errMsg =
      runErr instanceof Error ? runErr.message : "Test runner failed";
    // Unsupported language produces a 400-level error.
    const isUnsupported =
      errMsg.toLowerCase().includes("unsupported language") ||
      errMsg.toLowerCase().includes("environment variable is not set");
    return error(
      isUnsupported ? 400 : 500,
      isUnsupported ? "UNSUPPORTED_LANGUAGE" : "INTERNAL_ERROR",
      errMsg,
    );
  }

  const { results, passCount, failCount, latencyP50Ms, latencyP95Ms } =
    testResult;
  const totalTests = results.length;

  // 6. Compute new_confidence.
  const newConfidence =
    totalTests === 0 ? 0 : passCount / totalTests;

  // 7. Determine new_status.
  const newStatus = deriveStatus(newConfidence, skill.status);

  // 8. Build and execute DynamoDB UpdateExpression.
  const now = new Date().toISOString();

  // Conditional: only REMOVE optimization_flagged when p95 is within threshold.
  const shouldClearOptFlag = latencyP95Ms <= 5000;

  const updateExpression = shouldClearOptFlag
    ? "SET confidence = :conf, #st = :status, updated_at = :now, last_validated_at = :now, " +
      "latency_p50_ms = :p50, latency_p95_ms = :p95, " +
      "test_pass_count = :passCount, test_fail_count = :failCount " +
      "REMOVE optimization_flagged"
    : "SET confidence = :conf, #st = :status, updated_at = :now, last_validated_at = :now, " +
      "latency_p50_ms = :p50, latency_p95_ms = :p95, " +
      "test_pass_count = :passCount, test_fail_count = :failCount";

  docClient
    .send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: { skill_id: skillId, version_number: versionNumber },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":conf": newConfidence,
          ":status": newStatus,
          ":now": now,
          ":p50": latencyP50Ms,
          ":p95": latencyP95Ms,
          ":passCount": passCount,
          ":failCount": failCount,
        },
      }),
    )
    .catch((e) =>
      console.error("validate: DynamoDB update failed (swallowed):", e),
    );

  // 10. Emit validate analytics event (fire-and-forget).
  const latencyMs = Date.now() - startTime;
  emitEvent({
    event_type: "validate",
    skill_id: skillId,
    intent: null,
    latency_ms: latencyMs,
    confidence: newConfidence,
    cache_hit: false,
    input_hash: null,
    success: totalTests > 0 && failCount === 0,
  }).catch((e) =>
    console.warn("validate: emitEvent failed (swallowed):", e),
  );

  // 11. Evolve trigger: confidence < 0.7 → send to gap queue.
  if (newConfidence < 0.7) {
    triggerEvolveGap(skillId).catch((e) =>
      console.warn("validate: evolve trigger failed (swallowed):", e),
    );
  }

  // 12. Return response.
  return success(200, {
    skill_id: skillId,
    version: versionNumber,
    previous_confidence: previousConfidence,
    new_confidence: newConfidence,
    new_status: newStatus,
    total_tests: totalTests,
    pass_count: passCount,
    fail_count: failCount,
    latency_p50_ms: latencyP50Ms,
    latency_p95_ms: latencyP95Ms,
    results,
  });
}
