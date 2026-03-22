/**
 * POST /execute — Run a skill with provided inputs.
 *
 * Full execution flow:
 *   1. Validate request (Zod)
 *   2. Fetch skill from codevolve-skills → 404 if not found or archived
 *   3. Validate inputs against skill's input schema (field names present)
 *   4. Compute input_hash = SHA-256(canonical JSON of inputs)
 *   5. Cache lookup (unless skip_cache: true)
 *      - HIT: return cached output, emit event, fire-and-forget incrementCacheHit
 *      - MISS: invoke runner Lambda
 *   6. Runner invocation
 *      - Success: return output, conditionally write to cache, update execution stats, emit event
 *      - Error: map error_type → HTTP status, emit event (success: false)
 *   7. Return ExecuteResponse
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import { computeInputHash } from "./inputHash.js";
import {
  getRunnerFunctionName,
  invokeRunner,
  type RunnerPayload,
} from "./runners.js";
import {
  getCachedOutput,
  writeCachedOutput,
  incrementCacheHit,
} from "../cache/cache.js";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const ExecuteRequestSchema = z.object({
  skill_id: z.string().uuid(),
  inputs: z.record(z.unknown()),
  skip_cache: z.boolean().optional().default(false),
  timeout_ms: z
    .number()
    .int()
    .min(100)
    .max(300000)
    .optional()
    .default(10000),
});

// Zod output type (after defaults applied)
type ExecuteRequest = {
  skill_id: string;
  inputs: Record<string, unknown>;
  skip_cache: boolean;
  timeout_ms: number;
};

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

type RunnerErrorType = "validation" | "runtime" | "timeout" | "oom";

interface HttpErrorMap {
  status: number;
  code: string;
}

const ERROR_TYPE_MAP: Record<RunnerErrorType, HttpErrorMap> = {
  validation: { status: 422, code: "EXECUTION_FAILED" },
  runtime: { status: 422, code: "EXECUTION_FAILED" },
  timeout: { status: 408, code: "EXECUTION_TIMEOUT" },
  oom: { status: 504, code: "EXECUTION_OOM" },
};

// ---------------------------------------------------------------------------
// Stack trace sanitization
// ---------------------------------------------------------------------------

const INTERNAL_FRAME_PATTERNS = [
  /\/var\/runtime\//,
  /\/var\/task\//,
  /node_modules\/lambda-runtime/,
  /bootstrap/,
];

function sanitizeStackTrace(detail: string | undefined): string | undefined {
  if (!detail) return undefined;

  // Split into lines, filter internal frames, cap at 5 frames
  const lines = detail.split("\n");
  const messageLines: string[] = [];
  const frameLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("at ")) {
      frameLines.push(line);
    } else {
      messageLines.push(line);
    }
  }

  // Remove internal frames
  const filteredFrames = frameLines.filter(
    (frame) =>
      !INTERNAL_FRAME_PATTERNS.some((pattern) => pattern.test(frame)),
  );

  // Cap at 5 frames
  const cappedFrames = filteredFrames.slice(0, 5);

  // Strip path prefixes from frames
  const cleanedFrames = cappedFrames.map((frame) =>
    frame
      .replace(/\/var\/task\//g, "")
      .replace(/\/var\/runtime\//g, ""),
  );

  // Strip absolute paths from message lines
  const cleanedMessage = messageLines
    .join("\n")
    .replace(/\/var\/task\//g, "")
    .replace(/\/var\/runtime\//g, "")
    .replace(/\/[^\s]+\//g, ""); // strip any remaining absolute path prefixes from message

  return [cleanedMessage, ...cleanedFrames].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Runner error classification
// ---------------------------------------------------------------------------

interface RunnerError {
  error_type: RunnerErrorType;
  error: string;
  stack?: string;
}

function classifyFunctionError(
  functionError: string,
  payloadStr: string,
): RunnerErrorType {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(payloadStr) as Record<string, unknown>;
  } catch {
    // If we can't parse, treat as runtime error
    return "runtime";
  }

  const errorType = parsed.errorType as string | undefined;
  const errorMessage = parsed.errorMessage as string | undefined;

  // Timeout patterns
  if (
    errorType === "States.Timeout" ||
    (errorMessage && /timed out/i.test(errorMessage)) ||
    (functionError && /timeout/i.test(functionError))
  ) {
    return "timeout";
  }

  // OOM patterns
  if (
    errorType === "Runtime.ExitError" ||
    (typeof errorMessage === "string" && errorMessage.includes("signal: killed")) ||
    (errorMessage && /out of memory/i.test(errorMessage))
  ) {
    return "oom";
  }

  return "runtime";
}

// ---------------------------------------------------------------------------
// Skill stats update (fire-and-forget)
// ---------------------------------------------------------------------------

async function updateSkillStats(
  skillId: string,
  versionNumber: number,
  latencyMs: number,
  existingP50: number | null,
  existingP95: number | null,
): Promise<void> {
  const now = new Date().toISOString();

  // EMA for p50: new_p50 = 0.9 * existing + 0.1 * latency
  const newP50 =
    existingP50 !== null
      ? 0.9 * existingP50 + 0.1 * latencyMs
      : latencyMs;

  // EMA for p95: if latency > existing_p95, weight more heavily
  let newP95: number;
  if (existingP95 === null) {
    newP95 = latencyMs;
  } else if (latencyMs > existingP95) {
    newP95 = 0.7 * existingP95 + 0.3 * latencyMs;
  } else {
    newP95 = 0.9 * existingP95 + 0.1 * latencyMs;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: SKILLS_TABLE,
      Key: { skill_id: skillId, version_number: versionNumber },
      UpdateExpression:
        "ADD execution_count :one SET last_executed_at = :now, latency_p50_ms = :p50, latency_p95_ms = :p95",
      ExpressionAttributeValues: {
        ":one": 1,
        ":now": now,
        ":p50": newP50,
        ":p95": newP95,
      },
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

  // 1. Parse and validate request body
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const validation = validate(ExecuteRequestSchema, body);
  if (!validation.success) {
    return error(
      400,
      validation.error.code,
      validation.error.message,
      validation.error.details,
    );
  }

  const request = validation.data as ExecuteRequest;
  const skillId = request.skill_id;
  const inputs = request.inputs;
  const skipCache = request.skip_cache;
  const timeoutMs = request.timeout_ms;

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

    if (item.status === "archived") {
      return error(404, "NOT_FOUND", `Skill ${skillId} is archived`);
    }

    skill = item as Record<string, unknown>;
  } catch (err) {
    console.error("execute: DynamoDB fetch error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  const versionNumber = skill.version_number as number;
  const skillLanguage = skill.language as string;
  const skillImplementation = skill.implementation as string;
  const skillConfidence = (skill.confidence as number) ?? 0;
  const autoCache = (skill.auto_cache as boolean | undefined) ?? false;
  const existingP50 = (skill.latency_p50_ms as number | null) ?? null;
  const existingP95 = (skill.latency_p95_ms as number | null) ?? null;

  // 3. Validate inputs against skill input schema
  const skillInputs = (skill.inputs as Array<{ name: string }>) ?? [];
  for (const inputDef of skillInputs) {
    if (!(inputDef.name in inputs)) {
      return error(
        422,
        "VALIDATION_ERROR",
        `Missing required input field: ${inputDef.name}`,
      );
    }
  }

  // 4. Compute input hash
  const inputHash = computeInputHash(inputs as Record<string, unknown>);

  // 5. Cache lookup (unless skip_cache)
  if (!skipCache) {
    let cachedOutput: Record<string, unknown> | null = null;
    try {
      const cacheEntry = await getCachedOutput(skillId, inputHash);
      cachedOutput = cacheEntry?.output ?? null;
    } catch (cacheErr) {
      console.warn("execute: cache lookup failed (continuing):", cacheErr);
    }

    if (cachedOutput !== null) {
      const latencyMs = Date.now() - startTime;
      const executionId = uuidv4();

      // Fire-and-forget: increment hit counter
      incrementCacheHit(skillId, inputHash).catch((e) =>
        console.warn("execute: incrementCacheHit failed (swallowed):", e),
      );

      // Emit event (fire-and-forget)
      emitEvent({
        event_type: "execute",
        skill_id: skillId,
        intent: null,
        latency_ms: latencyMs,
        confidence: skillConfidence,
        cache_hit: true,
        input_hash: inputHash,
        success: true,
      }).catch((e) =>
        console.warn("execute: emitEvent failed (swallowed):", e),
      );

      return success(200, {
        skill_id: skillId,
        outputs: cachedOutput,
        cache_hit: true,
        latency_ms: latencyMs,
        execution_id: executionId,
        input_hash: inputHash,
        version: versionNumber,
      });
    }
  }

  // 6. Invoke runner Lambda
  const runnerFnOrError = getRunnerFunctionName(skillLanguage);
  if (typeof runnerFnOrError === "object") {
    return error(
      400,
      "VALIDATION_ERROR",
      `Unsupported language: ${runnerFnOrError.language}. Supported: python, javascript`,
    );
  }

  const runnerPayload: RunnerPayload = {
    implementation: skillImplementation,
    language: skillLanguage,
    inputs: inputs as Record<string, unknown>,
    timeout_ms: Math.min(timeoutMs, 10000),
  };

  let runnerResult: { functionError?: string; payload: string };
  try {
    runnerResult = await invokeRunner(runnerFnOrError, runnerPayload);
  } catch (invokeErr) {
    console.error("execute: runner invocation error:", invokeErr);
    const latencyMs = Date.now() - startTime;

    emitEvent({
      event_type: "execute",
      skill_id: skillId,
      intent: null,
      latency_ms: latencyMs,
      confidence: skillConfidence,
      cache_hit: false,
      input_hash: inputHash,
      success: false,
    }).catch((e) =>
      console.warn("execute: emitEvent failed (swallowed):", e),
    );

    return error(500, "INTERNAL_ERROR", "Runner invocation failed");
  }

  const { functionError, payload: payloadStr } = runnerResult;
  const latencyMs = Date.now() - startTime;
  const executionId = uuidv4();

  // Lambda-level error (FunctionError set by Lambda service)
  if (functionError) {
    const errorType = classifyFunctionError(functionError, payloadStr);
    const { status, code } = ERROR_TYPE_MAP[errorType];

    let errorDetail: string | undefined;
    try {
      const parsed = JSON.parse(payloadStr) as Record<string, unknown>;
      errorDetail = sanitizeStackTrace(
        (parsed.errorMessage as string | undefined) ??
          (parsed.error as string | undefined),
      );
    } catch {
      errorDetail = undefined;
    }

    emitEvent({
      event_type: "execute",
      skill_id: skillId,
      intent: null,
      latency_ms: latencyMs,
      confidence: skillConfidence,
      cache_hit: false,
      input_hash: inputHash,
      success: false,
    }).catch((e) =>
      console.warn("execute: emitEvent failed (swallowed):", e),
    );

    return error(
      status,
      code,
      `Execution ${errorType}`,
      errorDetail ? { error_detail: errorDetail } : undefined,
    );
  }

  // Parse runner response
  let runnerBody: Record<string, unknown>;
  try {
    runnerBody = JSON.parse(payloadStr) as Record<string, unknown>;
  } catch {
    emitEvent({
      event_type: "execute",
      skill_id: skillId,
      intent: null,
      latency_ms: latencyMs,
      confidence: skillConfidence,
      cache_hit: false,
      input_hash: inputHash,
      success: false,
    }).catch((e) =>
      console.warn("execute: emitEvent failed (swallowed):", e),
    );

    return error(422, "EXECUTION_FAILED", "Runner returned invalid JSON");
  }

  // Runner-returned application-level error
  if (typeof runnerBody.error === "string" && typeof runnerBody.error_type === "string") {
    const errorType = (runnerBody.error_type as RunnerErrorType) in ERROR_TYPE_MAP
      ? (runnerBody.error_type as RunnerErrorType)
      : "runtime";
    const { status, code } = ERROR_TYPE_MAP[errorType];
    const errorDetail = sanitizeStackTrace(
      runnerBody.stack as string | undefined ?? runnerBody.error,
    );

    emitEvent({
      event_type: "execute",
      skill_id: skillId,
      intent: null,
      latency_ms: latencyMs,
      confidence: skillConfidence,
      cache_hit: false,
      input_hash: inputHash,
      success: false,
    }).catch((e) =>
      console.warn("execute: emitEvent failed (swallowed):", e),
    );

    return error(
      status,
      code,
      runnerBody.error,
      errorDetail ? { error_detail: errorDetail } : undefined,
    );
  }

  // Successful execution
  const outputs = runnerBody;

  // Fire-and-forget: write cache if auto_cache
  if (autoCache) {
    writeCachedOutput({
      skill_id: skillId,
      input_hash: inputHash,
      version_number: versionNumber,
      output: outputs as Record<string, unknown>,
      input_snapshot: inputs as Record<string, unknown>,
    }).catch((e) =>
      console.warn("execute: writeCachedOutput failed (swallowed):", e),
    );
  }

  // Fire-and-forget: update execution count + latency EMA
  updateSkillStats(skillId, versionNumber, latencyMs, existingP50, existingP95).catch(
    (e) => console.warn("execute: updateSkillStats failed (swallowed):", e),
  );

  // Fire-and-forget: emit event
  emitEvent({
    event_type: "execute",
    skill_id: skillId,
    intent: null,
    latency_ms: latencyMs,
    confidence: skillConfidence,
    cache_hit: false,
    input_hash: inputHash,
    success: true,
  }).catch((e) =>
    console.warn("execute: emitEvent failed (swallowed):", e),
  );

  return success(200, {
    skill_id: skillId,
    outputs,
    cache_hit: false,
    latency_ms: latencyMs,
    execution_id: executionId,
    input_hash: inputHash,
    version: versionNumber,
  });
}
