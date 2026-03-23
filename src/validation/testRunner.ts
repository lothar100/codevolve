/**
 * Test runner for POST /validate/:skill_id — IMPL-11
 *
 * Invokes per-language runner Lambdas for each test case in a skill's test
 * suite, compares actual output to expected using deepEqual, and computes
 * aggregate latency percentiles.
 *
 * Rules:
 *   - Runner Lambda ARN is read from RUNNER_LAMBDA_PYTHON (python) or
 *     RUNNER_LAMBDA_NODE (javascript/typescript).
 *   - If the language is unsupported, throws an error with a 400-level message.
 *   - Timeout budget is enforced before each invocation: if
 *     (Date.now() - startMs) > timeoutMs, remaining tests are marked failed
 *     with error: "validation_timeout".
 *   - latencyP50Ms = median of per-test latencies.
 *   - latencyP95Ms = value at index Math.ceil(n * 0.95) - 1 in the sorted
 *     latency array (per §2.2 step 8).
 */

import {
  LambdaClient,
  InvokeCommand,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import type { Skill, SkillTest } from "../shared/types.js";
import { deepEqual } from "../shared/deepEqual.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TestResult {
  test_index: number;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  actual: Record<string, unknown> | null;
  passed: boolean;
  latency_ms: number;
  error: string | null;
}

export interface RunTestsResult {
  results: TestResult[];
  passCount: number;
  failCount: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

// ---------------------------------------------------------------------------
// Lambda client singleton
// ---------------------------------------------------------------------------

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

// ---------------------------------------------------------------------------
// Runner resolution
// ---------------------------------------------------------------------------

/**
 * Return the runner function name (ARN or name) for a given language.
 * Throws an error with a message suitable for a 400 response if unsupported.
 */
function getRunnerFunctionName(language: string): string {
  const lang = language.toLowerCase();

  if (lang === "python") {
    const fn = process.env.RUNNER_LAMBDA_PYTHON;
    if (!fn) {
      throw new Error(`RUNNER_LAMBDA_PYTHON environment variable is not set`);
    }
    return fn;
  }

  if (lang === "javascript" || lang === "typescript") {
    const fn = process.env.RUNNER_LAMBDA_NODE;
    if (!fn) {
      throw new Error(`RUNNER_LAMBDA_NODE environment variable is not set`);
    }
    return fn;
  }

  throw new Error(`Unsupported language for validation: ${language}`);
}

// ---------------------------------------------------------------------------
// Percentile helpers
// ---------------------------------------------------------------------------

function computeP50(sortedLatencies: number[]): number {
  const n = sortedLatencies.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return sortedLatencies[mid];
  }
  // Even length: average the two middle values.
  return (sortedLatencies[mid - 1] + sortedLatencies[mid]) / 2;
}

function computeP95(sortedLatencies: number[]): number {
  const n = sortedLatencies.length;
  if (n === 0) return 0;
  const index = Math.ceil(n * 0.95) - 1;
  return sortedLatencies[index];
}

// ---------------------------------------------------------------------------
// Runner invocation
// ---------------------------------------------------------------------------

interface RunnerPayload {
  implementation: string;
  language: string;
  inputs: Record<string, unknown>;
}

async function invokeRunnerForTest(
  functionName: string,
  payload: RunnerPayload,
): Promise<{ functionError?: string; payloadStr: string }> {
  const response: InvokeCommandOutput = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );

  const payloadBytes = response.Payload;
  const payloadStr = payloadBytes
    ? Buffer.from(payloadBytes).toString("utf8")
    : "{}";

  return {
    functionError: response.FunctionError,
    payloadStr,
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function runTests(
  skill: Skill,
  timeoutMs: number,
): Promise<RunTestsResult> {
  const functionName = getRunnerFunctionName(skill.language);
  const tests: SkillTest[] = skill.tests ?? [];

  const startMs = Date.now();
  const results: TestResult[] = [];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];

    // Check timeout budget BEFORE invoking the runner.
    if (Date.now() - startMs > timeoutMs) {
      // Mark this and all remaining tests as failed with timeout error.
      for (let j = i; j < tests.length; j++) {
        results.push({
          test_index: j,
          input: tests[j].input,
          expected: tests[j].expected,
          actual: null,
          passed: false,
          latency_ms: 0,
          error: "validation_timeout",
        });
      }
      break;
    }

    const testStart = Date.now();
    let actual: Record<string, unknown> | null = null;
    let passed = false;
    let errorMsg: string | null = null;

    try {
      const { functionError, payloadStr } = await invokeRunnerForTest(
        functionName,
        {
          implementation: skill.implementation,
          language: skill.language,
          inputs: test.input,
        },
      );

      const latencyMs = Date.now() - testStart;

      if (functionError) {
        // Lambda-level error (timeout, OOM, unhandled exception).
        let detail: string = functionError;
        try {
          const parsed = JSON.parse(payloadStr) as Record<string, unknown>;
          detail =
            (parsed.errorMessage as string | undefined) ??
            (parsed.error as string | undefined) ??
            functionError;
        } catch {
          // ignore parse failure
        }
        errorMsg = detail;
        passed = false;
      } else {
        // Parse the runner output.
        let runnerBody: Record<string, unknown>;
        try {
          runnerBody = JSON.parse(payloadStr) as Record<string, unknown>;
        } catch {
          errorMsg = "runner_returned_invalid_json";
          results.push({
            test_index: i,
            input: test.input,
            expected: test.expected,
            actual: null,
            passed: false,
            latency_ms: latencyMs,
            error: errorMsg,
          });
          continue;
        }

        // Check for runner-returned application-level error.
        if (
          typeof runnerBody.error === "string" ||
          typeof runnerBody.error_type === "string"
        ) {
          errorMsg =
            (runnerBody.error as string | undefined) ?? "runner_error";
          passed = false;
        } else {
          actual = runnerBody;
          passed = deepEqual(actual, test.expected);
          errorMsg = null;
        }
      }

      results.push({
        test_index: i,
        input: test.input,
        expected: test.expected,
        actual,
        passed,
        latency_ms: latencyMs,
        error: errorMsg,
      });
    } catch (invocationErr) {
      const latencyMs = Date.now() - testStart;
      const errMsg =
        invocationErr instanceof Error
          ? invocationErr.message
          : "runner_invocation_failed";
      results.push({
        test_index: i,
        input: test.input,
        expected: test.expected,
        actual: null,
        passed: false,
        latency_ms: latencyMs,
        error: errMsg,
      });
    }
  }

  // Compute aggregates.
  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.filter((r) => !r.passed).length;

  const sortedLatencies = results
    .map((r) => r.latency_ms)
    .sort((x, y) => x - y);

  const latencyP50Ms = computeP50(sortedLatencies);
  const latencyP95Ms = computeP95(sortedLatencies);

  return {
    results,
    passCount,
    failCount,
    latencyP50Ms,
    latencyP95Ms,
  };
}

export { lambdaClient };
