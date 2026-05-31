import type { APIGatewayProxyEvent } from "aws-lambda";

const mockSend = jest.fn();

jest.mock("../../../src/shared/dynamo.js", () => ({
  docClient: { send: mockSend },
  PROBLEMS_TABLE: "codevolve-problems",
  SKILLS_TABLE: "codevolve-skills",
  ANALYTICS_BUCKETS_TABLE: "codevolve-analytics-buckets",
  ANALYTICS_INPUT_STATE_TABLE: "codevolve-analytics-input-state",
  ANALYTICS_INTENT_SUMMARIES_TABLE: "codevolve-analytics-intent-summaries",
  ANALYTICS_RECENT_FEEDS_TABLE: "codevolve-analytics-recent-feeds",
}));

import { handler } from "../../../src/analytics/dashboards.js";

const VALID_FROM = "2026-01-01T00:00:00.000Z";
const VALID_TO = "2026-01-02T00:00:00.000Z";

function makeEvent(type: string, queryParams?: Record<string, string>): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: { type },
    queryStringParameters: queryParams ?? null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: `/analytics/dashboards/${type}`,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

function setupTables(overrides: Partial<Record<string, unknown[]>>) {
  const defaults: Record<string, unknown[]> = {
    "codevolve-analytics-buckets": [],
    "codevolve-analytics-intent-summaries": [],
    "codevolve-analytics-recent-feeds": [],
    "codevolve-analytics-input-state": [],
    "codevolve-problems": [],
    "codevolve-skills": [],
  };
  const tables = { ...defaults, ...overrides };
  mockSend.mockImplementation((command: { input: { TableName: string } }) =>
    Promise.resolve({ Items: tables[command.input.TableName] ?? [] }),
  );
}

