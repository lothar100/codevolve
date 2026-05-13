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

  it("200: intent-performance returns DynamoDB-backed data shape", async () => {
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
    });

    const result = await handler(makeEvent("intent-performance", { from: VALID_FROM, to: VALID_TO }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.dashboard).toBe("intent-performance");
    expect(body.time_range).toEqual({ from: VALID_FROM, to: VALID_TO });
    expect(body.latency_over_time).toEqual([
      { minute: "2026-01-01T00:00:00.000Z", p50_ms: 10, p95_ms: 50 },
    ]);
    expect(body.high_confidence_pct).toBe(80);
    expect(body.success_rate_pct).toBe(90);
    expect(body.low_confidence_resolves[0]).toMatchObject({ intent: "arrays:two-sum", skill_id: "skill-1" });
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
    });

    const result = await handler(makeEvent("execution-caching", { from: VALID_FROM, to: VALID_TO }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.top_skills).toEqual([{ skill_id: "skill-1", execution_count: 120 }]);
    expect(body.repetition_rates).toEqual([
      {
        skill_id: "skill-1",
        total_intents: 100,
        unique_inputs: 55,
        repeated_intents: 45,
        input_repeat_rate_pct: 45,
      },
    ]);
    expect(body.intent_repetition_rate_pct).toBe(40);
    expect(body.cache_candidates[0]).toMatchObject({ skill_id: "skill-1", total_intents: 100 });
  });

  it("200: other dashboards return their shape", async () => {
    for (const type of ["skill-quality", "evolution-gap", "agent-behavior"] as const) {
      const result = await handler(makeEvent(type, { from: VALID_FROM, to: VALID_TO }));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).dashboard).toBe(type);
    }
  });

  it("400: invalid ranges are rejected", async () => {
    const invalid = await handler(makeEvent("intent-performance", { from: "bad", to: VALID_TO }));
    const reversed = await handler(makeEvent("intent-performance", { from: VALID_TO, to: VALID_FROM }));
    expect(invalid.statusCode).toBe(400);
    expect(reversed.statusCode).toBe(400);
  });

});
