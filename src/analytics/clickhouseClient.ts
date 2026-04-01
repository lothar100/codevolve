/**
 * ClickHouse client singleton for analytics queries.
 *
 * Connection configuration is read from environment variables so that
 * it can differ between stages (dev, staging, prod).
 *
 * This module is imported only by analytics read endpoints. It must never
 * be imported by primary system handlers (registry, router, execution)
 * because the analytics store must not be a dependency of the hot path.
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";

let _client: ClickHouseClient | null = null;

/**
 * Return the shared ClickHouse client, creating it on first call.
 * Uses a module-level singleton to reuse the connection across Lambda
 * warm invocations.
 */
export function getClickHouseClient(): ClickHouseClient {
  if (_client === null) {
    const host = process.env.CLICKHOUSE_HOST ?? "localhost";
    const port = process.env.CLICKHOUSE_PORT ?? "8123";
    const protocol = port === "8443" ? "https" : "http";
    const url = `${protocol}://${host}:${port}`;
    _client = createClient({
      url,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DATABASE ?? "default",
      request_timeout: 10_000, // 10s — dashboards must return fast
    });
  }
  return _client;
}

/**
 * Replace the singleton — intended for use in tests only.
 * Call with `null` to reset to the real client on the next call.
 */
export function _setClickHouseClientForTest(client: ClickHouseClient | null): void {
  _client = client;
}

/** Alias for _setClickHouseClientForTest — matches naming convention used in some test files. */
export const _setClickHouseClientForTesting = _setClickHouseClientForTest;