describe("GET /analytics/dashboards/:type", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    setupTables({});
  });

  it("200: resolve-performance returns DynamoDB-backed data shape", async () => {
    setupTables({
      "codevolve-analytics-buckets": [
        {
          bucket_start: "2026-01-01T00:00:00.000Z",
          granularity: "minute",
          event_type: "resolve",
          scope_type: "global",
          total_count: 10,
          success_count: 9,
          confidence_count: 10,
          confidence_high_count: 8,
          latency_bucket_10_count: 6,
          latency_bucket_50_count: 4,
        },
      ],
      "codevolve-analytics-recent-feeds": [
        {
          timestamp: "2026-01-01T00:10:00.000Z",
          issue_type: "resolve_low_confidence",
          intent: "arrays:two-sum",
          confidence: 0.61,
          skill_id: "skill-1",
        },
      ],
      "codevolve-skills": [
        {
          skill_id: "skill-1",
          problem_id: "problem-1",
          version: 2,
          name: "Fast Pair Sum",
        },
      ],
      "codevolve-problems": [
        {
          problem_id: "problem-1",
          name: "Two Sum",
        },
      ],
    });

    const result = await handler(makeEvent("resolve-performance", { from: VALID_FROM, to: VALID_TO }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.dashboard).toBe("resolve-performance");
    expect(body.time_range).toEqual({ from: VALID_FROM, to: VALID_TO });
    expect(body.latency_over_time).toEqual([
      { minute: "2026-01-01T00:00:00.000Z", p50_ms: 10, p95_ms: 50 },
    ]);
    expect(body.high_confidence_pct).toBe(80);
    expect(body.success_rate_pct).toBe(90);
    expect(body.low_confidence_resolves[0]).toMatchObject({
      intent: "arrays:two-sum",
      skill_id: "skill-1",
      skill_name: "Fast Pair Sum",
      problem_name: "Two Sum",
      display_name: "Fast Pair Sum",
    });
  });

  it("200: legacy intent-performance alias still works", async () => {
    const result = await handler(makeEvent("intent-performance", { from: VALID_FROM, to: VALID_TO }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.dashboard).toBe("resolve-performance");
  });

  it("200: execution-caching uses input-state repetition summaries", async () => {
    setupTables({
      "codevolve-analytics-buckets": [
        {
          bucket_start: "2026-01-01T00:00:00.000Z",
          granularity: "minute",
          event_type: "resolve",
          scope_type: "global",
          total_count: 20,
          repeated_input_count: 8,
        },
        {
          bucket_start: "2026-01-01T00:00:00.000Z",
          granularity: "minute",
          event_type: "execute",
          scope_type: "global",
          total_count: 15,
          latency_bucket_20_count: 10,
          latency_bucket_50_count: 5,
        },
        {
          bucket_start: "2026-01-01T00:00:00.000Z",
          granularity: "hour",
          event_type: "execute",
          scope_type: "skill",
          scope_id: "skill-1",
          total_count: 120,
          latency_bucket_50_count: 120,
        },
        {
          bucket_start: "2026-01-01T00:00:00.000Z",
          granularity: "day",
          event_type: "resolve",
          scope_type: "skill",
          scope_id: "skill-1",
          total_count: 100,
          repeated_input_count: 45,
        },
      ],
      "codevolve-skills": [
        {
          skill_id: "skill-1",
          problem_id: "problem-1",
          version: 3,
          name: "Fast Pair Sum",
        },
      ],
      "codevolve-problems": [
        {
          problem_id: "problem-1",
          name: "Two Sum",
        },
      ],
    });

    const result = await handler(makeEvent("execution-caching", { from: VALID_FROM, to: VALID_TO }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.top_skills).toEqual([
      {
        skill_id: "skill-1",
        skill_name: "Fast Pair Sum",
        problem_name: "Two Sum",
        display_name: "Fast Pair Sum",
        execution_count: 120,
      },
    ]);
    expect(body.repetition_rates[0]).toMatchObject({
      skill_id: "skill-1",
      skill_name: "Fast Pair Sum",
      problem_name: "Two Sum",
      display_name: "Fast Pair Sum",
      total_executions: 100,
      unique_inputs: 55,
      input_repeat_rate: 0.45,
    });
    expect(body.intent_repetition_rate_pct).toBe(40);
    expect(body.cache_candidates[0]).toMatchObject({
      skill_id: "skill-1",
      skill_name: "Fast Pair Sum",
      problem_name: "Two Sum",
      display_name: "Fast Pair Sum",
      execution_count: 100,
    });
  });

  it("200: skill labels are included across remaining dashboards", async () => {
    setupTables({
      "codevolve-analytics-buckets": [
        {
          bucket_start: "2026-01-01T00:00:00.000Z",
          granularity: "hour",
          event_type: "validate",
          scope_type: "skill",
          scope_id: "skill-1",
          total_count: 10,
          success_count: 9,
          failure_count: 1,
          confidence_count: 10,
          confidence_sum: 8.8,
        },
        {
          bucket_start: "2026-01-01T00:00:00.000Z",
          granularity: "hour",
          event_type: "execute",
          scope_type: "skill",
          scope_id: "skill-1",
          total_count: 12,
          failure_count: 3,
        },
        {
          bucket_start: "2026-01-01T00:00:00.000Z",
          granularity: "hour",
          event_type: "resolve",
          scope_type: "global",
          total_count: 10,
          confidence_low_count: 3,
        },
      ],
      "codevolve-analytics-intent-summaries": [
        {
          intent: "chain:plan pipeline",
          domain: "general",
          first_seen_at: "2026-01-01T00:00:00.000Z",
          last_seen_at: "2026-01-01T00:00:00.000Z",
          last_skill_id: "skill-1",
          last_confidence: 0.62,
          resolve_count: 4,
          resolve_failure_count: 1,
          low_confidence_resolve_count: 2,
          fail_count: 1,
          distinct_skill_ids: ["skill-1"],
          window_start: "2026-01-01T00:00:00.000Z",
        },
      ],
      "codevolve-skills": [
        {
          skill_id: "skill-1",
          problem_id: "problem-1",
          version: 4,
          name: "Fast Pair Sum",
        },
      ],
      "codevolve-problems": [
        {
          problem_id: "problem-1",
          name: "Two Sum",
        },
      ],
    });

    const skillQuality = JSON.parse((await handler(makeEvent("skill-quality", { from: VALID_FROM, to: VALID_TO }))).body);
    expect(skillQuality.dashboard).toBe("skill-quality");
    expect(skillQuality.test_pass_rates[0]).toMatchObject({
      skill_id: "skill-1",
      display_name: "Fast Pair Sum",
    });
    expect(skillQuality.failure_rates[0]).toMatchObject({
      skill_id: "skill-1",
      display_name: "Fast Pair Sum",
    });

    const evolutionGap = JSON.parse((await handler(makeEvent("evolution-gap", { from: VALID_FROM, to: VALID_TO }))).body);
    expect(evolutionGap.dashboard).toBe("evolution-gap");
    expect(evolutionGap.low_confidence_intents[0]).toMatchObject({
      skill_id: "skill-1",
      display_name: "Fast Pair Sum",
    });
    expect(evolutionGap.failed_executions[0]).toMatchObject({
      skill_id: "skill-1",
      display_name: "Fast Pair Sum",
    });

    const agentBehavior = JSON.parse((await handler(makeEvent("agent-behavior", { from: VALID_FROM, to: VALID_TO }))).body);
    expect(agentBehavior.dashboard).toBe("agent-behavior");
    expect(agentBehavior.skill_chain_patterns[0]).toMatchObject({
      to_skill: "skill-1",
      to_display_name: "Fast Pair Sum",
    });
  });

  it("400: invalid ranges are rejected", async () => {
    const invalid = await handler(makeEvent("resolve-performance", { from: "bad", to: VALID_TO }));
    const reversed = await handler(makeEvent("resolve-performance", { from: VALID_TO, to: VALID_FROM }));
    expect(invalid.statusCode).toBe(400);
    expect(reversed.statusCode).toBe(400);
  });

});
