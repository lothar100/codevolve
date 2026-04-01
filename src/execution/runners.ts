/**
 * Language-to-runner mapping and Lambda InvokeCommand wrapper.
 *
 * Supported languages: python, javascript.
 * All other languages return a typed UnsupportedLanguageError.
 */

import {
  LambdaClient,
  InvokeCommand,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";

// ---------------------------------------------------------------------------
// Runner map
// ---------------------------------------------------------------------------

const RUNNER_MAP: Record<string, string | undefined> = {
  python: process.env.RUNNER_LAMBDA_PYTHON,
  javascript: process.env.RUNNER_LAMBDA_NODE,
  typescript: process.env.RUNNER_LAMBDA_NODE,
};

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunnerPayload {
  implementation: string;
  language: string;
  inputs: Record<string, unknown>;
  timeout_ms: number;
}

export interface RunnerResult {
  functionError?: string;
  payload: string;
}

export interface UnsupportedLanguageError {
  type: "UNSUPPORTED_LANGUAGE";
  language: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Look up the runner Lambda function name for a given language.
 * Returns UnsupportedLanguageError if the language is not mapped or has no env var.
 */
export function getRunnerFunctionName(
  language: string,
): string | UnsupportedLanguageError {
  const fn = RUNNER_MAP[language.toLowerCase()];
  if (!fn) {
    return { type: "UNSUPPORTED_LANGUAGE", language };
  }
  return fn;
}

/**
 * Invoke a runner Lambda synchronously and return the raw response.
 */
export async function invokeRunner(
  functionName: string,
  payload: RunnerPayload,
): Promise<RunnerResult> {
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
    payload: payloadStr,
  };
}

export { lambdaClient };
