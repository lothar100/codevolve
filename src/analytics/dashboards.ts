import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { success, error } from "../shared/response.js";
import { validate, DashboardTypeSchema } from "../shared/validation.js";
import {
  ANALYTICS_BUCKETS_TABLE,
  ANALYTICS_INPUT_STATE_TABLE,
  ANALYTICS_INTENT_SUMMARIES_TABLE,
  ANALYTICS_RECENT_FEEDS_TABLE,
  docClient,
  PROBLEMS_TABLE,
  SKILLS_TABLE,
} from "../shared/dynamo.js";

type Row = Record<string, unknown>;
type DominantStatus = "unsolved" | "partial" | "verified" | "optimized";
type Difficulty = "easy" | "medium" | "hard";

const STATUS_ORDER: DominantStatus[] = ["optimized", "verified", "partial", "unsolved"];
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_CANDIDATE_MIN_INTENTS = 50;
const CACHE_CANDIDATE_MIN_REPEAT_RATE = 0.3;

interface RepetitionSummary {
  skill_id: string;
  total_intents: number;
  unique_inputs: number;
  repeated_intents: number;
  input_repeat_rate_pct: number;
}

const ParamsSchema = z.object({
  type: DashboardTypeSchema,
  from: z.string().optional(),
  to: z.string().optional(),
});

const s = (r: Row, k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
const n = (r: Row, k: string) => {
  const v = r[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const p = Number(v);
    if (!Number.isNaN(p)) return p;
  }
  return 0;
};
const arr = (r: Row, k: string) =>
  Array.isArray(r[k]) ? (r[k] as unknown[]).filter((v): v is string => typeof v === "string") : [];
const setArr = (r: Row, k: string) =>
  r[k] instanceof Set ? [...(r[k] as Set<unknown>)].filter((v): v is string => typeof v === "string") : arr(r, k);
const ms = (v: string) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

function iso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

function range(
  event: APIGatewayProxyEvent,
  from?: string,
  to?: string,
) {
  const now = new Date();
  const resolvedTo = to ?? now.toISOString();
  const resolvedFrom = from ?? new Date(now.getTime() - DEFAULT_WINDOW_MS).toISOString();
  if (!iso(resolvedFrom) || !iso(resolvedTo)) {
    return {
      ok: false as const,
      response: error(
        400,
        "INVALID_DATE_RANGE",
        "Query parameters 'from' and 'to' must be valid ISO8601 timestamps (e.g. 2026-01-01T00:00:00.000Z)",
        undefined,
        event,
      ),
    };
  }
  if (Date.parse(resolvedFrom) >= Date.parse(resolvedTo)) {
    return {
      ok: false as const,
      response: error(
        400,
        "INVALID_DATE_RANGE",
        "'from' must be earlier than 'to'",
        undefined,
        event,
      ),
    };
  }
  return { ok: true as const, from: resolvedFrom, to: resolvedTo };
}

function analyticsUnavailable(err: unknown) {
  if (err == null || typeof err !== "object") return false;
  const name = "name" in err && typeof err.name === "string" ? err.name : "";
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  return name === "ResourceNotFoundException" || name === "AccessDeniedException" || /table.*not found|analytics.*unavailable/i.test(message);
}

function degraded(
  event: APIGatewayProxyEvent,
  type: z.infer<typeof DashboardTypeSchema>,
  from: string,
  to: string,
): APIGatewayProxyResult {
  const base = { degraded: true, degraded_reason: "analytics_unavailable", time_range: { from, to } };
  if (type === "resolve-performance" || type === "intent-performance") {
    return success(200, {
      dashboard: "resolve-performance",
      ...base,
      latency_over_time: [],
      latency_histogram: [],
      high_confidence_pct: 0,
      high_confidence_over_time: [],
      success_rate_pct: 0,
      low_confidence_resolves: [],
    }, event);
  }
  if (type === "execution-caching") return success(200, { dashboard: type, ...base, top_skills: [], repetition_rates: [], repetition_rate_over_time: [], intent_repetition_rate_pct: 0, execution_latency_over_time: [], cache_candidates: [] }, event);
  if (type === "skill-quality") return success(200, { dashboard: type, ...base, test_pass_rates: [], confidence_over_time: [], failure_rates: [], competing_implementations: [], confidence_degradation: [] }, event);
  if (type === "evolution-gap") return success(200, { dashboard: type, ...base, unresolved_intents: [], low_confidence_intents: [], low_confidence_volume: [], failed_executions: [], domain_coverage_gaps: [], evolve_pipeline: [] }, event);
  return success(200, { dashboard: type, ...base, total_resolves: 0, total_executes: 0, conversion_rate_pct: 0, conversion_over_time: [], repeated_resolves: [], abandoned_executions: [], skill_chain_patterns: [], hourly_usage: [] }, event);
}

async function scanAll(TableName: string) {
  const items: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await docClient.send(new ScanCommand({ TableName, ExclusiveStartKey }));
    items.push(...((out.Items ?? []) as Row[]));
    ExclusiveStartKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey !== undefined);
  return items;
}

