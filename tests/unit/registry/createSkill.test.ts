/**
 * Unit tests for POST /skills handler.
 */

import { handler } from "../../../src/registry/createSkill.js";
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
  PutCommand: jest.fn().mockImplementation((input) => ({ _type: "PutCommand", input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: "QueryCommand", input })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: "UpdateCommand", input })),
}));

jest.mock("../../../src/registry/bedrock.js", () => ({
  generateEmbedding: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  buildEmbeddingText: jest.fn().mockReturnValue("test embedding text"),
}));

jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROBLEM_ID = "11111111-1111-1111-1111-111111111111";

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/skills",
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

const validBody = {
  problem_id: PROBLEM_ID,
  name: "Two Sum Hash Map",
  description: "O(n) solution using hash map",
  language: "python",
  domain: ["arrays"],
  inputs: [{ name: "nums", type: "number[]" }, { name: "target", type: "number" }],
  outputs: [{ name: "indices", type: "number[]" }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /skills", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create a skill and return 201", async () => {
    // GetCommand: problem exists
    mockSend.mockResolvedValueOnce({ Item: { problem_id: PROBLEM_ID } });
    // QueryCommand: no duplicate
    mockSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand: skill created
    mockSend.mockResolvedValueOnce({});
    // UpdateCommand: skill_count incremented
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body.skill).toBeDefined();
    expect(body.skill.skill_id).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(body.skill.version).toBe(1);
    expect(body.skill.is_canonical).toBe(false);
    expect(body.skill.confidence).toBe(0);
    expect(body.skill.status).toBe("unsolved");
    expect(body.skill.latency_p50_ms).toBeNull();
    expect(body.skill.latency_p95_ms).toBeNull();
  });

  it("should return 400 for missing required fields", async () => {
    const result = await handler(makeEvent({ name: "Test" }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 when problem_id does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(makeEvent(validBody));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
  });

  it("should return 409 when duplicate skill exists", async () => {
    // Problem exists
    mockSend.mockResolvedValueOnce({ Item: { problem_id: PROBLEM_ID } });
    // Duplicate found
    mockSend.mockResolvedValueOnce({
      Items: [{ skill_id: "existing", name: "Two Sum Hash Map" }],
    });

    const result = await handler(makeEvent(validBody));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe("CONFLICT");
  });

  it("should use default values for optional fields", async () => {
    mockSend.mockResolvedValueOnce({ Item: { problem_id: PROBLEM_ID } });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body.skill.tags).toEqual([]);
    expect(body.skill.examples).toEqual([]);
    expect(body.skill.tests).toEqual([]);
    expect(body.skill.implementation).toBe("");
    expect(body.skill.version_label).toBe("0.1.0");
  });

  it("should accept custom status and version_label", async () => {
    mockSend.mockResolvedValueOnce({ Item: { problem_id: PROBLEM_ID } });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({
        ...validBody,
        status: "partial",
        version_label: "1.0.0",
      }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body.skill.status).toBe("partial");
    expect(body.skill.version_label).toBe("1.0.0");
  });

  it("should return 400 for invalid JSON body", async () => {
    const event = makeEvent(validBody);
    event.body = "not-json";

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it("should return 500 on unexpected error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler(makeEvent(validBody));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe("INTERNAL_ERROR");
  });
});
