/**
 * Unit tests for POST /feedback handler.
 */

import type { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "../../../src/execution/execute.js";

const mockSend = jest.fn();
const mockEmitEvent = jest.fn().mockResolvedValue(undefined);

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: (...args: unknown[]) => mockSend(...args) }),
  },
  GetCommand: jest.fn().mockImplementation((input) => ({ _type: "GetCommand", input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: "QueryCommand", input })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: "UpdateCommand", input })),
}));

jest.mock("../../../src/shared/emitEvent.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

const SKILL_ID = "22222222-2222-2222-2222-222222222222";

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/feedback",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as never,
    resource: "/feedback",
  };
}

function latestSkill(overrides: Record<string, unknown> = {}) {
  return {
    skill_id: SKILL_ID,
    version_number: 3,
    status: "verified",
    confidence: 0.91,
    ...overrides,
  };
}

describe("POST /feedback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitEvent.mockResolvedValue(undefined);
  });

  it("acknowledges a local execution report and emits telemetry", async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [latestSkill()] })
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({
        skill_id: SKILL_ID,
        inputs: { b: 2, a: 1 },
        latency_ms: 245,
        cache_hit: true,
        success: false,
      }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill_id).toBe(SKILL_ID);
    expect(body.version).toBe(3);
    expect(body.execution_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.input_hash).toHaveLength(64);
    expect(body.cache_hit).toBe(true);
    expect(body.success).toBe(false);

    expect(mockSend).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _type: "QueryCommand" }),
    );
    expect(mockSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _type: "UpdateCommand" }),
    );
    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "execute",
        skill_id: SKILL_ID,
        latency_ms: 245,
        cache_hit: true,
        success: false,
        input_hash: body.input_hash,
      }),
    );
  });

  it("uses a specific version when provided", async () => {
    mockSend
      .mockResolvedValueOnce({ Item: latestSkill({ version_number: 1 }) })
      .mockResolvedValueOnce({});

    const result = await handler(makeEvent({ skill_id: SKILL_ID, version: 1 }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.version).toBe(1);
    expect(mockSend).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _type: "GetCommand",
        input: expect.objectContaining({
          Key: { skill_id: SKILL_ID, version_number: 1 },
        }),
      }),
    );
  });

  it("hashes inputs deterministically regardless of object key order", async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [latestSkill()] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [latestSkill()] })
      .mockResolvedValueOnce({});

    const first = JSON.parse(
      (
        await handler(makeEvent({ skill_id: SKILL_ID, inputs: { b: 2, a: 1 } }))
      ).body,
    );
    const second = JSON.parse(
      (
        await handler(makeEvent({ skill_id: SKILL_ID, inputs: { a: 1, b: 2 } }))
      ).body,
    );

    expect(first.input_hash).toBe(second.input_hash);
  });

  it("returns 404 when the skill is archived", async () => {
    mockSend.mockResolvedValueOnce({ Items: [latestSkill({ status: "archived" })] });

    const result = await handler(makeEvent({ skill_id: SKILL_ID }));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid request bodies", async () => {
    const result = await handler(makeEvent({ skill_id: "not-a-uuid" }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });
});