const latency = (r: Row) =>
  Object.entries(r)
    .filter(([k]) => /^latency_bucket_\d+_count$/.test(k))
    .map(([k, v]) => ({ start: Number(k.slice("latency_bucket_".length, -"_count".length)), count: typeof v === "number" ? v : Number(v ?? 0) }))
    .filter((b) => b.count > 0)
    .sort((a, b) => a.start - b.start);

function pct(buckets: Array<{ start: number; count: number }>, q: number) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total <= 0) return 0;
  const target = total * q;
  let running = 0;
  for (const bucket of buckets) {
    running += bucket.count;
    if (running >= target) return bucket.start;
  }
  return buckets[buckets.length - 1]?.start ?? 0;
}

function bucketRows(rows: Row[], granularity: string, eventType: string, scope: string) {
  return rows.filter((r) => s(r, "granularity") === granularity && s(r, "event_type") === eventType && s(r, "scope_type") === scope).sort((a, b) => s(a, "bucket_start").localeCompare(s(b, "bucket_start")));
}

function mergeIntentRows(rows: Row[]) {
  const map = new Map<string, Row>();
  for (const row of rows) {
    const intent = s(row, "intent");
    const existing = map.get(intent);
    if (!existing) {
      map.set(intent, {
        intent,
        domain: s(row, "domain"),
        first_seen_at: s(row, "first_seen_at"),
        last_seen_at: s(row, "last_seen_at"),
        last_skill_id: s(row, "last_skill_id"),
        last_confidence: n(row, "last_confidence"),
        resolve_count: n(row, "resolve_count"),
        resolve_failure_count: n(row, "resolve_failure_count"),
        low_confidence_resolve_count: n(row, "low_confidence_resolve_count"),
        fail_count: n(row, "fail_count"),
        distinct_skill_ids: new Set(setArr(row, "distinct_skill_ids")),
      });
      continue;
    }
    existing.first_seen_at = [s(existing, "first_seen_at"), s(row, "first_seen_at")].filter(Boolean).sort()[0] ?? "";
    existing.last_seen_at = [s(existing, "last_seen_at"), s(row, "last_seen_at")].filter(Boolean).sort().at(-1) ?? "";
    existing.last_skill_id = s(row, "last_seen_at") >= s(existing, "last_seen_at") ? s(row, "last_skill_id") : s(existing, "last_skill_id");
    existing.last_confidence = s(row, "last_seen_at") >= s(existing, "last_seen_at") ? n(row, "last_confidence") : n(existing, "last_confidence");
    existing.resolve_count = n(existing, "resolve_count") + n(row, "resolve_count");
    existing.resolve_failure_count = n(existing, "resolve_failure_count") + n(row, "resolve_failure_count");
    existing.low_confidence_resolve_count =
      n(existing, "low_confidence_resolve_count") + n(row, "low_confidence_resolve_count");
    existing.fail_count = n(existing, "fail_count") + n(row, "fail_count");
    const mergedSkills = new Set([...setArr(existing, "distinct_skill_ids"), ...setArr(row, "distinct_skill_ids")]);
    existing.distinct_skill_ids = mergedSkills;
  }
  return [...map.values()];
}

