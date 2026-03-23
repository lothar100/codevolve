/**
 * ClickHouse client singleton for the analytics consumer.
 *
 * The client is initialized once at cold start by reading credentials from
 * AWS Secrets Manager, then cached in module scope for reuse across warm
 * invocations. `_setClickHouseClientForTesting` allows tests to inject a mock.
 */

import { createClient, ClickHouseClient } from "@clickhouse/client";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

export interface ClickHouseSecret {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

let cachedClient: ClickHouseClient | null = null;

async function loadSecret(): Promise<ClickHouseSecret> {
  const secretArn = process.env.CLICKHOUSE_SECRET_ARN;
  if (!secretArn) {
    throw new Error("CLICKHOUSE_SECRET_ARN env var is not set");
  }
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  return JSON.parse(response.SecretString ?? "{}") as ClickHouseSecret;
}

/**
 * Returns the singleton ClickHouse client. On the first call it fetches
 * credentials from Secrets Manager and creates the client. Subsequent calls
 * return the cached instance.
 *
 * If Secrets Manager is unreachable or the secret is malformed, this function
 * throws. The caller (consumer handler) must catch the error and mark all
 * batch records as failed.
 */
export async function getClickHouseClient(): Promise<ClickHouseClient> {
  if (cachedClient !== null) return cachedClient;

  const secret = await loadSecret();

  cachedClient = createClient({
    url: `${secret.host}:${secret.port}`,
    username: secret.username,
    password: secret.password,
    database: secret.database,
    request_timeout: 30_000,
    compression: { request: true },
  });

  return cachedClient;
}

/**
 * Replaces the cached client with the provided instance. Pass `null` to reset
 * the singleton so the next `getClickHouseClient()` call re-initializes it.
 *
 * ONLY for use in unit tests — never call this in production code.
 */
export function _setClickHouseClientForTesting(
  client: ClickHouseClient | null,
): void {
  cachedClient = client;
}
