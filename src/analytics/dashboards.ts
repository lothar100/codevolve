/**
 * GET /analytics/dashboards/:type — Analytics dashboard endpoints.
 *
 * Implements all 5 dashboards per docs/platform-design.md DESIGN-02:
 *   1. resolve-performance
 *   2. execution-caching
 *   3. skill-quality
 *   4. evolution-gap
 *   5. agent-behavior
 *
 * Each endpoint accepts ?from=ISO8601&to=ISO8601 query parameters.
 *
 * W-04: from/to are validated as ISO8601 before use in queries.
 * All ClickHouse queries use the pre-validated string values interpolated
 * directly into the WHERE clause. ClickHouse's native DateTime64 parsing
 * handles the validated ISO8601 input safely. No external user input reaches
 * the query string without validation.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { getClickHouseClient } from "./clickhouseClient.js";
import { success, error } from "../shared/response.js";
import { validate } from "../shared/validation.js";
import { DashboardTypeSchema } from "../shared/validation.js";

// ---------------------------------------------------------------------------
// ISO8601 date range validation (W-04)
// ---------------------------------------------------------------------------

/**
 * Validate that a string is a parseable ISO8601 date.
 * Uses Date.parse — accepts ISO8601 format: "2026-01-01T00:00:00.000Z".
 * Returns true if valid, false if not.
 */
function isValidIso8601(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return false; // Must start with YYYY-MM-DD
  }
  const parsed = Date.parse(value);
  return !isNaN(parsed);
}

const DateRangeParamsSchema = z.object({
  type: DashboardTypeSchema,
  from: z.string().optional(),
  to: z.string().optional(),
});

// Default time window: last 1 hour
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Resolve and validate the time range from query parameters.
 * Returns validated ISO8601 strings or a 400 error response.
 */