function aggregate(rows: Row[]) {
  const hist = new Map<number, number>();
  let total = 0, successCount = 0, failureCount = 0, confidenceCount = 0, high = 0, low = 0, confidenceSum = 0, repeated = 0;
  for (const row of rows) {
    total += n(row, "total_count");
    successCount += n(row, "success_count");
    failureCount += n(row, "failure_count");
    confidenceCount += n(row, "confidence_count");
    high += n(row, "confidence_high_count");
    low += n(row, "confidence_low_count");
    confidenceSum += n(row, "confidence_sum");
    repeated += n(row, "repeated_input_count");
    for (const b of latency(row)) hist.set(b.start, (hist.get(b.start) ?? 0) + b.count);
  }
  return { total, successCount, failureCount, confidenceCount, high, low, confidenceSum, repeated, hist: [...hist.entries()].map(([start, count]) => ({ start, count })).sort((a, b) => a.start - b.start) };
}

async function loadTables(from: string, to: string) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const [buckets, intents, feeds, inputs] = await Promise.all([
    scanAll(ANALYTICS_BUCKETS_TABLE),
    scanAll(ANALYTICS_INTENT_SUMMARIES_TABLE),
    scanAll(ANALYTICS_RECENT_FEEDS_TABLE),
    scanAll(ANALYTICS_INPUT_STATE_TABLE),
  ]);
  return {
    buckets: buckets.filter((r) => {
      const t = ms(s(r, "bucket_start"));
      return t != null && t >= fromMs && t <= toMs;
    }),
    intents: intents.filter((r) => {
      const t = ms(s(r, "window_start"));
      return t != null && t >= fromMs && t <= toMs;
    }),
    feeds: feeds.filter((r) => {
      const t = ms(s(r, "timestamp"));
      return t != null && t >= fromMs && t <= toMs;
    }),
    inputs: inputs.filter((r) => {
      const t = ms(s(r, "last_seen_at"));
      return t != null && t >= fromMs && t <= toMs;
    }),
  };
}

function repetition(rows: Row[]): RepetitionSummary[] {
  const map = new Map<string, { total: number; unique: number; repeated: number }>();
  for (const row of rows) {
    const pk = s(row, "pk");
    if (!pk.startsWith("skill#")) continue;
    const skill_id = pk.slice("skill#".length);
    const current = map.get(skill_id) ?? { total: 0, unique: 0, repeated: 0 };
    current.total += n(row, "seen_count");
    current.unique += 1;
    current.repeated += n(row, "repeated_24h_count");
    map.set(skill_id, current);
  }
  return [...map.entries()].map(([skill_id, v]) => ({ skill_id, total_intents: v.total, unique_inputs: v.unique, repeated_intents: v.repeated, input_repeat_rate_pct: v.total > 0 ? (v.repeated * 100) / v.total : 0 })).sort((a, b) => b.input_repeat_rate_pct - a.input_repeat_rate_pct);
}

function skillResolveRepetition(rows: Row[]): RepetitionSummary[] {
  const grouped = new Map<string, Row[]>();
  for (const row of bucketRows(rows, "day", "resolve", "skill")) {
    const skill = s(row, "scope_id");
    const existing = grouped.get(skill) ?? [];
    existing.push(row);
    grouped.set(skill, existing);
  }
  return [...grouped.entries()]
    .map(([skill_id, items]) => {
      const total = items.reduce((sum, item) => sum + n(item, "total_count"), 0);
      const repeated = items.reduce((sum, item) => sum + n(item, "repeated_input_count"), 0);
      return {
        skill_id,
        total_intents: total,
        unique_inputs: Math.max(total - repeated, 0),
        repeated_intents: repeated,
        input_repeat_rate_pct: total > 0 ? (repeated * 100) / total : 0,
      };
    })
    .sort((a, b) => b.input_repeat_rate_pct - a.input_repeat_rate_pct);
}

async function intentPerformance(event: APIGatewayProxyEvent, from: string, to: string) {
  const { buckets, feeds } = await loadTables(from, to);
  const rows = bucketRows(buckets, "minute", "resolve", "global");
  const totals = aggregate(rows);
  return success(200, {
    dashboard: "resolve-performance",
    time_range: { from, to },
    latency_over_time: rows.map((r) => ({ minute: s(r, "bucket_start"), p50_ms: pct(latency(r), 0.5), p95_ms: pct(latency(r), 0.95) })),
    latency_histogram: totals.hist.map((b) => ({ bucket_ms: b.start, request_count: b.count })),
    high_confidence_pct: totals.confidenceCount > 0 ? (totals.high * 100) / totals.confidenceCount : 0,
    high_confidence_over_time: rows.map((r) => ({ minute: s(r, "bucket_start"), high_confidence_pct: n(r, "confidence_count") > 0 ? (n(r, "confidence_high_count") * 100) / n(r, "confidence_count") : 0 })),
    success_rate_pct: totals.total > 0 ? (totals.successCount * 100) / totals.total : 0,
    low_confidence_resolves: feeds.filter((r) => s(r, "issue_type") === "resolve_low_confidence").sort((a, b) => s(b, "timestamp").localeCompare(s(a, "timestamp"))).slice(0, 100).map((r) => ({ intent: s(r, "intent"), confidence: n(r, "confidence"), skill_id: s(r, "skill_id"), timestamp: s(r, "timestamp") })),
  }, event);
}

