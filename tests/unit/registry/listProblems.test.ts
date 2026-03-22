/**
 * Unit tests for GET /problems handler.
 */

import { handler } from "../../../src/registry/listProblems.js";
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
): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: null,
    queryStringParameters: queryParams ?? null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/problems",
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

const mockProblem1 = {
  problem_id: "aaaa1111-1111-1111-1111-111111111111",
  name: "Two Sum",
  description: "Find two numbers that add up to a target.",
  difficulty: "easy",
  domain: ["arrays"],
  tags: ["hash-map"],
  constraints: "1 <= nums.length <= 10^4",
  canonical_skill_id: null,
  skill_count: 2,
  status: "active",
  domain_primary: "arrays",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const mockProblem2 = {
  problem_id: "bbbb2222-2222-2222-2222-222222222222",
  name: "Binary Search",
  description: "Search a sorted array.",
  difficulty: "medium",
  domain: ["arrays", "binary-search"],
  tags: ["searching"],
  canonical_skill_id: null,
  skill_count: 1,
  status: "active",
  domain_primary: "arrays",
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const mockProblem3 = {
  ...mockProblem1,
  problem_id: "cccc3333-3333-3333-3333-333333333333",
  name: "Graph Traversal",
  difficulty: "hard",
  domain: ["graphs"],
  domain_primary: "graphs",
  status: "active",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /problems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return problems filtered by domain using GSI query", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockProblem1, mockProblem2],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent({ domain: "arrays" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.problems).toHaveLength(2);
    expect(body.problems[0].problem_id).toBe(mockProblem1.problem_id);
    expect(body.problems[1].problem_id).toBe(mockProblem2.problem_id);
    expect(body.pagination.limit).toBe(20);
    expect(body.pagination.next_token).toBeNull();

    // Verify QueryCommand was used (GSI path)
    const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
    expect(QueryCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: "GSI-status-domain",
        KeyConditionExpression: "#status = :status AND domain_primary = :domain",
      }),
    );
  });

  it("should default status filter to 'active'", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockProblem1],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.problems).toHaveLength(1);

    // Verify ScanCommand was used (no domain) with status filter
    const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
    expect(ScanCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        FilterExpression: expect.stringContaining("#status = :status"),
        ExpressionAttributeValues: expect.objectContaining({
          ":status": "active",
        }),
      }),
    );
  });

  it("should support pagination with next_token", async () => {
    const lastKey = { problem_id: mockProblem2.problem_id };

    // First page
    mockSend.mockResolvedValueOnce({
      Items: [mockProblem1],
      LastEvaluatedKey: lastKey,
    });

    const firstResult = await handler(makeEvent({ limit: "1" }));
    const firstBody = JSON.parse(firstResult.body);

    expect(firstResult.statusCode).toBe(200);
    expect(firstBody.problems).toHaveLength(1);
    expect(firstBody.pagination.limit).toBe(1);
    expect(firstBody.pagination.next_token).not.toBeNull();

    // Second page using token from first page
    mockSend.mockResolvedValueOnce({
      Items: [mockProblem2],
      LastEvaluatedKey: undefined,
    });

    const secondResult = await handler(
      makeEvent({ limit: "1", next_token: firstBody.pagination.next_token }),
    );
    const secondBody = JSON.parse(secondResult.body);

    expect(secondResult.statusCode).toBe(200);
    expect(secondBody.problems).toHaveLength(1);
    expect(secondBody.pagination.next_token).toBeNull();
  });

  it("should apply difficulty filter", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockProblem1],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent({ difficulty: "easy" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.problems).toHaveLength(1);

    // Verify difficulty is included in filter expression
    const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
    expect(ScanCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        FilterExpression: expect.stringContaining("difficulty = :difficulty"),
        ExpressionAttributeValues: expect.objectContaining({
          ":difficulty": "easy",
        }),
      }),
    );
  });

  it("should apply difficulty filter with domain (GSI query path)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockProblem1],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent({ domain: "arrays", difficulty: "easy" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.problems).toHaveLength(1);

    // Verify QueryCommand was used with difficulty as FilterExpression
    const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
    expect(QueryCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: "GSI-status-domain",
        FilterExpression: "difficulty = :difficulty",
        ExpressionAttributeValues: expect.objectContaining({
          ":difficulty": "easy",
        }),
      }),
    );
  });

  it("should return 400 for limit > 100", async () => {
    const result = await handler(makeEvent({ limit: "200" }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 for invalid next_token", async () => {
    const result = await handler(makeEvent({ next_token: "not-valid-base64-json!" }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should exclude internal DynamoDB fields from response", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockProblem1],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    const problem = body.problems[0];

    // Internal fields should not be present
    expect(problem).not.toHaveProperty("domain_primary");
    expect(problem).not.toHaveProperty("status");

    // API fields should be present
    expect(problem).toHaveProperty("problem_id");
    expect(problem).toHaveProperty("name");
    expect(problem).toHaveProperty("difficulty");
    expect(problem).toHaveProperty("domain");
    expect(problem).toHaveProperty("skill_count");
  });

  it("should include examples field in mapped problem (defaults to empty array)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [mockProblem1],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.problems[0]).toHaveProperty("examples");
    expect(body.problems[0].examples).toEqual([]);
  });

  it("should include examples field when problem has examples", async () => {
    const problemWithExamples = {
      ...mockProblem1,
      examples: [{ input: { nums: [2, 7], target: 9 }, output: { indices: [0, 1] } }],
    };

    mockSend.mockResolvedValueOnce({
      Items: [problemWithExamples],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.problems[0].examples).toHaveLength(1);
    expect(body.problems[0].examples[0].input).toEqual({ nums: [2, 7], target: 9 });
  });

  it("should handle empty results", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent({ domain: "nonexistent" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.problems).toHaveLength(0);
    expect(body.pagination.next_token).toBeNull();
  });

  it("should return 400 for invalid difficulty value", async () => {
    const result = await handler(makeEvent({ difficulty: "impossible" }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 500 when DynamoDB throws", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB connection failed"));

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe("INTERNAL_ERROR");
  });
});
