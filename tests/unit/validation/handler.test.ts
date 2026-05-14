/**
 * Unit tests for POST /validate/:skill_id handler.
 */

import type { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "../../../src/validation/handler.js";

const mockSend = jest.fn();
const mockEmitEvent = jest.fn().mockResolvedValue(undefined);
const mockSqsSend = jest.fn().mockResolvedValue({});

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

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockSqsSend(...args),
  })),
  SendMessageCommand: jest.fn().mockImplementation((input) => ({ _type: "SendMessageCommand", input })),
}));

jest.mock("../../../src/shared/emitEvent.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

const SKILL_ID = "33333333-3333-3333-3333-333333333333";

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: `/validate/${SKILL_ID}`,
    pathParameters: { skill_id: SKILL_ID },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as never,
    resource: "/validate/{skill_id}",
  };
}

function latestSkill(overrides: Record<string, unknown> = {}) {
  return {
    skill_id: SKILL_ID,
    version_number: 4,
    status: "partial",
    confidence: 0.4,
    latency_p95_ms: 7000,
    ...overrides,
  };
}

describe("POST /validate/:skill_id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitEvent.mockResolvedValue(undefined);
    mockSqsSend.mockResolvedValue({});
    delete process.env.GAP_QUEUE_URL;
  });

  it("accepts caller-reported alias fields and computes total_tests when omitted", async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [latestSkill()] })
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({
        test_pass_count: 3,
        test_fail_count: 1,
      }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.version).toBe(4);
    expect(body.total_tests).toBe(4);
    expect(body.passed).toBe(3);
    expect(body.failed).toBe(1);
    expect(body.previous_confidence).toBe(0.4);
    expect(body.new_confidence).toBeCloseTo(0.75);
    expect(body.status_changed).toBe(false);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "validate",
        skill_id: SKILL_ID,
        confidence: 0.75,
        success: false,
      }),
    );
  });

  it("uses a specific version when provided", async () => {
    mockSend
      .mockResolvedValueOnce({ Item: latestSkill({ version_number: 2, status: "verified", confidence: 0.9 }) })
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({
        version: 2,
        pass_count: 2,
        fail_count: 0,
        total_tests: 2,
      }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.version).toBe(2);
    expect(body.new_status).toBe("optimized");
    expect(mockSend).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _type: "GetCommand",
        input: expect.objectContaining({
          Key: { skill_id: SKILL_ID, version_number: 2 },
        }),
      }),
    );
  });

  it("returns 400 when counts do not add up", async () => {
    const result = await handler(
      makeEvent({
        pass_count: 1,
        fail_count: 1,
        total_tests: 3,
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.message).toContain("pass_count + fail_count");
  });

  it("returns 409 when the skill is archived", async () => {
    mockSend.mockResolvedValueOnce({ Items: [latestSkill({ status: "archived" })] });

    const result = await handler(
      makeEvent({
        pass_count: 1,
        fail_count: 0,
        total_tests: 1,
      }),
    );

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe("SKILL_ARCHIVED");
  });

  it("enqueues low-confidence skills for evolve", async () => {
    process.env.GAP_QUEUE_URL = "https://example.com/gap";
    mockSend
      .mockResolvedValueOnce({ Items: [latestSkill({ confidence: 0.9 })] })
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({
        pass_count: 0,
        fail_count: 2,
        total_tests: 2,
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(mockSqsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        _type: "SendMessageCommand",
        input: expect.objectContaining({
          QueueUrl: "https://example.com/gap",
        }),
      }),
    );
  });
});