async function executionCaching(event: APIGatewayProxyEvent, from: string, to: string) {
  const { buckets } = await loadTables(from, to);
  const executeMinutes = bucketRows(buckets, "minute", "execute", "global");
  const resolveMinutes = bucketRows(buckets, "minute", "resolve", "global");
  const skillExecHours = bucketRows(buckets, "hour", "execute", "skill");
  const skillMap = new Map<string, Row[]>();
  for (const row of skillExecHours) {
    const skill = s(row, "scope_id");
    const existing = skillMap.get(skill) ?? [];
    existing.push(row);
    skillMap.set(skill, existing);
  }
  const reps = skillResolveRepetition(buckets);
  return success(200, {
    dashboard: "execution-caching",
    time_range: { from, to },
    top_skills: [...skillMap.entries()].map(([skill_id, rows]) => ({ skill_id, execution_count: aggregate(rows).total })).sort((a, b) => b.execution_count - a.execution_count).slice(0, 20),
    repetition_rates: reps,
    repetition_rate_over_time: resolveMinutes.map((r) => ({ minute: s(r, "bucket_start"), total_intents: n(r, "total_count"), repeated_intents: n(r, "repeated_input_count"), repetition_rate_pct: n(r, "total_count") > 0 ? (n(r, "repeated_input_count") * 100) / n(r, "total_count") : 0 })),
    intent_repetition_rate_pct: aggregate(resolveMinutes).total > 0 ? (aggregate(resolveMinutes).repeated * 100) / aggregate(resolveMinutes).total : 0,
    execution_latency_over_time: executeMinutes.map((r) => ({ minute: s(r, "bucket_start"), p50_ms: pct(latency(r), 0.5), p95_ms: pct(latency(r), 0.95) })),
    cache_candidates: reps.filter((r) => r.total_intents > CACHE_CANDIDATE_MIN_INTENTS && r.input_repeat_rate_pct / 100 > CACHE_CANDIDATE_MIN_REPEAT_RATE).map((r) => ({ skill_id: r.skill_id, total_intents: r.total_intents, unique_inputs: r.unique_inputs, intent_repeat_rate: r.input_repeat_rate_pct / 100, p95_ms: skillMap.has(r.skill_id) ? pct(aggregate(skillMap.get(r.skill_id) ?? []).hist, 0.95) : null })).sort((a, b) => b.total_intents * b.intent_repeat_rate - a.total_intents * a.intent_repeat_rate).slice(0, 50),
  }, event);
}

