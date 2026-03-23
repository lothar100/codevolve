/**
 * Lazy singleton Claude API client for the /evolve handler.
 *
 * The API key is retrieved from Secrets Manager on first call and then
 * cached for the lifetime of the Lambda container (warm starts re-use it).
 * This is the ONLY file in the codebase that constructs an Anthropic client —
 * all Claude API calls must go through src/evolve/.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const ANTHROPIC_SECRET_ARN = process.env.ANTHROPIC_SECRET_ARN ?? "";

let cachedClient: Anthropic | null = null;

/**
 * Return (or lazily initialize) the Anthropic client.
 *
 * On the first call in a cold start, fetches the API key from Secrets Manager.
 * On subsequent calls (warm start or within same invocation), returns the
 * cached instance immediately without hitting Secrets Manager.
 */
export async function getClaudeClient(): Promise<Anthropic> {
  if (cachedClient) return cachedClient;

  const sm = new SecretsManagerClient({});
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: ANTHROPIC_SECRET_ARN }),
  );

  const { api_key } = JSON.parse(secret.SecretString ?? "{}") as {
    api_key: string;
  };

  cachedClient = new Anthropic({ apiKey: api_key });
  return cachedClient;
}

/**
 * Override the cached client — used in unit tests only.
 * Pass `null` to reset (clears the cache so the next call re-initializes).
 */
export function _setClaudeClientForTesting(client: Anthropic | null): void {
  cachedClient = client;
}
