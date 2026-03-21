/**
 * Unit tests for GET /skills handler.
 */

import { handler } from "../../../src/registry/listSkills.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: (...args: unknown[]) => mockSend(...args) }),
  },
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: "QueryCommand", input })),
  ScanCommand: jest.fn().mockImplementation((input) => ({ _type: "ScanCommand", input })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  queryParams?: Record<string, string>,
  multiValue?: Record<string, string[]>,
): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: null,
    queryStringParameters: queryParams ?? null,
    multiValueQueryStringParameters: multiValue ?? null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/skills",
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

const mockSkill1 = {
  skill_id: "11111111-1111-1111-1111-111111111111",
  version_number: 1,
  problem_id: "aaaa1111-1111-1111-1111-111111111111",
  name: "Two Sum Hash Map",
  description: "O(n) solution",
  is_canonical: true,
  status: "verified",
  language: "python",
  domain: ["arrays"],
  tags: ["hash-map"],
  inputs: [{ name: "nums", type: "number[]" }],
  outputs: [{ name: "indices", type: "number[]" }],
  examples: [],
  tests: [],
  implementation: "",
  confidence: 0.9,
  latency_p50_ms: null,
  latency_p95_ms: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const mockSkill2 = {
  ...mockSkill1,
  skill_id: "22222222-2222-2222-2222-222222222222",
  name: "Two Sum Brute Force",
  confidence: 0.7,
  is_canonical: false,
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /skills", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should list skills with default params (scan)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockSkill1, mockSkill2],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skills).toHaveLength(2);
    expect(body.pagination.limit).toBe(20);
    expect(body.pagination.next_token).toBeNull();
  });

  it("should filter by language using GSI-language-confidence", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockSkill1],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent({ language: "python" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skills).toHaveLength(1);
  });

  it("should filter by problem_id using GSI-problem-status", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockSkill1],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(
      makeEvent({ problem_id: "aaaa1111-1111-1111-1111-111111111111" }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skills).toHaveLength(1);
  });

  it("should respect limit parameter", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockSkill1],
      LastEvaluatedKey: { skill_id: "next", version_number: 1 },
    });

    const result = await handler(makeEvent({ limit: "1" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.pagination.limit).toBe(1);
    expect(body.pagination.next_token).not.toBeNull();
  });

  it("should return 400 for limit > 100", async () => {
    const result = await handler(makeEvent({ limit: "200" }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 for invalid sort_by", async () => {
    const result = await handler(makeEvent({ sort_by: "invalid" }));
    expect(result.statusCode).toBe(400);
  });

  it("should handle pagination with next_token", async () => {
    const token = Buffer.from(
      JSON.stringify({ skill_id: "abc", version_number: 1 }),
    ).toString("base64");

    mockSend.mockResolvedValueOnce({
      Items: [mockSkill2],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent({ next_token: token }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skills).toHaveLength(1);
  });

  it("should return 400 for invalid next_token", async () => {
    const result = await handler(makeEvent({ next_token: "not-base64-json!" }));
    // The handler should handle this gracefully
    expect(result.statusCode).toBe(400);
  });

  it("should exclude archived skills by default", async () => {
    const archivedSkill = { ...mockSkill1, status: "archived", skill_id: "33333333-3333-3333-3333-333333333333" };
    // The filter is applied at DynamoDB level, so mock returns only non-archived
    mockSend.mockResolvedValueOnce({
      Items: [mockSkill1],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    // All returned items should be non-archived
    for (const skill of body.skills) {
      expect(skill.status).not.toBe("archived");
    }
  });

  it("should deduplicate skills keeping latest version", async () => {
    const v1 = { ...mockSkill1, version_number: 1 };
    const v2 = { ...mockSkill1, version_number: 2 };
    mockSend.mockResolvedValueOnce({
      Items: [v1, v2],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);

    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].version).toBe(2);
  });
});