async function skillQuality(event: APIGatewayProxyEvent, from: string, to: string) {
  const { buckets, intents } = await loadTables(from, to);
  const mergedIntents = mergeIntentRows(intents);
  const validateHours = bucketRows(buckets, "hour", "validate", "skill");
  const executeHours = bucketRows(buckets, "hour", "execute", "skill");
  const vMap = new Map<string, Row[]>(), eMap = new Map<string, Row[]>();
  for (const row of validateHours) (vMap.get(s(row, "scope_id")) ?? vMap.set(s(row, "scope_id"), []).get(s(row, "scope_id"))!).push(row);
  for (const row of executeHours) (eMap.get(s(row, "scope_id")) ?? eMap.set(s(row, "scope_id"), []).get(s(row, "scope_id"))!).push(row);
  const confidenceDegradation = [...vMap.entries()].map(([skill_id, rows]) => {
    const now = Date.now(), oneDayAgo = now - 86400000, sevenDaysAgo = now - 7 * 86400000;
    const recent = aggregate(rows.filter((r) => { const t = ms(s(r, "bucket_start")); return t != null && t >= oneDayAgo; }));
    const prior = aggregate(rows.filter((r) => { const t = ms(s(r, "bucket_start")); return t != null && t >= sevenDaysAgo && t < oneDayAgo; }));
    const recent_conf = recent.confidenceCount > 0 ? recent.confidenceSum / recent.confidenceCount : 0;
    const prior_conf = prior.confidenceCount > 0 ? prior.confidenceSum / prior.confidenceCount : 0;
    return { skill_id, prior_conf, recent_conf, confidence_delta: recent_conf - prior_conf };
  }).filter((r) => r.prior_conf > 0 && r.confidence_delta < -0.05).sort((a, b) => a.confidence_delta - b.confidence_delta);
  return success(200, {
    dashboard: "skill-quality",
    time_range: { from, to },
    test_pass_rates: [...vMap.entries()].map(([skill_id, rows]) => ({ skill_id, passed: aggregate(rows).successCount, failed: aggregate(rows).failureCount, pass_rate_pct: aggregate(rows).total > 0 ? (aggregate(rows).successCount * 100) / aggregate(rows).total : 0 })).sort((a, b) => a.pass_rate_pct - b.pass_rate_pct),
    confidence_over_time: [...vMap.entries()].flatMap(([skill_id, rows]) => rows.sort((a, b) => s(a, "bucket_start").localeCompare(s(b, "bucket_start"))).map((r) => ({ skill_id, hour: s(r, "bucket_start"), avg_confidence: n(r, "confidence_count") > 0 ? n(r, "confidence_sum") / n(r, "confidence_count") : 0, min_confidence: null }))),
    failure_rates: [...eMap.entries()].map(([skill_id, rows]) => ({ skill_id, total_executions: aggregate(rows).total, failures: aggregate(rows).failureCount, failure_rate_pct: aggregate(rows).total > 0 ? (aggregate(rows).failureCount * 100) / aggregate(rows).total : 0 })).filter((r) => r.total_executions >= 5).sort((a, b) => b.failure_rate_pct - a.failure_rate_pct),
    competing_implementations: mergedIntents.map((r) => ({ intent: s(r, "intent"), competing_skills: setArr(r, "distinct_skill_ids"), num_competitors: setArr(r, "distinct_skill_ids").length, best_confidence: null, worst_confidence: null })).filter((r) => r.num_competitors > 1).sort((a, b) => b.num_competitors - a.num_competitors).slice(0, 50),
    confidence_degradation: confidenceDegradation,
  }, event);
}

async function evolutionGap(event: APIGatewayProxyEvent, from: string, to: string) {
  const { buckets, intents } = await loadTables(from, to);
  const mergedIntents = mergeIntentRows(intents);
  const resolveHours = bucketRows(buckets, "hour", "resolve", "global");
  const executeHours = bucketRows(buckets, "hour", "execute", "skill");
  const failures = new Map<string, Row[]>();
  for (const row of executeHours) {
    const skill = s(row, "scope_id");
    const existing = failures.get(skill) ?? [];
    existing.push(row);
    failures.set(skill, existing);
  }
  const domain = new Map<string, { intents: Set<string>; unresolved: number; low: number }>();
  for (const row of mergedIntents) {
    const key = s(row, "domain") || "general";
    const current = domain.get(key) ?? { intents: new Set<string>(), unresolved: 0, low: 0 };
    current.intents.add(s(row, "intent"));
    current.unresolved += n(row, "resolve_failure_count");
    current.low += n(row, "low_confidence_resolve_count");
    domain.set(key, current);
  }
  return success(200, {
    dashboard: "evolution-gap",
    time_range: { from, to },
    unresolved_intents: mergedIntents.map((r) => ({ intent: s(r, "intent"), occurrences: n(r, "resolve_failure_count"), first_seen: s(r, "first_seen_at"), last_seen: s(r, "last_seen_at") })).filter((r) => r.occurrences > 0).sort((a, b) => b.occurrences - a.occurrences).slice(0, 100),
    low_confidence_intents: mergedIntents.map((r) => ({ intent: s(r, "intent"), skill_id: s(r, "last_skill_id"), occurrences: n(r, "low_confidence_resolve_count"), avg_confidence: n(r, "last_confidence") })).filter((r) => r.occurrences > 0).sort((a, b) => b.occurrences - a.occurrences).slice(0, 100),
    low_confidence_volume: resolveHours.map((r) => ({ hour: s(r, "bucket_start"), low_confidence_count: n(r, "confidence_low_count"), total_resolves: n(r, "total_count"), low_confidence_pct: n(r, "total_count") > 0 ? (n(r, "confidence_low_count") * 100) / n(r, "total_count") : 0 })),
    failed_executions: [...failures.entries()].map(([skill_id, rows]) => ({ skill_id, total_executions: aggregate(rows).total, failures: aggregate(rows).failureCount, failure_rate_pct: aggregate(rows).total > 0 ? (aggregate(rows).failureCount * 100) / aggregate(rows).total : 0 })).filter((r) => r.failures > 0).sort((a, b) => b.failures - a.failures).slice(0, 100),
    domain_coverage_gaps: [...domain.entries()].map(([name, d]) => ({ domain: name, unique_intents: d.intents.size, unresolved_count: d.unresolved, low_confidence_count: d.low, execution_failures: 0 })).sort((a, b) => b.unresolved_count + b.low_confidence_count - (a.unresolved_count + a.low_confidence_count)),
    evolve_pipeline: mergedIntents.map((r) => ({ intent: s(r, "intent"), fail_count: n(r, "fail_count"), first_failure: s(r, "first_seen_at"), latest_failure: s(r, "last_seen_at") })).filter((r) => r.fail_count > 0).sort((a, b) => b.fail_count - a.fail_count).slice(0, 50),
  }, event);
}