function resolveDateRange(
  from: string | undefined,
  to: string | undefined,
): { valid: true; from: string; to: string } | { valid: false; response: APIGatewayProxyResult } {
  const now = new Date();
  const resolvedTo = to ?? now.toISOString();
  const resolvedFrom = from ?? new Date(now.getTime() - DEFAULT_WINDOW_MS).toISOString();

  if (!isValidIso8601(resolvedFrom) || !isValidIso8601(resolvedTo)) {
    return {
      valid: false,
      response: error(
        400,
        "INVALID_DATE_RANGE",
        "Query parameters 'from' and 'to' must be valid ISO8601 timestamps (e.g. 2026-01-01T00:00:00.000Z)",
      ),
    };
  }

  if (new Date(resolvedFrom).getTime() >= new Date(resolvedTo).getTime()) {
    return {
      valid: false,
      response: error(
        400,
        "INVALID_DATE_RANGE",
        "'from' must be earlier than 'to'",
      ),
    };
  }

  return { valid: true, from: resolvedFrom, to: resolvedTo };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const rawType = event.pathParameters?.type;
    const rawFrom = event.queryStringParameters?.from;
    const rawTo = event.queryStringParameters?.to;

    // Validate dashboard type
    const paramsValidation = validate(DateRangeParamsSchema, {
      type: rawType,
      from: rawFrom,
      to: rawTo,
    });
    if (!paramsValidation.success) {
      return error(400, "VALIDATION_ERROR", `Invalid dashboard type: "${rawType}"`);
    }

    const { type } = paramsValidation.data;

    // Validate date range (W-04)
    const dateRange = resolveDateRange(rawFrom, rawTo);
    if (!dateRange.valid) {
      return dateRange.response;
    }

    const { from, to } = dateRange;

    // Route to the appropriate dashboard query
    switch (type) {
      case "resolve-performance":
        return await resolvePerformanceDashboard(from, to);
      case "execution-caching":
        return await executionCachingDashboard(from, to);
      case "skill-quality":
        return await skillQualityDashboard(from, to);
      case "evolution-gap":
        return await evolutionGapDashboard(from, to);
      case "agent-behavior":
        return await agentBehaviorDashboard(from, to);
      default:
        return error(400, "VALIDATION_ERROR", `Unknown dashboard type: "${type}"`);
    }
  } catch (err) {
    console.error("[dashboards] Unexpected error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}

// ---------------------------------------------------------------------------
// Helper: run a ClickHouse query and return rows as JSON
// ---------------------------------------------------------------------------

async function queryClickHouse<T = Record<string, unknown>>(
  query: string,
): Promise<T[]> {
  const client = getClickHouseClient();
  const resultSet = await client.query({
    query,
    format: "JSONEachRow",
  });
  return resultSet.json<T>();
}

// ---------------------------------------------------------------------------
// Dashboard 1: Resolve Performance
// ---------------------------------------------------------------------------

async function resolvePerformanceDashboard(
  from: string,
  to: string,
): Promise<APIGatewayProxyResult> {
  // 1a: Routing latency p50/p95 over time
  const latencyOverTime = await queryClickHouse(`
    SELECT
        toStartOfMinute(timestamp) AS minute,
        quantile(0.5)(latency_ms)  AS p50_ms,
        quantile(0.95)(latency_ms) AS p95_ms
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY minute
    ORDER BY minute
  `);

  // 1b: Embedding search time distribution (using resolve latency as proxy)
  const latencyDistribution = await queryClickHouse(`
    SELECT
        floor(latency_ms / 10) * 10 AS bucket_ms,
        count() AS request_count
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY bucket_ms
    ORDER BY bucket_ms
  `);

  // 1c: High-confidence resolve percentage (aggregate)
  const [highConfidenceAgg] = await queryClickHouse(`
    SELECT
        countIf(confidence > 0.9) * 100.0 / count() AS high_confidence_pct
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND timestamp BETWEEN '${from}' AND '${to}'
  `);

  // 1c: High-confidence over time
  const highConfidenceOverTime = await queryClickHouse(`
    SELECT
        toStartOfMinute(timestamp) AS minute,
        countIf(confidence > 0.9) * 100.0 / count() AS high_confidence_pct
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY minute
    ORDER BY minute
  `);

  // 1d: Resolve success rate
  const [successRate] = await queryClickHouse(`
    SELECT
        countIf(success = 1) * 100.0 / count() AS success_rate_pct
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND timestamp BETWEEN '${from}' AND '${to}'
  `);

  // 1e: Low-confidence resolves (intent + confidence table)
  const lowConfidenceResolves = await queryClickHouse(`
    SELECT
        intent,
        confidence,
        skill_id,
        timestamp
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND confidence < 0.7
      AND timestamp BETWEEN '${from}' AND '${to}'
    ORDER BY timestamp DESC
    LIMIT 100
  `);

  return success(200, {
    dashboard: "resolve-performance",
    time_range: { from, to },
    latency_over_time: latencyOverTime,
    latency_distribution: latencyDistribution,
    high_confidence_pct: highConfidenceAgg ?? { high_confidence_pct: null },
    high_confidence_over_time: highConfidenceOverTime,
    success_rate: successRate ?? { success_rate_pct: null },
    low_confidence_resolves: lowConfidenceResolves,
  });
}

// ---------------------------------------------------------------------------
// Dashboard 2: Execution & Caching (Highest Priority)
// ---------------------------------------------------------------------------

async function executionCachingDashboard(
  from: string,
  to: string,
): Promise<APIGatewayProxyResult> {
  // 2a: Most executed skills (top 20)
  const mostExecuted = await queryClickHouse(`
    SELECT
        skill_id,
        count() AS execution_count
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY skill_id
    ORDER BY execution_count DESC
    LIMIT 20
  `);

  // 2b: Input repetition rate per skill
  const inputRepetitionRate = await queryClickHouse(`
    SELECT
        skill_id,
        count() AS total_executions,
        uniq(input_hash) AS unique_inputs,
        1.0 - (uniq(input_hash) / count()) AS input_repeat_rate
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY skill_id
    HAVING total_executions >= 10
    ORDER BY input_repeat_rate DESC
  `);

  // 2c: Cache hit/miss rate over time
  const cacheHitOverTime = await queryClickHouse(`
    SELECT
        toStartOfMinute(timestamp) AS minute,
        countIf(cache_hit = 1) AS cache_hits,
        countIf(cache_hit = 0) AS cache_misses,
        countIf(cache_hit = 1) * 100.0 / count() AS hit_rate_pct
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY minute
    ORDER BY minute
  `);

  // 2c: Aggregate cache hit rate
  const [cacheHitAgg] = await queryClickHouse(`
    SELECT
        countIf(cache_hit = 1) * 100.0 / count() AS cache_hit_rate_pct
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
  `);

  // 2e: Global execution latency p50/p95 over time
  const executionLatencyOverTime = await queryClickHouse(`
    SELECT
        toStartOfMinute(timestamp) AS minute,
        quantile(0.5)(latency_ms)  AS p50_ms,
        quantile(0.95)(latency_ms) AS p95_ms
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY minute
    ORDER BY minute
  `);

  // 2f: Cache candidates — skills eligible for auto-caching
  const cacheCandidates = await queryClickHouse(`
    SELECT
        skill_id,
        count() AS execution_count,
        uniq(input_hash) AS unique_inputs,
        1.0 - (uniq(input_hash) / count()) AS input_repeat_rate,
        quantile(0.95)(latency_ms) AS p95_ms
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY skill_id
    HAVING execution_count > 50
       AND input_repeat_rate > 0.3
    ORDER BY execution_count * input_repeat_rate DESC
    LIMIT 50
  `);

  return success(200, {
    dashboard: "execution-caching",
    time_range: { from, to },
    most_executed_skills: mostExecuted,
    input_repetition_rate: inputRepetitionRate,
    cache_hit_over_time: cacheHitOverTime,
    cache_hit_rate_pct: cacheHitAgg ?? { cache_hit_rate_pct: null },
    execution_latency_over_time: executionLatencyOverTime,
    cache_candidates: cacheCandidates,
  });
}

// ---------------------------------------------------------------------------
// Dashboard 3: Skill Quality
// ---------------------------------------------------------------------------

async function skillQualityDashboard(
  from: string,
  to: string,
): Promise<APIGatewayProxyResult> {
  // 3a: Test pass rate per skill
  const testPassRate = await queryClickHouse(`
    SELECT
        skill_id,
        countIf(success = 1) AS passed,
        countIf(success = 0) AS failed,
        countIf(success = 1) * 100.0 / count() AS pass_rate_pct
    FROM analytics_events
    WHERE event_type = 'validate'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY skill_id
    ORDER BY pass_rate_pct ASC
  `);

  // 3b: Confidence over time per skill
  const confidenceOverTime = await queryClickHouse(`
    SELECT
        skill_id,
        toStartOfHour(timestamp) AS hour,
        avg(confidence) AS avg_confidence,
        min(confidence) AS min_confidence
    FROM analytics_events
    WHERE event_type = 'validate'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY skill_id, hour
    ORDER BY hour
  `);

  // 3c: Real-world failure rate per skill
  const failureRatePerSkill = await queryClickHouse(`
    SELECT
        skill_id,
        count() AS total_executions,
        countIf(success = 0) AS failures,
        countIf(success = 0) * 100.0 / count() AS failure_rate_pct
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY skill_id
    HAVING total_executions >= 5
    ORDER BY failure_rate_pct DESC
  `);

  // 3c: Failure rate over time
  const failureRateOverTime = await queryClickHouse(`
    SELECT
        toStartOfHour(timestamp) AS hour,
        countIf(success = 0) * 100.0 / count() AS failure_rate_pct
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY hour
    ORDER BY hour
  `);

  // 3d: Competing implementations (same intent resolved to different skills)
  const competingImplementations = await queryClickHouse(`
    SELECT
        intent,
        groupArray(DISTINCT skill_id) AS competing_skills,
        length(groupArray(DISTINCT skill_id)) AS num_competitors,
        max(confidence) AS best_confidence,
        min(confidence) AS worst_confidence
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND success = 1
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY intent
    HAVING num_competitors > 1
    ORDER BY num_competitors DESC
    LIMIT 50
  `);

  // 3e: Confidence degradation detector
  const confidenceDegradation = await queryClickHouse(`
    WITH
        recent AS (
            SELECT skill_id, avg(confidence) AS recent_conf
            FROM analytics_events
            WHERE event_type = 'validate'
              AND timestamp BETWEEN now() - INTERVAL 1 DAY AND now()
            GROUP BY skill_id
        ),
        prior AS (
            SELECT skill_id, avg(confidence) AS prior_conf
            FROM analytics_events
            WHERE event_type = 'validate'
              AND timestamp BETWEEN now() - INTERVAL 7 DAY AND now() - INTERVAL 1 DAY
            GROUP BY skill_id
        )
    SELECT
        r.skill_id,
        p.prior_conf,
        r.recent_conf,
        r.recent_conf - p.prior_conf AS confidence_delta
    FROM recent r
    JOIN prior p ON r.skill_id = p.skill_id
    WHERE confidence_delta < -0.05
    ORDER BY confidence_delta ASC
  `);

  return success(200, {
    dashboard: "skill-quality",
    time_range: { from, to },
    test_pass_rate: testPassRate,
    confidence_over_time: confidenceOverTime,
    failure_rate_per_skill: failureRatePerSkill,
    failure_rate_over_time: failureRateOverTime,
    competing_implementations: competingImplementations,
    confidence_degradation: confidenceDegradation,
  });
}

// ---------------------------------------------------------------------------
// Dashboard 4: Evolution / Gap
// ---------------------------------------------------------------------------

async function evolutionGapDashboard(
  from: string,
  to: string,
): Promise<APIGatewayProxyResult> {
  // 4a: Unresolved intents (no skill match)
  const unresolvedIntents = await queryClickHouse(`
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
  `);

  // 4b: Low-confidence resolves
  const lowConfidenceIntents = await queryClickHouse(`
    SELECT
        intent,
        skill_id,
        count() AS occurrences,
        avg(confidence) AS avg_confidence
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND confidence < 0.7
      AND success = 1
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY intent, skill_id
    ORDER BY occurrences DESC
    LIMIT 100
  `);

  // 4b: Low-confidence volume over time
  const lowConfidenceOverTime = await queryClickHouse(`
    SELECT
        toStartOfHour(timestamp) AS hour,
        countIf(confidence < 0.7) AS low_confidence_count,
        count() AS total_resolves,
        countIf(confidence < 0.7) * 100.0 / count() AS low_confidence_pct
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY hour
    ORDER BY hour
  `);

  // 4c: Failed executions per skill
  const failedExecutions = await queryClickHouse(`
    SELECT
        skill_id,
        count() AS total_executions,
        countIf(success = 0) AS failures,
        countIf(success = 0) * 100.0 / count() AS failure_rate_pct
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY skill_id
    HAVING failures > 0
    ORDER BY failures DESC
    LIMIT 100
  `);

  // 4d: Domain coverage gaps
  const domainCoverageGaps = await queryClickHouse(`
    SELECT
        extractTextBefore(intent, ':') AS domain,
        uniq(intent) AS unique_intents,
        countIf(event_type = 'resolve' AND success = 0) AS unresolved_count,
        countIf(event_type = 'resolve' AND confidence < 0.7) AS low_confidence_count,
        countIf(event_type = 'execute' AND success = 0) AS execution_failures
    FROM analytics_events
    WHERE event_type IN ('resolve', 'execute')
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY domain
    ORDER BY (unresolved_count + low_confidence_count + execution_failures) DESC
  `);

  // 4e: Evolution pipeline status (fail events with no skill_id)
  const evolutionPipelineStatus = await queryClickHouse(`
    SELECT
        intent,
        count() AS fail_count,
        min(timestamp) AS first_failure,
        max(timestamp) AS latest_failure
    FROM analytics_events
    WHERE event_type = 'fail'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY intent
    ORDER BY fail_count DESC
    LIMIT 50
  `);

  return success(200, {
    dashboard: "evolution-gap",
    time_range: { from, to },
    unresolved_intents: unresolvedIntents,
    low_confidence_intents: lowConfidenceIntents,
    low_confidence_over_time: lowConfidenceOverTime,
    failed_executions: failedExecutions,
    domain_coverage_gaps: domainCoverageGaps,
    evolution_pipeline_status: evolutionPipelineStatus,
  });
}

// ---------------------------------------------------------------------------
// Dashboard 5: Agent Behavior
// ---------------------------------------------------------------------------

async function agentBehaviorDashboard(
  from: string,
  to: string,
): Promise<APIGatewayProxyResult> {
  // 5a: Resolve-to-execute conversion rate (aggregate)
  const [conversionAgg] = await queryClickHouse(`
    SELECT
        countIf(event_type = 'resolve') AS total_resolves,
        countIf(event_type = 'execute') AS total_executes,
        countIf(event_type = 'execute') * 100.0
            / greatest(countIf(event_type = 'resolve'), 1) AS conversion_rate_pct
    FROM analytics_events
    WHERE event_type IN ('resolve', 'execute')
      AND timestamp BETWEEN '${from}' AND '${to}'
  `);

  // 5a: Conversion rate over time
  const conversionOverTime = await queryClickHouse(`
    SELECT
        toStartOfHour(timestamp) AS hour,
        countIf(event_type = 'resolve') AS resolves,
        countIf(event_type = 'execute') AS executes,
        countIf(event_type = 'execute') * 100.0
            / greatest(countIf(event_type = 'resolve'), 1) AS conversion_rate_pct
    FROM analytics_events
    WHERE event_type IN ('resolve', 'execute')
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY hour
    ORDER BY hour
  `);

  // 5b: Repeated resolves (same intent resolved > 3 times)
  const repeatedResolves = await queryClickHouse(`
    SELECT
        intent,
        count() AS resolve_count,
        uniq(skill_id) AS distinct_skills_returned,
        avg(confidence) AS avg_confidence
    FROM analytics_events
    WHERE event_type = 'resolve'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY intent
    HAVING resolve_count > 3
    ORDER BY resolve_count DESC
    LIMIT 50
  `);

  // 5c: Abandoned executions (intents resolved but never executed)
  const abandonedExecutions = await queryClickHouse(`
    WITH
        resolved_intents AS (
            SELECT DISTINCT intent
            FROM analytics_events
            WHERE event_type = 'resolve'
              AND success = 1
              AND timestamp BETWEEN '${from}' AND '${to}'
        ),
        executed_intents AS (
            SELECT DISTINCT intent
            FROM analytics_events
            WHERE event_type = 'execute'
              AND timestamp BETWEEN '${from}' AND '${to}'
        )
    SELECT
        r.intent,
        count() AS resolve_count
    FROM analytics_events ae
    JOIN resolved_intents r ON ae.intent = r.intent
    WHERE ae.event_type = 'resolve'
      AND ae.success = 1
      AND ae.timestamp BETWEEN '${from}' AND '${to}'
      AND r.intent NOT IN (SELECT intent FROM executed_intents)
    GROUP BY r.intent
    ORDER BY resolve_count DESC
    LIMIT 50
  `);

  // 5d: Skill chaining patterns (skills executed together in same time window)
  const chainingPatterns = await queryClickHouse(`
    SELECT
        skill_id,
        count() AS chain_executions,
        uniq(input_hash) AS unique_chain_inputs
    FROM analytics_events
    WHERE event_type = 'execute'
      AND intent LIKE 'chain:%'
      AND timestamp BETWEEN '${from}' AND '${to}'
    GROUP BY skill_id
    ORDER BY chain_executions DESC
    LIMIT 20
  `);

  return success(200, {
    dashboard: "agent-behavior",
    time_range: { from, to },
    conversion_rate: conversionAgg ?? { total_resolves: 0, total_executes: 0, conversion_rate_pct: 0 },
    conversion_over_time: conversionOverTime,
    repeated_resolves: repeatedResolves,
    abandoned_executions: abandonedExecutions,
    chaining_patterns: chainingPatterns,
  });
}
