/**
 * Unit tests for src/auth/register.ts
 */

import type { APIGatewayProxyEvent } from "aws-lambda";

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: mockSend }),
  },
  PutCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

import { handler } from "../../../src/auth/register.js";

function makeEvent(body?: unknown): APIGatewayProxyEvent {
  return {
    body: body === undefined ? null : JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    path: "/auth/register",
    httpMethod: "POST",
    resource: "/auth/register",
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
  };
}

describe("register handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a standalone agent and returns the raw first key", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({ name: "Bootstrap key", description: "First key" }),
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.agent_id).toMatch(/^agt_/);
    expect(body.key_id).toBeTruthy();
    expect(body.api_key).toMatch(/^cvk_/);
    expect(body.name).toBe("Bootstrap key");
    expect(body.created_at).toBeTruthy();
    expect(body.owner_id).toBeUndefined();
    const commandInput = mockSend.mock.calls[0][0].input as {
      Item: Record<string, unknown>;
    };
    expect(commandInput.Item.owner_id).toBe(body.agent_id);
    expect(commandInput.Item.owner_type).toBe("agent");
    expect(commandInput.Item.created_via).toBe("self_serve_registration");
  });

  it("defaults the key name when the body is omitted", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.name).toBe("Initial agent key");
  });

  it("returns 400 for invalid JSON body", async () => {
    const event: APIGatewayProxyEvent = {
      ...makeEvent(),
      body: "not-json",
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when name is empty", async () => {
    const result = await handler(makeEvent({ name: "" }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 on DynamoDB error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

    const result = await handler(makeEvent({ name: "Bootstrap key" }));

    expect(result.statusCode).toBe(500);
  });
});