async function agentBehavior(event: APIGatewayProxyEvent, from: string, to: string) {
  const { buckets, intents } = await loadTables(from, to);
  const mergedIntents = mergeIntentRows(intents);
  const resolves = bucketRows(buckets, "hour", "resolve", "global");
  const executes = bucketRows(buckets, "hour", "execute", "global");
  const resolveMap = new Map(resolves.map((r) => [s(r, "bucket_start"), n(r, "total_count")]));
  const executeMap = new Map(executes.map((r) => [s(r, "bucket_start"), n(r, "total_count")]));
  const hours = [...new Set([...resolveMap.keys(), ...executeMap.keys()])].sort();
  const totalResolves = [...resolveMap.values()].reduce((sum, count) => sum + count, 0);
  const totalExecutes = [...executeMap.values()].reduce((sum, count) => sum + count, 0);
  return success(200, {
    dashboard: "agent-behavior",
    time_range: { from, to },
    total_resolves: totalResolves,
    total_executes: totalExecutes,
    conversion_rate_pct: totalResolves > 0 ? (totalExecutes * 100) / totalResolves : 0,
    conversion_over_time: hours.map((hour) => ({ hour, resolves: resolveMap.get(hour) ?? 0, executes: executeMap.get(hour) ?? 0, conversion_rate_pct: (resolveMap.get(hour) ?? 0) > 0 ? ((executeMap.get(hour) ?? 0) * 100) / (resolveMap.get(hour) ?? 0) : 0 })),
    repeated_resolves: mergedIntents.map((r) => ({ intent: s(r, "intent"), resolve_count: n(r, "resolve_count"), distinct_skills_returned: setArr(r, "distinct_skill_ids").length, avg_confidence: n(r, "last_confidence") })).filter((r) => r.resolve_count > 3).sort((a, b) => b.resolve_count - a.resolve_count).slice(0, 50),
    abandoned_executions: [],
    skill_chain_patterns: mergedIntents.filter((r) => s(r, "intent").startsWith("chain:") && s(r, "last_skill_id")).map((r) => ({ from_skill: "", to_skill: s(r, "last_skill_id"), chain_count: n(r, "resolve_count") })).sort((a, b) => b.chain_count - a.chain_count).slice(0, 20),
    hourly_usage: resolves.map((r) => ({ day_of_week: new Date(s(r, "bucket_start")).getUTCDay(), hour_of_day: new Date(s(r, "bucket_start")).getUTCHours(), event_count: n(r, "total_count") })),
  }, event);
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let dashboardType: z.infer<typeof DashboardTypeSchema> | undefined;
  let fallback: { from: string; to: string } | undefined;
  try {
    const params = validate(ParamsSchema, { type: event.pathParameters?.type, from: event.queryStringParameters?.from, to: event.queryStringParameters?.to });
    if (!params.success) return error(400, "VALIDATION_ERROR", `Invalid dashboard type: "${event.pathParameters?.type}"`, undefined, event);
    dashboardType = params.data.type;
    const resolved = range(event, params.data.from, params.data.to);
    if (!resolved.ok) return resolved.response;
    const { from, to } = resolved;
    fallback = { from, to };
    if (dashboardType === "mountain") return mountainDashboard(event, event.queryStringParameters ?? {});
    if (dashboardType === "resolve-performance" || dashboardType === "intent-performance") {
      return intentPerformance(event, from, to);
    }
    if (dashboardType === "execution-caching") return executionCaching(event, from, to);
    if (dashboardType === "skill-quality") return skillQuality(event, from, to);
    if (dashboardType === "evolution-gap") return evolutionGap(event, from, to);
    return agentBehavior(event, from, to);
  } catch (err) {
    if (dashboardType && dashboardType !== "mountain" && fallback && analyticsUnavailable(err)) {
      console.error("[dashboards] Analytics tables unavailable, returning degraded payload:", err);
      return degraded(event, dashboardType, fallback.from, fallback.to);
    }
    console.error("[dashboards] Unexpected error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred", undefined, event);
  }
}

