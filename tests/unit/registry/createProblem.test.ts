/**
 * Unit tests for POST /problems handler.
 */

import { handler } from "../../../src/registry/createProblem.js";
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
  PutCommand: jest.fn().mockImplementation((input) => ({ _type: "PutCommand", input })),
  ScanCommand: jest.fn().mockImplementation((input) => ({ _type: "ScanCommand", input })),
}));

jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("00000000-0000-0000-0000-000000000001"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    path: "/problems",
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

const validBody = {
  name: "Two Sum",
  description: "Given an array and a target, find two numbers that add up to the target.",
  difficulty: "easy",
  domain: ["arrays"],
  tags: ["hash-map"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /problems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create a problem and return 201", async () => {
    // ScanCommand returns empty (no duplicate)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body.problem).toBeDefined();
    expect(body.problem.problem_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(body.problem.name).toBe("Two Sum");
    expect(body.problem.skill_count).toBe(0);
    expect(body.problem.canonical_skill_id).toBeNull();
    expect(body.problem.created_at).toBeDefined();
  });

  it("should return 400 for missing required fields", async () => {
    const result = await handler(makeEvent({ name: "Test" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 for invalid difficulty", async () => {
    const result = await handler(
      makeEvent({ ...validBody, difficulty: "impossible" }),
    );
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
    expect(result.statusCode).toBe(400);
  });

  it("should return 409 when problem name already exists", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ problem_id: "existing-id", name: "Two Sum" }],
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("should return 400 for invalid JSON body", async () => {
    const event = makeEvent(validBody);
    event.body = "not-valid-json";

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 500 on unexpected error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler(makeEvent(validBody));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe("INTERNAL_ERROR");
  });

  it("should include examples field defaulting to empty array", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body.problem.examples).toEqual([]);
  });

  it("should set default tags to empty array when not provided", async () => {
    const bodyNoTags = { ...validBody };
    delete (bodyNoTags as Record<string, unknown>).tags;

    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(bodyNoTags));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body.problem.tags).toEqual([]);
  });
});
