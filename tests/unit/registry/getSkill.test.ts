/**
 * Unit tests for GET /skills/:id handler.
 */

import { handler } from "../../../src/registry/getSkill.js";
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

const SKILL_ID = "22222222-2222-2222-2222-222222222222";

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
    path: `/skills/${pathId}`,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

const mockSkillItem = {
  skill_id: SKILL_ID,
  version_number: 2,
  version_label: "1.0.0",
  problem_id: "11111111-1111-1111-1111-111111111111",
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

describe("GET /skills/:id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return latest version when no version specified", async () => {
    mockSend.mockResolvedValueOnce({ Items: [mockSkillItem] });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.skill_id).toBe(SKILL_ID);
    expect(body.skill.version).toBe(2);
    expect(body.skill.version_label).toBe("1.0.0");
  });

  it("should return specific version when version param provided", async () => {
    const v1Item = { ...mockSkillItem, version_number: 1, version_label: "0.1.0" };
    mockSend.mockResolvedValueOnce({ Item: v1Item });

    const result = await handler(makeEvent(SKILL_ID, { version: "1" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.version).toBe(1);
  });

  it("should return 404 when skill does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
  });

  it("should return 404 when specific version does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(makeEvent(SKILL_ID, { version: "99" }));
    expect(result.statusCode).toBe(404);
  });

  it("should return 400 for invalid UUID", async () => {
    const result = await handler(makeEvent("not-a-uuid"));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 for invalid version param", async () => {
    const result = await handler(makeEvent(SKILL_ID, { version: "abc" }));
    expect(result.statusCode).toBe(400);
  });

  it("should return archived skills", async () => {
    const archivedSkill = { ...mockSkillItem, status: "archived" };
    mockSend.mockResolvedValueOnce({ Items: [archivedSkill] });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.status).toBe("archived");
  });

  it("should map version_number to version in response", async () => {
    mockSend.mockResolvedValueOnce({ Items: [mockSkillItem] });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(body.skill.version).toBe(2);
    expect(body.skill.version_number).toBeUndefined();
  });
});
