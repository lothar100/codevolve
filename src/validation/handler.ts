/**
 * POST /validate/:skill_id — Run skill tests, update confidence, emit event.
 *
 * Handler flow:
 *   1. Extract skill_id from path parameters
 *   2. GetItem — fetch skill from DynamoDB; 404 if not found; 409 if archived
 *   3. Build test list from skill.tests; 400 NO_TESTS_DEFINED if empty
 *   4. Run each test via runner Lambda; compare result with deepEqual
 *   5. Compute pass_count, fail_count, confidence = pass_count / total_tests
 *   6. Status transition logic (see STATUS TRANSITIONS below)
 *   7. UpdateItem — write confidence, test_pass_count, test_fail_count,
 *      last_validated_at, status; conditionally REMOVE optimization_flagged
 *   8. Emit Kinesis validate event (success = failCount === 0)
 *   9. If confidence < 0.7: send to GapQueue
 *  10. Return ValidationResponse
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
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import { deepEqual } from "../shared/deepEqual.js";
import {
  getRunnerFunctionName,
  invokeRunner,
  type RunnerPayload,
} from "../execution/runners.js";
import type { SkillStatus, SkillTest } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIDENCE_VERIFIED_THRESHOLD = 0.85;
const CONFIDENCE_OPTIMIZED_THRESHOLD = 1.0;
const CONFIDENCE_EVOLVE_THRESHOLD = 0.7;
const DEFAULT_TEST_TIMEOUT_MS = 10000;

// GAP_QUEUE_URL is read dynamically (not at module load) so that
// process.env changes in tests are respected.

// ---------------------------------------------------------------------------
// SQS client
// ---------------------------------------------------------------------------

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestResult {
  test_index: number;
  passed: boolean;
  actual?: unknown;
  error?: string;
}

interface ValidationResponse {
  skill_id: string;
  version: number;
  total_tests: number;
  pass_count: number;
  fail_count: number;
  confidence: number;
  status: SkillStatus;
  last_validated_at: string;
  results: TestResult[];
}

// ---------------------------------------------------------------------------
// Status transition logic
// ---------------------------------------------------------------------------

function computeStatus(
  currentStatus: SkillStatus,
  confidence: number,
  failCount: number,
): SkillStatus {
  // Archived is a terminal state — should not reach here, but guard it
  if (currentStatus === "archived") return "archived";

  // Revert / stay partial if confidence below verified threshold
  if (confidence < CONFIDENCE_VERIFIED_THRESHOLD) {
    // unsolved with zero passing tests stays unsolved
    if (currentStatus === "unsolved" && confidence === 0) return "unsolved";
    return "partial";
  }

  // confidence >= 0.85 AND fail_count === 0: eligible for verified or optimized
  if (failCount === 0) {
    if (confidence >= CONFIDENCE_OPTIMIZED_THRESHOLD) {
      // verified → optimized (must already be verified to reach optimized)
      if (currentStatus === "verified" || currentStatus === "optimized") {
        return "optimized";
      }
      // partial or unsolved with perfect score → verified (not optimized yet)
      return "verified";
    }
    // confidence >= 0.85 and < 1.0 → verified
    return "verified";
  }

  // failCount > 0 but confidence >= 0.85 — partial (some failures present)
  return "partial";
}

// ---------------------------------------------------------------------------
// Run a single test via runner Lambda
// ---------------------------------------------------------------------------

async function runTest(
  implementation: string,
  language: string,
  test: SkillTest,
  testIndex: number,
): Promise<TestResult> {
  const runnerFnOrError = getRunnerFunctionName(language);
  if (typeof runnerFnOrError === "object") {
    return {
      test_index: testIndex,
      passed: false,
      error: `Unsupported language: ${runnerFnOrError.language}`,
    };
  }

  const payload: RunnerPayload = {
    implementation,
    language,
    inputs: test.input as Record<string, unknown>,
    timeout_ms: DEFAULT_TEST_TIMEOUT_MS,
  };

  let runnerResult: { functionError?: string; payload: string };
  try {
    runnerResult = await invokeRunner(runnerFnOrError, payload);
  } catch (invokeErr) {
    return {
      test_index: testIndex,
      passed: false,
      error: `Runner invocation failed: ${String(invokeErr)}`,
    };
  }

  if (runnerResult.functionError) {
    let detail = runnerResult.payload;
    try {
      const parsed = JSON.parse(runnerResult.payload) as Record<string, unknown>;
      detail = String(parsed.errorMessage ?? parsed.error ?? runnerResult.payload);
    } catch {
      // keep raw payload as detail
    }
    return {
      test_index: testIndex,
      passed: false,
      error: `Runner error: ${detail}`,
    };
  }

  let actual: unknown;
  try {
    actual = JSON.parse(runnerResult.payload) as unknown;
  } catch {
    return {
      test_index: testIndex,
      passed: false,
      actual: runnerResult.payload,
      error: "Runner returned invalid JSON",
    };
  }

  const passed = deepEqual(actual, test.expected);
  return {
    test_index: testIndex,
    passed,
    actual,
  };
}

// ---------------------------------------------------------------------------
// GapQueue send (fire-and-forget)
// ---------------------------------------------------------------------------

async function sendToGapQueue(
  skillId: string,
  confidence: number,
): Promise<void> {
  const gapQueueUrl = process.env.GAP_QUEUE_URL ?? "";
  if (!gapQueueUrl) {
    console.warn("[validate] GAP_QUEUE_URL not set — skipping gap queue send");
    return;
  }
  const GAP_QUEUE_URL = gapQueueUrl;
  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: GAP_QUEUE_URL,
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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();

  // 1. Extract skill_id from path
  const skillId = event.pathParameters?.skill_id ?? event.pathParameters?.id;
  if (!skillId) {
    return error(400, "VALIDATION_ERROR", "Missing skill_id path parameter");
  }

  // 2. Fetch skill from DynamoDB (latest version)
  let skill: Record<string, unknown>;
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

    // 409 if archived
    if (item.status === "archived") {
      return error(
        409,
        "SKILL_ARCHIVED",
        `Skill ${skillId} is archived and cannot be validated`,
      );
    }

    skill = item as Record<string, unknown>;
  } catch (err) {
    console.error("[validate] DynamoDB fetch error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  const versionNumber = skill.version_number as number;
  const currentStatus = (skill.status as SkillStatus) ?? "unsolved";
  const skillLanguage = skill.language as string;
  const skillImplementation = (skill.implementation as string) ?? "";
  const latencyP95 = (skill.latency_p95_ms as number | null) ?? null;
  const skillTests = (skill.tests as SkillTest[]) ?? [];

  // 3. Require tests
  if (skillTests.length === 0) {
    return error(
      400,
      "NO_TESTS_DEFINED",
      `Skill ${skillId} has no tests defined. Add tests before validating.`,
    );
  }

  // 4. Run all tests
  const testResults: TestResult[] = await Promise.all(
    skillTests.map((test, i) =>
      runTest(skillImplementation, skillLanguage, test, i),
    ),
  );

  // 5. Compute scores
  const totalTests = skillTests.length;
  const passCount = testResults.filter((r) => r.passed).length;
  const failCount = totalTests - passCount;
  const confidence = passCount / totalTests;

  // 6. Status transition
  const newStatus = computeStatus(currentStatus, confidence, failCount);

  const lastValidatedAt = new Date().toISOString();

  // 7. DynamoDB UpdateItem
  // Conditionally REMOVE optimization_flagged if latency_p95 <= 5000
  const shouldRemoveOptimizationFlag =
    latencyP95 !== null && latencyP95 <= 5000;

  const updateExpression = [
    "SET confidence = :confidence",
    "test_pass_count = :pass_count",
    "test_fail_count = :fail_count",
    "last_validated_at = :last_validated_at",
    "#status = :status",
    ...(shouldRemoveOptimizationFlag
      ? []
      : []),
  ].join(", ") +
    (shouldRemoveOptimizationFlag ? " REMOVE optimization_flagged" : "");

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: { skill_id: skillId, version_number: versionNumber },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          "#status": "status",
        },
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

  // 8. Emit Kinesis event (fire-and-forget)
  // WARNING-02 fix: success = failCount === 0 (NOT hardcoded true)
  emitEvent({
    event_type: "validate",
    skill_id: skillId,
    intent: null,
    latency_ms: latencyMs,
    confidence,
    cache_hit: false,
    input_hash: null,
    success: failCount === 0,
  }).catch((e) =>
    console.warn("[validate] emitEvent failed (swallowed):", e),
  );

  // 9. If confidence < 0.7, send to GapQueue (fire-and-forget)
  if (confidence < CONFIDENCE_EVOLVE_THRESHOLD) {
    sendToGapQueue(skillId, confidence).catch((e) =>
      console.warn("[validate] sendToGapQueue failed (swallowed):", e),
    );
  }

  // 10. Return response
  const responseBody: ValidationResponse = {
    skill_id: skillId,
    version: versionNumber,
    total_tests: totalTests,
    pass_count: passCount,
    fail_count: failCount,
    confidence,
    status: newStatus,
    last_validated_at: lastValidatedAt,
    results: testResults,
  };

  return success(200, responseBody);
}