async function mountainDashboard(
  event: APIGatewayProxyEvent,
  qs: Record<string, string | undefined>,
): Promise<APIGatewayProxyResult> {
  const domainFilter = qs["domain"] ?? null;
  const languageFilter = qs["language"] ?? null;
  const statusFilter = (qs["status"] ?? null) as DominantStatus | null;
  const problemsScan = await docClient.send(new ScanCommand({ TableName: PROBLEMS_TABLE, FilterExpression: domainFilter ? "contains(#d, :domain)" : undefined, ExpressionAttributeNames: domainFilter ? { "#d": "domain" } : undefined, ExpressionAttributeValues: domainFilter ? { ":domain": domainFilter } : undefined }));
  const rawProblems = (problemsScan.Items ?? []) as Array<Record<string, unknown>>;
  const problems = await Promise.all(rawProblems.map(async (problem) => {
    const problemId = problem.problem_id as string;
    const skillsResult = await docClient.send(new QueryCommand({ TableName: SKILLS_TABLE, IndexName: "GSI-problem-status", KeyConditionExpression: "problem_id = :pid", ExpressionAttributeValues: { ":pid": problemId }, FilterExpression: languageFilter ? "#lang = :lang" : undefined, ExpressionAttributeNames: languageFilter ? { "#lang": "language" } : undefined }));
    const skills = (skillsResult.Items ?? []) as Array<Record<string, unknown>>;
    const distribution: Record<string, number> = { unsolved: 0, partial: 0, verified: 0, optimized: 0, archived: 0 };
    let executionCount = 0;
    let canonicalSkill: { skill_id: string; language: string; confidence: number; latency_p50_ms: number | null } | null = null;
    for (const skill of skills) {
      const status = (skill.status as string) ?? "unsolved";
      if (status in distribution) distribution[status]++;
      executionCount += (skill.execution_count as number) ?? 0;
      if (skill.is_canonical === true && canonicalSkill === null) canonicalSkill = { skill_id: skill.skill_id as string, language: skill.language as string, confidence: (skill.confidence as number) ?? 0, latency_p50_ms: (skill.latency_p50_ms as number | null) ?? null };
    }
    const dominant = STATUS_ORDER.find((status) => (distribution[status] ?? 0) > 0) ?? "unsolved";
    return { problem_id: problemId, name: problem.name as string, difficulty: (problem.difficulty as Difficulty) ?? "medium", domain: (problem.domain as string[]) ?? [], tags: (problem.tags as string[] | undefined) ?? [], skill_count: skills.length, dominant_status: dominant, skill_status_distribution: distribution, execution_count_30d: executionCount, canonical_skill: canonicalSkill, _dominant: dominant };
  }));
  const filtered = statusFilter ? problems.filter((p) => p._dominant === statusFilter) : problems;
  const output = filtered.map(({ _dominant, ...rest }) => rest);
  output.sort((a, b) => STATUS_ORDER.indexOf(a.dominant_status) - STATUS_ORDER.indexOf(b.dominant_status) || b.execution_count_30d - a.execution_count_30d);
  return success(200, { generated_at: new Date().toISOString(), cache_hit: false, total_problems: output.length, total_skills: output.reduce((sum, p) => sum + p.skill_count, 0), problems: output }, event);
}
