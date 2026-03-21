/**
 * Unit tests for POST /skills/:id/promote-canonical handler.
 */

import { handler } from "../../../src/registry/promoteCanonical.js";
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
  UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: "UpdateCommand", input })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_ID = "22222222-2222-2222-2222-222222222222";
const PROBLEM_ID = "11111111-1111-1111-1111-111111111111";

function makeEvent(pathId: string): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: { id: pathId },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: `/skills/${pathId}/promote-canonical`,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

const validSkillItem = {
  skill_id: SKILL_ID,
  version_number: 1,
  problem_id: PROBLEM_ID,
  name: "Two Sum Hash Map",
  description: "O(n) solution",
  is_canonical: false,
  status: "verified",
  language: "python",
  domain: ["arrays"],
  tags: ["hash-map"],
  inputs: [{ name: "nums", type: "number[]" }],
  outputs: [{ name: "indices", type: "number[]" }],
  examples: [],
  tests: [{ input: { nums: [1, 2], target: 3 }, expected: { indices: [0, 1] } }],
  implementation: "def two_sum(): ...",
  confidence: 0.9,
  latency_p50_ms: 10,
  latency_p95_ms: 25,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /skills/:id/promote-canonical", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should promote a skill to canonical and return 200", async () => {
    // Query latest version
    mockSend.mockResolvedValueOnce({ Items: [validSkillItem] });
    // Query for existing canonical (none)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Update skill to canonical
    mockSend.mockResolvedValueOnce({});
    // Update problem canonical_skill_id
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.is_canonical).toBe(true);
    expect(body.demoted_skill_id).toBeNull();
  });

  it("should demote previous canonical skill", async () => {
    const prevCanonical = {
      ...validSkillItem,
      skill_id: "33333333-3333-3333-3333-333333333333",
      is_canonical: true,
    };

    // Query latest version
    mockSend.mockResolvedValueOnce({ Items: [validSkillItem] });
    // Query for existing canonical (found one)
    mockSend.mockResolvedValueOnce({ Items: [prevCanonical] });
    // Demote previous canonical
    mockSend.mockResolvedValueOnce({});
    // Promote new skill
    mockSend.mockResolvedValueOnce({});
    // Update problem
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.demoted_skill_id).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("should return 404 when skill does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
  });

  it("should return 409 when skill is already canonical", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, is_canonical: true }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe("CONFLICT");
  });

  it("should return 422 when skill is archived", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, status: "archived" }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("PRECONDITION_FAILED");
  });

  it("should return 422 when status is unsolved", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, status: "unsolved" }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("PRECONDITION_FAILED");
  });

  it("should return 422 when confidence < 0.85", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, confidence: 0.5 }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("PRECONDITION_FAILED");
  });

  it("should return 422 when skill has no tests", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, tests: [] }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("PRECONDITION_FAILED");
  });

  it("should return 400 for invalid UUID", async () => {
    const result = await handler(makeEvent("not-a-uuid"));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should accept optimized status for promotion", async () => {
    const optimizedSkill = { ...validSkillItem, status: "optimized" };
    mockSend.mockResolvedValueOnce({ Items: [optimizedSkill] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);
  });

  it("should return 500 on unexpected error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe("INTERNAL_ERROR");
  });
});
