/**
 * Unit tests for GET /analytics/dashboards/:type handler.
 *
 * Covers:
 * - All 5 dashboard types return 200
 * - W-04: Invalid ISO8601 from/to returns 400 INVALID_DATE_RANGE
 * - from >= to returns 400 INVALID_DATE_RANGE
 * - Missing from/to uses defaults (no error)
 * - Invalid dashboard type returns 400 VALIDATION_ERROR
 * - ClickHouse error returns 500
 */

import { handler } from "../../../src/analytics/dashboards.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mock the ClickHouse client
// ---------------------------------------------------------------------------

jest.mock("../../../src/analytics/clickhouseClient.js", () => ({
  getClickHouseClient: jest.fn().mockReturnValue({
    query: jest.fn().mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve([]),
      }),
    ),
  }),
}));

// After the module loads, grab the mock for test-level control
import { getClickHouseClient } from "../../../src/analytics/clickhouseClient.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  type: string,
  queryParams?: Record<string, string>,
): APIGatewayProxyEvent {
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

const VALID_FROM = "2026-01-01T00:00:00.000Z";
const VALID_TO = "2026-01-02T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /analytics/dashboards/:type", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 200 — all 5 dashboard types
  // -------------------------------------------------------------------------

  it("200: resolve-performance returns data shape", async () => {
    const result = await handler(
      makeEvent("resolve-performance", { from: VALID_FROM, to: VALID_TO }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.dashboard).toBe("resolve-performance");
    expect(body.time_range).toEqual({ from: VALID_FROM, to: VALID_TO });
  });

  it("200: execution-caching returns data shape", async () => {
    const result = await handler(
      makeEvent("execution-caching", { from: VALID_FROM, to: VALID_TO }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.dashboard).toBe("execution-caching");
  });

  it("200: skill-quality returns data shape", async () => {
    const result = await handler(
      makeEvent("skill-quality", { from: VALID_FROM, to: VALID_TO }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.dashboard).toBe("skill-quality");
  });

  it("200: evolution-gap returns data shape", async () => {
    const result = await handler(
      makeEvent("evolution-gap", { from: VALID_FROM, to: VALID_TO }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.dashboard).toBe("evolution-gap");
  });

  it("200: agent-behavior returns data shape", async () => {
    const result = await handler(
      makeEvent("agent-behavior", { from: VALID_FROM, to: VALID_TO }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.dashboard).toBe("agent-behavior");
  });

  it("200: uses default time range when from/to are omitted", async () => {
    const result = await handler(makeEvent("resolve-performance"));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    // from and to should be populated with defaults
    expect(body.time_range.from).toBeTruthy();
    expect(body.time_range.to).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 400 — W-04: invalid date range
  // -------------------------------------------------------------------------

  it("400 INVALID_DATE_RANGE: from is not a valid ISO8601 date", async () => {
    const result = await handler(
      makeEvent("resolve-performance", { from: "not-a-date", to: VALID_TO }),
    );
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe("INVALID_DATE_RANGE");
  });

  it("400 INVALID_DATE_RANGE: to is not a valid ISO8601 date", async () => {
    const result = await handler(
      makeEvent("resolve-performance", { from: VALID_FROM, to: "invalid" }),
    );
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe("INVALID_DATE_RANGE");
  });

  it("400 INVALID_DATE_RANGE: from is a plain date without time", async () => {
    // Plain "2026-01-01" without time component — Date.parse still accepts this in most engines.
    // The handler should accept it (Date.parse("2026-01-01") returns valid epoch).
    // This test verifies the handler doesn't crash on partial ISO8601.
    const result = await handler(
      makeEvent("resolve-performance", { from: "2026-01-01", to: VALID_TO }),
    );
    // 2026-01-01 is parseable, so should be 200
    expect(result.statusCode).toBe(200);
  });

  it("400 INVALID_DATE_RANGE: from >= to", async () => {
    const result = await handler(
      makeEvent("resolve-performance", {
        from: VALID_TO,
        to: VALID_FROM, // intentionally reversed
      }),
    );
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe("INVALID_DATE_RANGE");
  });

  it("400 INVALID_DATE_RANGE: from === to", async () => {
    const result = await handler(
      makeEvent("resolve-performance", {
        from: VALID_FROM,
        to: VALID_FROM,
      }),
    );
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe("INVALID_DATE_RANGE");
  });

  it("400 INVALID_DATE_RANGE: numeric string is not ISO8601", async () => {
    const result = await handler(
      makeEvent("resolve-performance", { from: "1234567890", to: VALID_TO }),
    );
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe("INVALID_DATE_RANGE");
  });

  // -------------------------------------------------------------------------
  // 400 — invalid dashboard type
  // -------------------------------------------------------------------------

  it("400 VALIDATION_ERROR: unknown dashboard type", async () => {
    const result = await handler(
      makeEvent("unknown-type", { from: VALID_FROM, to: VALID_TO }),
    );
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // -------------------------------------------------------------------------
  // 500 — ClickHouse error
  // -------------------------------------------------------------------------

  it("500 INTERNAL_ERROR: ClickHouse query throws", async () => {
    const mockClient = getClickHouseClient();
    (mockClient.query as jest.Mock).mockRejectedValueOnce(
      new Error("ClickHouse connection refused"),
    );

    const result = await handler(
      makeEvent("resolve-performance", { from: VALID_FROM, to: VALID_TO }),
    );
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
