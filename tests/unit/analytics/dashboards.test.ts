import { handler, _setClickHouseClientForTesting } from "../../../src/analytics/dashboards.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Module-level mocks — prevent real SDK clients from being constructed
// ---------------------------------------------------------------------------

jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({})),
  GetSecretValueCommand: jest.fn(),
}));

jest.mock("@clickhouse/client", () => ({
  createClient: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  dashboardType: string | null,
  queryParams?: Record<string, string>,
): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: dashboardType !== null ? { type: dashboardType } : null,
    queryStringParameters: queryParams ?? null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: `/analytics/dashboards/${dashboardType ?? ""}`,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

function makeMockClient(rows: unknown[]) {
  const mockResultSet = { json: jest.fn().mockResolvedValue(rows) };
  const mockClient = { query: jest.fn().mockResolvedValue(mockResultSet) };
  return { mockClient, mockResultSet };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  _setClickHouseClientForTesting(null);
  jest.clearAllMocks();
});

describe("GET /analytics/dashboards/:type", () => {
  describe("resolve-performance", () => {
    it("returns 200 with rows from ClickHouse", async () => {
      const rows = [{ minute: "2026-03-22T10:00:00Z", p50_ms: 45, p95_ms: 90, high_confidence_pct: 80, success_rate_pct: 99, total_resolves: 120 }];
      const { mockClient } = makeMockClient(rows);
      _setClickHouseClientForTesting(mockClient as never);

      const event = makeEvent("resolve-performance");
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.dashboard).toBe("resolve-performance");
      expect(body.rows).toEqual(rows);
      expect(body.from).toBeDefined();
      expect(body.to).toBeDefined();
      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const callArgs = mockClient.query.mock.calls[0][0] as { query: string; format: string };
      expect(callArgs.format).toBe("JSONEachRow");
      expect(callArgs.query).toContain("resolve");
    });

    it("passes from/to query params into the SQL", async () => {
      const { mockClient } = makeMockClient([]);
      _setClickHouseClientForTesting(mockClient as never);

      const from = "2026-03-22T00:00:00.000Z";
      const to = "2026-03-22T01:00:00.000Z";
      const event = makeEvent("resolve-performance", { from, to });
      await handler(event);

      const callArgs = mockClient.query.mock.calls[0][0] as { query: string };
      expect(callArgs.query).toContain(from);
      expect(callArgs.query).toContain(to);
    });
  });

  describe("execution-caching", () => {
    it("returns 200 with rows from ClickHouse", async () => {
      const rows = [
        { skill_id: "abc", execution_count: 500, unique_inputs: 50, input_repeat_rate: 0.9, cache_hit_rate_pct: 75, p50_ms: 30, p95_ms: 80 },
      ];
      const { mockClient } = makeMockClient(rows);
      _setClickHouseClientForTesting(mockClient as never);

      const event = makeEvent("execution-caching");
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.dashboard).toBe("execution-caching");
      expect(body.rows).toEqual(rows);
      const callArgs = mockClient.query.mock.calls[0][0] as { query: string };
      expect(callArgs.query).toContain("execute");
    });
  });

  describe("evolution-gap", () => {
    it("returns 200 with unresolved intent rows", async () => {
      const rows = [
        { intent: "sort a linked list", occurrences: 42, first_seen: "2026-03-01T00:00:00Z", last_seen: "2026-03-22T00:00:00Z" },
      ];
      const { mockClient } = makeMockClient(rows);
      _setClickHouseClientForTesting(mockClient as never);

      const event = makeEvent("evolution-gap");
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.dashboard).toBe("evolution-gap");
      expect(body.rows).toEqual(rows);
      const callArgs = mockClient.query.mock.calls[0][0] as { query: string };
      expect(callArgs.query).toContain("resolve");
      expect(callArgs.query).toContain("success = 0");
    });
  });

  describe("skill-quality", () => {
    it("returns 200 with validate-event rows", async () => {
      const rows = [
        { skill_id: "xyz", passed: 90, failed: 10, pass_rate_pct: 90, avg_confidence: 0.87, total_validations: 100 },
      ];
      const { mockClient } = makeMockClient(rows);
      _setClickHouseClientForTesting(mockClient as never);

      const event = makeEvent("skill-quality");
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.dashboard).toBe("skill-quality");
      expect(body.rows).toEqual(rows);
    });
  });

  describe("agent-behavior", () => {
    it("returns 200 with hourly funnel rows", async () => {
      const rows = [
        { hour: "2026-03-22T10:00:00Z", resolve_count: 100, execute_count: 75, resolve_to_execute_pct: 75, fail_count: 2 },
      ];
      const { mockClient } = makeMockClient(rows);
      _setClickHouseClientForTesting(mockClient as never);

      const event = makeEvent("agent-behavior");
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.dashboard).toBe("agent-behavior");
      expect(body.rows).toEqual(rows);
    });
  });

  describe("invalid dashboard type", () => {
    it("returns 400 for an unknown dashboard type", async () => {
      const event = makeEvent("not-a-real-dashboard");
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("INVALID_DASHBOARD_TYPE");
    });

    it("returns 400 when the path parameter is missing", async () => {
      const event = makeEvent(null);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("INVALID_DASHBOARD_TYPE");
    });
  });

  describe("ClickHouse error handling", () => {
    it("returns 500 when the ClickHouse client throws", async () => {
      const mockClient = {
        query: jest.fn().mockRejectedValue(new Error("connection refused")),
      };
      _setClickHouseClientForTesting(mockClient as never);

      const event = makeEvent("resolve-performance");
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("QUERY_ERROR");
    });

    it("returns 500 when resultSet.json() throws", async () => {
      const mockResultSet = { json: jest.fn().mockRejectedValue(new Error("parse error")) };
      const mockClient = { query: jest.fn().mockResolvedValue(mockResultSet) };
      _setClickHouseClientForTesting(mockClient as never);

      const event = makeEvent("execution-caching");
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("QUERY_ERROR");
    });
  });
});
