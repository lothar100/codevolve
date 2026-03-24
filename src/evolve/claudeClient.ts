/**
 * Lazy singleton Claude API client for the /evolve handler.
 *
 * The Anthropic API key is retrieved from Secrets Manager on the first call
 * and cached in module scope for the lifetime of the Lambda container.
 * Warm starts reuse the cached client without a Secrets Manager round-trip.
 *
 * Architecture constraint: this is the ONLY file in the codebase that
 * constructs an Anthropic client. All Claude API calls must route through
 * src/evolve/.
 *
 * Secret format expected in Secrets Manager:
 *   { "api_key": "sk-ant-..." }
 *
 * Environment variables:
 *   ANTHROPIC_SECRET_ARN — ARN of the Secrets Manager secret (required in prod)
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// ARN of the Secrets Manager secret that holds { "api_key": "..." }.
// Defaults to the well-known name used in the CDK stack.
const ANTHROPIC_SECRET_ARN =
  process.env.ANTHROPIC_SECRET_ARN ?? "codevolve/anthropic-api-key";

// Module-scoped singleton — reused across warm invocations.
let cachedClient: Anthropic | null = null;

/**
 * Return (or lazily initialize) the Anthropic client.
 *
 * On the first call in a cold start, fetches the API key from Secrets Manager.
 * On subsequent calls (warm start or within the same invocation), returns the
 * cached instance immediately without hitting Secrets Manager.
 *
 * @throws If Secrets Manager is unreachable or the secret is malformed.
 */
export async function getAnthropicClient(): Promise<Anthropic> {
  if (cachedClient !== null) return cachedClient;

  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? "us-east-2",
  });

  const response = await sm.send(
    new GetSecretValueCommand({ SecretId: ANTHROPIC_SECRET_ARN }),
  );

  const secretString = response.SecretString;
  if (!secretString) {
    throw new Error(
      `[claudeClient] Secrets Manager returned empty SecretString for ${ANTHROPIC_SECRET_ARN}`,
    );
  }

  const parsed = JSON.parse(secretString) as { api_key?: string };
  if (!parsed.api_key) {
    throw new Error(
      `[claudeClient] Secret ${ANTHROPIC_SECRET_ARN} is missing required "api_key" field`,
    );
  }

  cachedClient = new Anthropic({ apiKey: parsed.api_key });
  return cachedClient;
}

/**
 * Override the cached client — used in unit tests only.
 * Pass `null` to reset so the next call re-initializes from Secrets Manager.
 */
export function _setAnthropicClientForTesting(
  client: Anthropic | null,
): void {
  cachedClient = client;
}

/** Alias for _setAnthropicClientForTesting — used in evolve handler tests. */
export const _setClaudeClientForTesting = _setAnthropicClientForTesting;
