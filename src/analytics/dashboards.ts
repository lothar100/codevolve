import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  getClickHouseClient,
  _setClickHouseClientForTesting,
} from "./clickhouseClient.js";
import { DASHBOARD_TYPES, type DashboardType } from "../shared/types.js";
import { success, error } from "../shared/response.js";

export { _setClickHouseClientForTesting };

// ---------------------------------------------------------------------------
// Time range helpers
// ---------------------------------------------------------------------------

const DEFAULT_FROM_OFFSET_MS = 60 * 60 * 1000; // 1 hour

function resolveTimeRange(
  fromParam: string | undefined,
  toParam: string | undefined,
): { from: string; to: string } {
  const to = toParam ?? new Date().toISOString();
  const from =
    fromParam ?? new Date(new Date(to).getTime() - DEFAULT_FROM_OFFSET_MS).toISOString();
  return { from, to };
}

// ---------------------------------------------------------------------------
// ClickHouse query helper
// ---------------------------------------------------------------------------

async function queryClickHouse(sql: string): Promise<unknown[]> {
  const client = await getClickHouseClient();
  const resultSet = await client.query({ query: sql, format: "JSONEachRow" });
  return resultSet.json<unknown>();
}

// ---------------------------------------------------------------------------
// Per-dashboard SQL builders
// ---------------------------------------------------------------------------

function buildResolvePerformanceSql(from: string, to: string): string {
  return `
SELECT
    toStartOfMinute(timestamp) AS minute,
    quantile(0.5)(latency_ms)  AS p50_ms,
    quantile(0.95)(latency_ms) AS p95_ms,
    countIf(confidence > 0.9) * 100.0 / count() AS high_confidence_pct,
    countIf(success = 1) * 100.0 / count() AS success_rate_pct,
    count() AS total_resolves
FROM analytics_events
WHERE event_type = 'resolve'
  AND timestamp BETWEEN '${from}' AND '${to}'
GROUP BY minute
ORDER BY minute
  `.trim();
}

function buildExecutionCachingSql(from: string, to: string): string {
  return `
SELECT
    skill_id,
    count() AS execution_count,
    uniq(input_hash) AS unique_inputs,
    1.0 - (toFloat64(uniq(input_hash)) / count()) AS input_repeat_rate,
    countIf(cache_hit = 1) * 100.0 / count() AS cache_hit_rate_pct,
    quantile(0.5)(latency_ms)  AS p50_ms,
    quantile(0.95)(latency_ms) AS p95_ms
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN '${from}' AND '${to}'
GROUP BY skill_id
ORDER BY execution_count DESC
LIMIT 20
  `.trim();
}

function buildSkillQualitySql(from: string, to: string): string {
  return `
SELECT
    skill_id,
    countIf(success = 1) AS passed,
    countIf(success = 0) AS failed,
    countIf(success = 1) * 100.0 / count() AS pass_rate_pct,
    avg(confidence) AS avg_confidence,
    count() AS total_validations
FROM analytics_events
WHERE event_type = 'validate'
  AND timestamp BETWEEN '${from}' AND '${to}'
GROUP BY skill_id
ORDER BY pass_rate_pct ASC
  `.trim();
}

function buildEvolutionGapSql(from: string, to: string): string {
  return `
SELECT
    intent,
    count() AS occurrences,
    min(timestamp) AS first_seen,
    max(timestamp) AS last_seen
FROM analytics_events
WHERE event_type = 'resolve'
  AND success = 0
  AND timestamp BETWEEN '${from}' AND '${to}'
GROUP BY intent
ORDER BY occurrences DESC
LIMIT 100
  `.trim();
}

function buildAgentBehaviorSql(from: string, to: string): string {
  return `
SELECT
    toStartOfHour(timestamp) AS hour,
    countIf(event_type = 'resolve') AS resolve_count,
    countIf(event_type = 'execute') AS execute_count,
    countIf(event_type = 'execute') * 100.0 / nullIf(countIf(event_type = 'resolve'), 0) AS resolve_to_execute_pct,
    countIf(event_type = 'fail') AS fail_count
FROM analytics_events
WHERE event_type IN ('resolve', 'execute', 'fail')
  AND timestamp BETWEEN '${from}' AND '${to}'
GROUP BY hour
ORDER BY hour
  `.trim();
}

const SQL_BUILDERS: Record<
  DashboardType,
  (from: string, to: string) => string
> = {
  "resolve-performance": buildResolvePerformanceSql,
  "execution-caching": buildExecutionCachingSql,
  "skill-quality": buildSkillQualitySql,
  "evolution-gap": buildEvolutionGapSql,
  "agent-behavior": buildAgentBehaviorSql,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const dashboardType = event.pathParameters?.type;

  if (
    !dashboardType ||
    !DASHBOARD_TYPES.includes(dashboardType as DashboardType)
  ) {
    return error(
      400,
      "INVALID_DASHBOARD_TYPE",
      `Dashboard type must be one of: ${DASHBOARD_TYPES.join(", ")}`,
    );
  }

  const type = dashboardType as DashboardType;
  const fromParam = event.queryStringParameters?.from;
  const toParam = event.queryStringParameters?.to;
  const { from, to } = resolveTimeRange(fromParam, toParam);

  const sql = SQL_BUILDERS[type](from, to);

  let rows: unknown[];
  try {
    rows = await queryClickHouse(sql);
  } catch (err) {
    console.error("[dashboards] ClickHouse query failed:", err);
    return error(500, "QUERY_ERROR", "Failed to query analytics data");
  }

  return success(200, {
    dashboard: type,
    from,
    to,
    rows,
  });
}
