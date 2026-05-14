/**
 * Unit tests for src/auth/createApiKey.ts
 */

import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mock AWS SDK
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { handler } from "../../../src/auth/createApiKey.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  body: unknown,
  ownerIdApiKey?: string,
  ownerIdCognito?: string,
  authorizerOverrides?: Record<string, unknown>,
): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    path: "/auth/keys",
    httpMethod: "POST",
    resource: "/auth/keys",
    stageVariables: null,
    requestContext: {
      authorizer: {
        ...(ownerIdApiKey ? { owner_id: ownerIdApiKey } : {}),
        claims: ownerIdCognito ? { sub: ownerIdCognito } : undefined,
        ...authorizerOverrides,
      },
    } as unknown as APIGatewayProxyEvent["requestContext"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createApiKey handler", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("creates a key and returns 201 with the raw key", async () => {
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ name: "My Agent Key" }, "user-api-123");
    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.api_key).toMatch(/^cvk_/);
    expect(body.name).toBe("My Agent Key");
    expect(body.owner_id).toBe("user-api-123");
    expect(body.key_id).toBeTruthy();
    expect(body.created_at).toBeTruthy();
    // Must not expose hash
    expect(body.api_key_hash).toBeUndefined();
  });

  it("falls back to Cognito sub when api key owner_id is absent", async () => {
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ name: "Human Key" }, undefined, "cognito-sub-456");
    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.owner_id).toBe("cognito-sub-456");
  });

  it("keeps standalone agent ownership for agent-authenticated key creation", async () => {
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent(
      { name: "Child Agent Key" },
      "agt_123",
      undefined,
      { account_id: "agt_123", agent_id: "agt_123" },
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.owner_id).toBe("agt_123");

    const commandInput = mockSend.mock.calls[0][0].input as {
      Item: Record<string, unknown>;
    };
    expect(commandInput.Item.owner_id).toBe("agt_123");
    expect(commandInput.Item.account_id).toBe("agt_123");
    expect(commandInput.Item.agent_id).toBe("agt_123");
    expect(commandInput.Item.owner_type).toBe("agent");
    expect(commandInput.Item.created_via).toBe("authenticated_key_management");
  });

  it("preserves account and agent identity for child keys minted from api-key auth", async () => {
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent(
      { name: "Rotated Key" },
      "acct_123",
      undefined,
      { account_id: "acct_123", agent_id: "agt_child_1" },
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    const commandInput = mockSend.mock.calls[0][0].input as {
      Item: Record<string, unknown>;
    };
    expect(commandInput.Item.owner_id).toBe("acct_123");
    expect(commandInput.Item.account_id).toBe("acct_123");
    expect(commandInput.Item.agent_id).toBe("agt_child_1");
    expect(commandInput.Item.owner_type).toBe("agent");
  });

  it("returns 401 when no owner identity is present", async () => {
    const event = makeEvent({ name: "Key" });
    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    const event: APIGatewayProxyEvent = {
      body: "not-json",
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
      isBase64Encoded: false,
      path: "/auth/keys",
      httpMethod: "POST",
      resource: "/auth/keys",
      stageVariables: null,
      requestContext: {
        authorizer: { owner_id: "user-123" },
      } as unknown as APIGatewayProxyEvent["requestContext"],
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({}, "user-123");
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 on DynamoDB error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

    const event = makeEvent({ name: "Key" }, "user-123");
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
  });

  it("generates a unique raw key each call", async () => {
    mockSend.mockResolvedValue({});

    const event = makeEvent({ name: "Key" }, "user-123");
    const r1 = await handler(event);
    const r2 = await handler(event);

    const b1 = JSON.parse(r1.body) as Record<string, unknown>;
    const b2 = JSON.parse(r2.body) as Record<string, unknown>;
    expect(b1.api_key).not.toBe(b2.api_key);
  });
});
