/**
 * Unit tests for GET /problems/:id handler.
 */

import { handler } from "../../../src/registry/getProblem.js";
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
  GetCommand: jest.fn().mockImplementation((input) => ({ _type: "GetCommand", input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: "QueryCommand", input })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROBLEM_ID = "11111111-1111-1111-1111-111111111111";

function makeEvent(
  pathId: string,
  queryParams?: Record<string, string>,
): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: { id: pathId },
    queryStringParameters: queryParams ?? null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: `/problems/${pathId}`,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

const mockProblem = {
  problem_id: PROBLEM_ID,
  name: "Two Sum",
  description: "Find two numbers that add up to target",
  difficulty: "easy",
  domain: ["arrays"],
  tags: ["hash-map"],
  canonical_skill_id: null,
  skill_count: 2,
  status: "active",
  domain_primary: "arrays",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const mockSkill = {
  skill_id: "22222222-2222-2222-2222-222222222222",
  version_number: 1,
  problem_id: PROBLEM_ID,
  name: "Two Sum Brute Force",
  description: "O(n^2) brute force",
  is_canonical: false,
  status: "verified",
  language: "python",
  domain: ["arrays"],
  tags: [],
  inputs: [{ name: "nums", type: "number[]" }],
  outputs: [{ name: "indices", type: "number[]" }],
  examples: [],
  tests: [],
  implementation: "def two_sum(nums, target): ...",
  confidence: 0.9,
  latency_p50_ms: 10,
  latency_p95_ms: 25,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /problems/:id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return problem with skills", async () => {
    mockSend.mockResolvedValueOnce({ Item: mockProblem });
    mockSend.mockResolvedValueOnce({ Items: [mockSkill] });

    const result = await handler(makeEvent(PROBLEM_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.problem.problem_id).toBe(PROBLEM_ID);
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].skill_id).toBe(mockSkill.skill_id);
    expect(body.skill_count).toBe(2);
  });

  it("should return 404 when problem does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(makeEvent(PROBLEM_ID));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
  });

  it("should return 400 for invalid UUID", async () => {
    const result = await handler(makeEvent("not-a-uuid"));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should exclude archived skills by default", async () => {
    const archivedSkill = { ...mockSkill, status: "archived", skill_id: "33333333-3333-3333-3333-333333333333" };
    mockSend.mockResolvedValueOnce({ Item: mockProblem });
    mockSend.mockResolvedValueOnce({ Items: [mockSkill, archivedSkill] });

    const result = await handler(makeEvent(PROBLEM_ID));
    const body = JSON.parse(result.body);

    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].status).not.toBe("archived");
  });

  it("should include archived skills when include_archived_skills=true", async () => {
    const archivedSkill = { ...mockSkill, status: "archived", skill_id: "33333333-3333-3333-3333-333333333333" };
    mockSend.mockResolvedValueOnce({ Item: mockProblem });
    mockSend.mockResolvedValueOnce({ Items: [mockSkill, archivedSkill] });

    const result = await handler(
      makeEvent(PROBLEM_ID, { include_archived_skills: "true" }),
    );
    const body = JSON.parse(result.body);

    expect(body.skills).toHaveLength(2);
  });

  it("should sort skills by confidence descending", async () => {
    const lowConfSkill = {
      ...mockSkill,
      skill_id: "44444444-4444-4444-4444-444444444444",
      confidence: 0.5,
    };
    const highConfSkill = {
      ...mockSkill,
      skill_id: "55555555-5555-5555-5555-555555555555",
      confidence: 0.95,
    };
    mockSend.mockResolvedValueOnce({ Item: mockProblem });
    mockSend.mockResolvedValueOnce({ Items: [lowConfSkill, highConfSkill] });

    const result = await handler(makeEvent(PROBLEM_ID));
    const body = JSON.parse(result.body);

    expect(body.skills[0].confidence).toBe(0.95);
    expect(body.skills[1].confidence).toBe(0.5);
  });
});
