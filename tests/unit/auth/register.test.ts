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
  TransactWriteCommand: jest.fn().mockImplementation((params) => ({
    input: params,
  })),
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

  it("creates a standalone account bootstrap and returns the raw first key", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({ name: "Beta smoke agent", description: "First key" }),
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.account_id).toMatch(/^agt_/);
    expect(body.agent_id).toMatch(/^agt_/);
    expect(body.account_id).toBe(body.agent_id);
    expect(body.key_id).toBeTruthy();
    expect(body.api_key).toMatch(/^cvk_/);
    expect(body.agent_name).toBe("Beta smoke agent");
    expect(body.name).toBe("Beta smoke agent");
    expect(body.key_name).toBe("Initial agent key");
    expect(body.created_at).toBeTruthy();
    expect(body.owner_id).toBeUndefined();
    const commandInput = mockSend.mock.calls[0][0].input as {
      TransactItems: Array<{
        Put: {
          TableName: string;
          Item: Record<string, unknown>;
        };
      }>;
    };
    expect(commandInput.TransactItems).toHaveLength(2);
    expect(commandInput.TransactItems[0].Put.Item.account_id).toBe(body.account_id);
    expect(commandInput.TransactItems[0].Put.Item.agent_id).toBe(body.agent_id);
    expect(commandInput.TransactItems[0].Put.Item.agent_name).toBe("Beta smoke agent");
    expect(commandInput.TransactItems[0].Put.Item.status).toBe("active");
    expect(commandInput.TransactItems[1].Put.Item.owner_id).toBe(body.account_id);
    expect(commandInput.TransactItems[1].Put.Item.account_id).toBe(body.account_id);
    expect(commandInput.TransactItems[1].Put.Item.agent_id).toBe(body.agent_id);
    expect(commandInput.TransactItems[1].Put.Item.owner_type).toBe("agent");
    expect(commandInput.TransactItems[1].Put.Item.created_via).toBe("self_serve_registration");
  });

  it("accepts the drifted agent_name payload shape", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent({ agent_name: "Live drift agent" }));

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.agent_name).toBe("Live drift agent");
    expect(body.name).toBe("Live drift agent");
    expect(body.key_name).toBe("Initial agent key");
  });

  it("prefers agent_name when both compatibility fields are present", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({
        agent_name: "Preferred agent name",
        name: "Legacy compatibility name",
        key_name: "Bootstrap key",
      }),
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.agent_name).toBe("Preferred agent name");
    expect(body.name).toBe("Legacy compatibility name");
    expect(body.key_name).toBe("Bootstrap key");
  });

  it("defaults the agent and key names when the body is omitted", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.agent_name).toMatch(/^Standalone agent [0-9a-f]{8}$/);
    expect(body.name).toBe(body.agent_name);
    expect(body.key_name).toBe("Initial agent key");
  });

  it("generates an agent name when only key metadata is provided", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({
        key_name: "Bootstrap key",
        description: "Generated-name path",
      }),
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.agent_name).toMatch(/^Standalone agent [0-9a-f]{8}$/);
    expect(body.name).toBe(body.agent_name);
    expect(body.key_name).toBe("Bootstrap key");
  });

  it("returns 400 for invalid JSON body", async () => {
    const event: APIGatewayProxyEvent = {
      ...makeEvent(),
      body: "not-json",
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when both name aliases are empty", async () => {
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
