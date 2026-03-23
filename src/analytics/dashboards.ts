/**
 * GET /analytics/dashboards/:type Lambda handler.
 *
 * Returns shaped analytics data for one of the 5 dashboard types.
 * Queries ClickHouse (stubbed until IMPL-08-D). Accepts optional `from`
 * and `to` ISO8601 query parameters; defaults to the last 24 hours.
 *
 * Dashboard types:
 *   resolve-performance  — routing latency, embedding search, high-confidence %
 *   execution-caching    — top skills, cache hit rates, execution latency
 *   skill-quality        — test pass rate, confidence, failure rate
 *   evolution-gap        — unresolved intents, low-confidence, domain gaps
 *   agent-behavior       — resolve→execute conversion, chaining patterns
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { DashboardTypeSchema } from "../shared/validation.js";
import { success, error } from "../shared/response.js";

// ---------------------------------------------------------------------------
// ClickHouse client stub
// TODO(IMPL-08-D): replace with real ClickHouse client import once IMPL-08-D
// is merged. The real client will be:
//   import { getClickHouseClient } from './clickhouseClient.js';
// ---------------------------------------------------------------------------

async function queryClickHouse(sql: string): Promise<unknown[]> {
  // Stub: returns empty array. Replaced when IMPL-08-D is merged.
  console.log("[dashboards] ClickHouse query (stub):", sql.slice(0, 200));
  return [];
}

// ---------------------------------------------------------------------------
// Query parameter schema
// ---------------------------------------------------------------------------

const QueryParamsSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Response type interfaces (per DESIGN-02)
// ---------------------------------------------------------------------------

interface ResolvePerformanceResponse {
  latency_p50_ms: number;
  latency_p95_ms: number;
  embedding_search_p50_ms: number;
  high_confidence_pct: number;
  total_resolves: number;
  period_hours: 24;
}

interface TopSkillEntry {
  skill_id: string;
  name: string;
  execution_count: number;
  cache_hit_rate: number;
  avg_latency_ms: number;
}

interface ExecutionCachingResponse {
  top_skills: TopSkillEntry[];
  overall_cache_hit_rate: number;
  total_executions: number;
  period_hours: 24;
}

interface SkillQualityEntry {
  skill_id: string;
  name: string;
  confidence: number;
  test_pass_rate: number;
  failure_rate: number;
  competing_implementations: number;
}

interface StatusDistribution {
  unsolved: number;
  partial: number;
  verified: number;
  optimized: number;
  archived: number;
}

interface SkillQualityResponse {
  skills: SkillQualityEntry[];
  status_distribution: StatusDistribution;
}

interface UnresolvedIntent {
  intent: string;
  miss_count: number;
  min_confidence: number;
  last_seen_at: string;
}

interface EvolutionGapResponse {
  unresolved_intents: UnresolvedIntent[];
  low_confidence_resolves: number;
  failed_executions_24h: number;
  domains_with_low_coverage: string[];
  skills_flagged_for_optimization: number;
}

interface ChainPattern {
  skills: string[];
  count: number;
}

interface AgentBehaviorResponse {
  resolve_to_execute_rate: number;
  repeated_resolve_rate: number;
  abandoned_execution_rate: number;
  chain_usage_rate: number;
  top_chain_patterns: ChainPattern[];
}

// ---------------------------------------------------------------------------
// Dashboard query functions
// ---------------------------------------------------------------------------

async function resolvePerformanceDashboard(
  from: string,
  to: string,
): Promise<ResolvePerformanceResponse> {
  // SQL 1a: routing latency p50/p95
  // SELECT
  //     quantile(0.5)(latency_ms)  AS p50_ms,
  //     quantile(0.95)(latency_ms) AS p95_ms,
  //     count() AS total_resolves
  // FROM analytics_events
  // WHERE event_type = 'resolve'
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  const latencyRows = await queryClickHouse(
    `SELECT quantile(0.5)(latency_ms) AS p50_ms, quantile(0.95)(latency_ms) AS p95_ms, count() AS total_resolves FROM analytics_events WHERE event_type = 'resolve' AND timestamp BETWEEN '${from}' AND '${to}'`,
  );

  // SQL 1b: high-confidence resolve percentage
  // SELECT
  //     countIf(confidence > 0.9) * 100.0 / count() AS high_confidence_pct
  // FROM analytics_events
  // WHERE event_type = 'resolve'
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  const confRows = await queryClickHouse(
    `SELECT countIf(confidence > 0.9) * 100.0 / count() AS high_confidence_pct FROM analytics_events WHERE event_type = 'resolve' AND timestamp BETWEEN '${from}' AND '${to}'`,
  );

  const latencyRow = (latencyRows[0] ?? {}) as Record<string, number>;
  const confRow = (confRows[0] ?? {}) as Record<string, number>;

  return {
    latency_p50_ms: latencyRow.p50_ms ?? 0,
    latency_p95_ms: latencyRow.p95_ms ?? 0,
    // Embedding search time is approximated by resolve latency (see DESIGN-02 §1b)
    embedding_search_p50_ms: latencyRow.p50_ms ?? 0,
    high_confidence_pct: confRow.high_confidence_pct ?? 0,
    total_resolves: latencyRow.total_resolves ?? 0,
    period_hours: 24,
  };
}

async function executionCachingDashboard(
  from: string,
  to: string,
): Promise<ExecutionCachingResponse> {
  // SQL 2a+2c+2d combined: most executed skills with cache hit rate and avg latency
  // SELECT
  //     skill_id,
  //     count() AS execution_count,
  //     countIf(cache_hit = 1) * 100.0 / count() AS cache_hit_rate,
  //     avg(latency_ms) AS avg_latency_ms
  // FROM analytics_events
  // WHERE event_type = 'execute'
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  // GROUP BY skill_id
  // ORDER BY execution_count DESC
  // LIMIT 20
  const topSkillRows = await queryClickHouse(
    `SELECT skill_id, count() AS execution_count, countIf(cache_hit = 1) * 100.0 / count() AS cache_hit_rate, avg(latency_ms) AS avg_latency_ms FROM analytics_events WHERE event_type = 'execute' AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY skill_id ORDER BY execution_count DESC LIMIT 20`,
  );

  // SQL 2c aggregate: overall cache hit rate and total executions
  // SELECT
  //     countIf(cache_hit = 1) * 100.0 / count() AS cache_hit_rate_pct,
  //     count() AS total_executions
  // FROM analytics_events
  // WHERE event_type = 'execute'
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  const overallRows = await queryClickHouse(
    `SELECT countIf(cache_hit = 1) * 100.0 / count() AS cache_hit_rate_pct, count() AS total_executions FROM analytics_events WHERE event_type = 'execute' AND timestamp BETWEEN '${from}' AND '${to}'`,
  );

  const overallRow = (overallRows[0] ?? {}) as Record<string, number>;

  const topSkills: TopSkillEntry[] = (
    topSkillRows as Array<Record<string, unknown>>
  ).map((row) => ({
    skill_id: String(row.skill_id ?? ""),
    name: String(row.name ?? ""),
    execution_count: Number(row.execution_count ?? 0),
    cache_hit_rate: Number(row.cache_hit_rate ?? 0),
    avg_latency_ms: Number(row.avg_latency_ms ?? 0),
  }));

  return {
    top_skills: topSkills,
    overall_cache_hit_rate: overallRow.cache_hit_rate_pct ?? 0,
    total_executions: overallRow.total_executions ?? 0,
    period_hours: 24,
  };
}

async function skillQualityDashboard(
  from: string,
  to: string,
): Promise<SkillQualityResponse> {
  // SQL 3a: test pass rate per skill
  // SELECT
  //     skill_id,
  //     countIf(success = 1) * 100.0 / count() AS pass_rate_pct,
  //     countIf(success = 0) * 100.0 / count() AS failure_rate_pct,
  //     avg(confidence) AS avg_confidence
  // FROM analytics_events
  // WHERE event_type = 'validate'
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  // GROUP BY skill_id
  // ORDER BY pass_rate_pct ASC
  const qualityRows = await queryClickHouse(
    `SELECT skill_id, countIf(success = 1) * 100.0 / count() AS pass_rate_pct, countIf(success = 0) * 100.0 / count() AS failure_rate_pct, avg(confidence) AS avg_confidence FROM analytics_events WHERE event_type = 'validate' AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY skill_id ORDER BY pass_rate_pct ASC`,
  );

  // SQL 3d: competing implementations (intents resolved to multiple skills)
  // SELECT
  //     skill_id,
  //     count(DISTINCT intent) AS competing_implementations
  // FROM analytics_events
  // WHERE event_type = 'resolve' AND success = 1
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  // GROUP BY skill_id
  const competingRows = await queryClickHouse(
    `SELECT skill_id, count(DISTINCT intent) AS competing_implementations FROM analytics_events WHERE event_type = 'resolve' AND success = 1 AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY skill_id`,
  );

  // Build a lookup from skill_id → competing_implementations count
  const competingMap = new Map<string, number>();
  for (const row of competingRows as Array<Record<string, unknown>>) {
    competingMap.set(
      String(row.skill_id ?? ""),
      Number(row.competing_implementations ?? 0),
    );
  }

  const skills: SkillQualityEntry[] = (
    qualityRows as Array<Record<string, unknown>>
  ).map((row) => {
    const skillId = String(row.skill_id ?? "");
    return {
      skill_id: skillId,
      name: String(row.name ?? ""),
      confidence: Number(row.avg_confidence ?? 0),
      test_pass_rate: Number(row.pass_rate_pct ?? 0),
      failure_rate: Number(row.failure_rate_pct ?? 0),
      competing_implementations: competingMap.get(skillId) ?? 0,
    };
  });

  // Status distribution: aggregate counts per status from DynamoDB would be
  // a separate query; ClickHouse does not store skill status. Return zeros
  // until a DynamoDB scan is wired (future IMPL).
  const statusDistribution: StatusDistribution = {
    unsolved: 0,
    partial: 0,
    verified: 0,
    optimized: 0,
    archived: 0,
  };

  return { skills, status_distribution: statusDistribution };
}

async function evolutionGapDashboard(
  from: string,
  to: string,
): Promise<EvolutionGapResponse> {
  // SQL 4a: unresolved intents (resolve success = 0)
  // SELECT
  //     intent,
  //     count() AS miss_count,
  //     min(confidence) AS min_confidence,
  //     max(timestamp) AS last_seen_at
  // FROM analytics_events
  // WHERE event_type = 'resolve' AND success = 0
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  // GROUP BY intent
  // ORDER BY miss_count DESC
  // LIMIT 100
  const unresolvedRows = await queryClickHouse(
    `SELECT intent, count() AS miss_count, min(confidence) AS min_confidence, max(timestamp) AS last_seen_at FROM analytics_events WHERE event_type = 'resolve' AND success = 0 AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY intent ORDER BY miss_count DESC LIMIT 100`,
  );

  // SQL 4b: count of low-confidence resolves (confidence < 0.7, success = 1)
  // SELECT count() AS low_confidence_resolves
  // FROM analytics_events
  // WHERE event_type = 'resolve' AND confidence < 0.7 AND success = 1
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  const lowConfRows = await queryClickHouse(
    `SELECT count() AS low_confidence_resolves FROM analytics_events WHERE event_type = 'resolve' AND confidence < 0.7 AND success = 1 AND timestamp BETWEEN '${from}' AND '${to}'`,
  );

  // SQL 4c: failed executions count
  // SELECT count() AS failed_executions
  // FROM analytics_events
  // WHERE event_type = 'execute' AND success = 0
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  const failedExecRows = await queryClickHouse(
    `SELECT count() AS failed_executions FROM analytics_events WHERE event_type = 'execute' AND success = 0 AND timestamp BETWEEN '${from}' AND '${to}'`,
  );

  // SQL 4d: domains with low coverage (unresolved or low-confidence)
  // SELECT extractTextBefore(intent, ':') AS domain
  // FROM analytics_events
  // WHERE event_type = 'resolve' AND (success = 0 OR confidence < 0.7)
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  // GROUP BY domain
  // ORDER BY count() DESC
  const domainRows = await queryClickHouse(
    `SELECT extractTextBefore(intent, ':') AS domain FROM analytics_events WHERE event_type = 'resolve' AND (success = 0 OR confidence < 0.7) AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY domain ORDER BY count() DESC`,
  );

  // SQL: skills flagged for optimization (latency p95 > 500ms, high usage)
  // SELECT count(DISTINCT skill_id) AS skills_flagged
  // FROM analytics_events
  // WHERE event_type = 'execute'
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  // GROUP BY skill_id
  // HAVING quantile(0.95)(latency_ms) > 500 AND count() > 100
  const flaggedRows = await queryClickHouse(
    `SELECT count() AS skills_flagged FROM (SELECT skill_id FROM analytics_events WHERE event_type = 'execute' AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY skill_id HAVING quantile(0.95)(latency_ms) > 500 AND count() > 100)`,
  );

  const unresolvedIntents: UnresolvedIntent[] = (
    unresolvedRows as Array<Record<string, unknown>>
  ).map((row) => ({
    intent: String(row.intent ?? ""),
    miss_count: Number(row.miss_count ?? 0),
    min_confidence: Number(row.min_confidence ?? 0),
    last_seen_at: String(row.last_seen_at ?? ""),
  }));

  const lowConfRow = (lowConfRows[0] ?? {}) as Record<string, number>;
  const failedRow = (failedExecRows[0] ?? {}) as Record<string, number>;
  const flaggedRow = (flaggedRows[0] ?? {}) as Record<string, number>;

  const domainsWithLowCoverage = (
    domainRows as Array<Record<string, unknown>>
  )
    .map((r) => String(r.domain ?? ""))
    .filter((d) => d.length > 0);

  return {
    unresolved_intents: unresolvedIntents,
    low_confidence_resolves: lowConfRow.low_confidence_resolves ?? 0,
    failed_executions_24h: failedRow.failed_executions ?? 0,
    domains_with_low_coverage: domainsWithLowCoverage,
    skills_flagged_for_optimization: flaggedRow.skills_flagged ?? 0,
  };
}

async function agentBehaviorDashboard(
  from: string,
  to: string,
): Promise<AgentBehaviorResponse> {
  // SQL 5a: resolve-to-execute conversion rate
  // SELECT
  //     countIf(event_type = 'resolve') AS total_resolves,
  //     countIf(event_type = 'execute') AS total_executes,
  //     countIf(event_type = 'execute') * 100.0
  //         / greatest(countIf(event_type = 'resolve'), 1) AS conversion_rate_pct
  // FROM analytics_events
  // WHERE event_type IN ('resolve', 'execute')
  //   AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
  const conversionRows = await queryClickHouse(
    `SELECT countIf(event_type = 'resolve') AS total_resolves, countIf(event_type = 'execute') AS total_executes, countIf(event_type = 'execute') * 100.0 / greatest(countIf(event_type = 'resolve'), 1) AS conversion_rate_pct FROM analytics_events WHERE event_type IN ('resolve', 'execute') AND timestamp BETWEEN '${from}' AND '${to}'`,
  );

  // SQL 5b: repeated resolves rate — intents resolved more than 3 times
  // SELECT
  //     count() AS repeated_intents,
  //     (SELECT count(DISTINCT intent) FROM analytics_events WHERE event_type = 'resolve' ...) AS total_intents
  // Simplified: fraction of intents that appear > 3 times
  // SELECT countIf(resolve_count > 3) * 100.0 / count() AS repeated_resolve_rate
  // FROM (SELECT intent, count() AS resolve_count FROM analytics_events
  //       WHERE event_type = 'resolve' AND timestamp BETWEEN ... GROUP BY intent)
  const repeatedRows = await queryClickHouse(
    `SELECT countIf(resolve_count > 3) * 100.0 / greatest(count(), 1) AS repeated_resolve_rate FROM (SELECT intent, count() AS resolve_count FROM analytics_events WHERE event_type = 'resolve' AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY intent)`,
  );

  // SQL 5c: abandoned execution rate — resolves not followed by execute
  // Approximation: intents with zero executions as a fraction of total resolved intents
  // SELECT
  //     countIf(execute_count = 0) * 100.0 / greatest(count(), 1) AS abandoned_rate
  // FROM (
  //   SELECT r.intent, coalesce(e.execute_count, 0) AS execute_count
  //   FROM (SELECT intent, count() AS resolve_count FROM analytics_events WHERE event_type = 'resolve' ...) r
  //   LEFT JOIN (SELECT intent, count() AS execute_count FROM analytics_events WHERE event_type = 'execute' ...) e ON r.intent = e.intent
  // )
  const abandonedRows = await queryClickHouse(
    `SELECT countIf(execute_count = 0) * 100.0 / greatest(count(), 1) AS abandoned_rate FROM (SELECT r.intent, coalesce(e.execute_count, 0) AS execute_count FROM (SELECT intent, count() AS resolve_count FROM analytics_events WHERE event_type = 'resolve' AND success = 1 AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY intent) r LEFT JOIN (SELECT intent, count() AS execute_count FROM analytics_events WHERE event_type = 'execute' AND timestamp BETWEEN '${from}' AND '${to}' GROUP BY intent) e ON r.intent = e.intent)`,
  );

  // SQL 5d: skill chaining patterns (skills frequently executed in sequence)
  // WITH ordered_executions AS (
  //   SELECT skill_id, leadInFrame(skill_id) OVER (ORDER BY timestamp ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS next_skill_id, ...
  //   FROM analytics_events WHERE event_type = 'execute' AND timestamp BETWEEN ...
  // )
  // SELECT skill_id AS from_skill, next_skill_id AS to_skill, count() AS chain_count
  // FROM ordered_executions
  // WHERE next_skill_id != '' AND next_timestamp - timestamp < 5 AND skill_id != next_skill_id
  // GROUP BY from_skill, to_skill HAVING chain_count >= 3 ORDER BY chain_count DESC LIMIT 50
  const chainRows = await queryClickHouse(
    `WITH ordered_executions AS (SELECT skill_id, leadInFrame(skill_id) OVER (ORDER BY timestamp ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS next_skill_id, leadInFrame(timestamp) OVER (ORDER BY timestamp ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS next_timestamp FROM analytics_events WHERE event_type = 'execute' AND timestamp BETWEEN '${from}' AND '${to}') SELECT skill_id AS from_skill, next_skill_id AS to_skill, count() AS chain_count FROM ordered_executions WHERE next_skill_id != '' AND next_timestamp - timestamp < 5 AND skill_id != next_skill_id GROUP BY from_skill, to_skill HAVING chain_count >= 3 ORDER BY chain_count DESC LIMIT 50`,
  );

  // Chain usage rate: fraction of execute events that are part of a chain sequence
  // SQL: ratio of chain executions to total executions
  // SELECT count() AS chain_executions FROM analytics_events
  // WHERE event_type = 'execute' AND intent LIKE 'chain:%' AND timestamp BETWEEN ...
  const chainUsageRows = await queryClickHouse(
    `SELECT count() AS chain_executions, (SELECT count() FROM analytics_events WHERE event_type = 'execute' AND timestamp BETWEEN '${from}' AND '${to}') AS total_executions FROM analytics_events WHERE event_type = 'execute' AND intent LIKE 'chain:%' AND timestamp BETWEEN '${from}' AND '${to}'`,
  );

  const conversionRow = (conversionRows[0] ?? {}) as Record<string, number>;
  const repeatedRow = (repeatedRows[0] ?? {}) as Record<string, number>;
  const abandonedRow = (abandonedRows[0] ?? {}) as Record<string, number>;
  const chainUsageRow = (chainUsageRows[0] ?? {}) as Record<string, number>;

  const topChainPatterns: ChainPattern[] = (
    chainRows as Array<Record<string, unknown>>
  ).map((row) => ({
    skills: [String(row.from_skill ?? ""), String(row.to_skill ?? "")],
    count: Number(row.chain_count ?? 0),
  }));

  const chainExecCount = chainUsageRow.chain_executions ?? 0;
  const totalExecCount = chainUsageRow.total_executions ?? 0;
  const chainUsageRate =
    totalExecCount > 0 ? (chainExecCount / totalExecCount) * 100 : 0;

  return {
    resolve_to_execute_rate: conversionRow.conversion_rate_pct ?? 0,
    repeated_resolve_rate: repeatedRow.repeated_resolve_rate ?? 0,
    abandoned_execution_rate: abandonedRow.abandoned_rate ?? 0,
    chain_usage_rate: chainUsageRate,
    top_chain_patterns: topChainPatterns,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const rawType = event.pathParameters?.type;

  // Validate dashboard type
  const typeValidation = DashboardTypeSchema.safeParse(rawType);
  if (!typeValidation.success) {
    return error(
      400,
      "VALIDATION_ERROR",
      `Unknown dashboard type: "${rawType}". Must be one of: resolve-performance, execution-caching, skill-quality, evolution-gap, agent-behavior`,
      { type: rawType },
    );
  }

  const dashboardType = typeValidation.data;

  // Parse optional time range query parameters
  const rawParams = {
    from: event.queryStringParameters?.from,
    to: event.queryStringParameters?.to,
  };

  const now = new Date();
  const defaultTo = now.toISOString();
  const defaultFrom = new Date(
    now.getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const paramsValidation = QueryParamsSchema.safeParse(rawParams);
  const fromTs = paramsValidation.success
    ? (paramsValidation.data.from ?? defaultFrom)
    : defaultFrom;
  const toTs = paramsValidation.success
    ? (paramsValidation.data.to ?? defaultTo)
    : defaultTo;

  try {
    let data: unknown;

    switch (dashboardType) {
      case "resolve-performance":
        data = await resolvePerformanceDashboard(fromTs, toTs);
        break;
      case "execution-caching":
        data = await executionCachingDashboard(fromTs, toTs);
        break;
      case "skill-quality":
        data = await skillQualityDashboard(fromTs, toTs);
        break;
      case "evolution-gap":
        data = await evolutionGapDashboard(fromTs, toTs);
        break;
      case "agent-behavior":
        data = await agentBehaviorDashboard(fromTs, toTs);
        break;
    }

    return success(200, {
      dashboard: dashboardType,
      from: fromTs,
      to: toTs,
      data,
    });
  } catch (err) {
    console.error(`[dashboards] Failed to query dashboard "${dashboardType}":`, err);
    return error(500, "INTERNAL_ERROR", "Failed to retrieve dashboard data");
  }
}
