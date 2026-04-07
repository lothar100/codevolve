/**
 * Unit tests for src/auth/listApiKeys.ts
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
  QueryCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { handler } from "../../../src/auth/listApiKeys.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  ownerIdApiKey?: string,
  ownerIdCognito?: string,
): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    path: "/auth/keys",
    httpMethod: "GET",
    resource: "/auth/keys",
    stageVariables: null,
    requestContext: {
      authorizer: {
        ...(ownerIdApiKey ? { owner_id: ownerIdApiKey } : {}),
        claims: ownerIdCognito ? { sub: ownerIdCognito } : undefined,
      },
    } as unknown as APIGatewayProxyEvent["requestContext"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listApiKeys handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with keys list", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          key_id: "key-1",
          api_key_hash: "SHOULD_NOT_APPEAR",
          owner_id: "user-123",
          name: "Key 1",
          created_at: "2026-04-03T00:00:00.000Z",
          revoked: false,
        },
        {
          key_id: "key-2",
          api_key_hash: "SHOULD_NOT_APPEAR",
          owner_id: "user-123",
          name: "Key 2",
          description: "A description",
          created_at: "2026-04-02T00:00:00.000Z",
          last_used_at: "2026-04-03T00:00:00.000Z",
          revoked: false,
        },
      ],
    });

    const result = await handler(makeEvent("user-123"));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body) as { keys: Array<Record<string, unknown>> };
    expect(body.keys).toHaveLength(2);

    // Must never return the hash
    for (const key of body.keys) {
      expect(key.api_key_hash).toBeUndefined();
      expect(key.api_key).toBeUndefined();
    }

    // Should include expected summary fields
    expect(body.keys[0].key_id).toBe("key-1");
    expect(body.keys[1].description).toBe("A description");
    expect(body.keys[1].last_used_at).toBe("2026-04-03T00:00:00.000Z");
  });

  it("returns 200 with empty array when owner has no keys", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent("user-no-keys"));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body) as { keys: unknown[] };
    expect(body.keys).toHaveLength(0);
  });

  it("uses Cognito sub when api key owner_id is absent", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(undefined, "cognito-sub-789"));
    expect(result.statusCode).toBe(200);
  });

  it("returns 401 when no owner identity is present", async () => {
    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(401);
  });

  it("returns 500 on DynamoDB error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

    const result = await handler(makeEvent("user-123"));
    expect(result.statusCode).toBe(500);
  });
});
