/**
 * POST /validate/:skill_id — Run tests for a skill and update its confidence score.
 *
 * Flow:
 *   1. Validate path parameter (skill_id UUID)
 *   2. Parse optional request body: { version_number?: number }
 *   3. Fetch skill from codevolve-skills (latest version, or specified version)
 *   4. Guard: 404 if not found, 422 if archived, 400 if no tests
 *   5. Run tests via runTests() stub (ARCH-08 pending)
 *   6. Compute confidence = passCount / tests.length (clamped [0, 1])
 *   7. UpdateItem: confidence, last_validated_at, test_pass_count, test_fail_count,
 *      and conditionally clear needs_optimization flag
 *   8. Emit Kinesis event (fire-and-forget)
 *   9. Return { skill_id, confidence, pass_count, fail_count, latency_ms }
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import type { Skill } from "../shared/types.js";
import { runTests } from "./testRunner.js";
import type { TestRunResult } from "./testRunner.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PathParamsSchema = z.object({
  skill_id: z.string().uuid(),
});

const RequestBodySchema = z.object({
  version_number: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();

  // 1. Validate path parameter
  const pathValidation = validate(PathParamsSchema, {
    skill_id: event.pathParameters?.skill_id,
  });
  if (!pathValidation.success) {
    return error(400, "VALIDATION_ERROR", "Invalid skill_id: must be a UUID");
  }

  const skillId = pathValidation.data.skill_id;

  // 2. Parse optional request body
  let requestBody: { version_number?: number } = {};
  if (event.body) {
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(event.body);
    } catch {
      return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
    }

    const bodyValidation = validate(RequestBodySchema, rawBody);
    if (!bodyValidation.success) {
      return error(
        400,
        bodyValidation.error.code,
        bodyValidation.error.message,
        bodyValidation.error.details,
      );
    }
    requestBody = bodyValidation.data;
  }

  // 3. Fetch skill from DynamoDB
  let skillItem: Record<string, unknown> | undefined;
  try {
    if (requestBody.version_number !== undefined) {
      // Specific version requested
      const result = await docClient.send(
        new GetCommand({
          TableName: SKILLS_TABLE,
          Key: {
            skill_id: skillId,
            version_number: requestBody.version_number,
          },
        }),
      );
      skillItem = result.Item as Record<string, unknown> | undefined;
    } else {
      // Latest version: descending sort, limit 1
      const result = await docClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          KeyConditionExpression: "skill_id = :sid",
          ExpressionAttributeValues: { ":sid": skillId },
          ScanIndexForward: false,
          Limit: 1,
        }),
      );
      skillItem = result.Items?.[0] as Record<string, unknown> | undefined;
    }
  } catch (err) {
    console.error("validateSkill: DynamoDB fetch error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  // 4a. Guard: 404 if not found
  if (!skillItem) {
    return error(404, "NOT_FOUND", `Skill ${skillId} not found`);
  }

  // 4b. Guard: 422 if archived
  if (skillItem.status === "archived") {
    return error(
      422,
      "SKILL_ARCHIVED",
      `Skill ${skillId} is archived and cannot be validated`,
    );
  }

  // 4c. Guard: 400 if no tests
  const tests = (skillItem.tests as Skill["tests"] | undefined) ?? [];
  if (tests.length === 0) {
    return error(
      400,
      "NO_TESTS",
      `Skill ${skillId} has no test cases — add tests before validating`,
    );
  }

  // Build the Skill object for the test runner
  const skill: Skill = {
    skill_id: skillItem.skill_id as string,
    problem_id: skillItem.problem_id as string,
    name: skillItem.name as string,
    description: (skillItem.description as string) ?? "",
    version: skillItem.version_number as number,
    ...(skillItem.version_label
      ? { version_label: skillItem.version_label as string }
      : {}),
    is_canonical: (skillItem.is_canonical as boolean) ?? false,
    status: skillItem.status as Skill["status"],
    language: skillItem.language as Skill["language"],
    domain: (skillItem.domain as string[]) ?? [],
    tags: (skillItem.tags as string[]) ?? [],
    inputs: (skillItem.inputs as Skill["inputs"]) ?? [],
    outputs: (skillItem.outputs as Skill["outputs"]) ?? [],
    examples: (skillItem.examples as Skill["examples"]) ?? [],
    tests,
    implementation: (skillItem.implementation as string) ?? "",
    confidence: (skillItem.confidence as number) ?? 0,
    latency_p50_ms: (skillItem.latency_p50_ms as number | null) ?? null,
    latency_p95_ms: (skillItem.latency_p95_ms as number | null) ?? null,
    created_at: skillItem.created_at as string,
    updated_at: skillItem.updated_at as string,
  };

  const versionNumber = skill.version;

  // 5. Run tests (stub — throws until ARCH-08 is wired)
  let testResult: TestRunResult;
  try {
    testResult = await runTests(skill);
  } catch (err) {
    console.error("validateSkill: test runner error:", err);
    const latencyMs = Date.now() - startTime;

    emitEvent({
      event_type: "fail",
      skill_id: skillId,
      intent: null,
      latency_ms: latencyMs,
      confidence: skill.confidence,
      cache_hit: false,
      input_hash: null,
      success: false,
    }).catch((e) =>
      console.warn("validateSkill: emitEvent failed (swallowed):", e),
    );

    return error(500, "RUNNER_ERROR", "Test runner failed — ARCH-08 pending");
  }

  const { passCount, failCount, latencyMs: runnerLatencyMs } = testResult;
  const totalTests = tests.length;

  // 6. Compute confidence (clamped [0, 1])
  const confidence = Math.min(1, Math.max(0, passCount / totalTests));

  const now = new Date().toISOString();

  // 7. UpdateItem: write validation results back to DynamoDB
  // If all tests pass AND runner latency is within the 5000ms p95 budget,
  // clear the needs_optimization flag.
  const clearOptimizationFlag =
    failCount === 0 && runnerLatencyMs <= 5000;

  try {
    const updateExpression = clearOptimizationFlag
      ? "SET confidence = :conf, last_validated_at = :now, test_pass_count = :pass, test_fail_count = :fail REMOVE needs_optimization"
      : "SET confidence = :conf, last_validated_at = :now, test_pass_count = :pass, test_fail_count = :fail";

    await docClient.send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: { skill_id: skillId, version_number: versionNumber },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: {
          ":conf": confidence,
          ":now": now,
          ":pass": passCount,
          ":fail": failCount,
        },
      }),
    );
  } catch (err) {
    console.error("validateSkill: DynamoDB update error:", err);
    return error(500, "INTERNAL_ERROR", "Failed to persist validation results");
  }

  const totalLatencyMs = Date.now() - startTime;

  // 8. Emit Kinesis event (fire-and-forget — must not crash handler)
  emitEvent({
    event_type: "validate",
    skill_id: skillId,
    intent: null,
    latency_ms: totalLatencyMs,
    confidence,
    cache_hit: false,
    input_hash: null,
    success: true,
  }).catch((e) =>
    console.warn("validateSkill: emitEvent failed (swallowed):", e),
  );

  // 9. Return result
  return success(200, {
    skill_id: skillId,
    confidence,
    pass_count: passCount,
    fail_count: failCount,
    latency_ms: runnerLatencyMs,
  });
}
