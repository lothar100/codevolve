/**
 * Unit tests for src/auth/deleteApiKey.ts
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
  GetCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  UpdateCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { handler } from "../../../src/auth/deleteApiKey.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  keyId: string | undefined,
  ownerIdApiKey?: string,
  ownerIdCognito?: string,
): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: keyId ? { key_id: keyId } : null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    path: `/auth/keys/${keyId ?? ""}`,
    httpMethod: "DELETE",
    resource: "/auth/keys/{key_id}",
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

describe("deleteApiKey handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 204 when owner revokes their own key", async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          key_id: "key-111",
          owner_id: "user-owner",
          revoked: false,
        },
      })
      .mockResolvedValueOnce({});

    const result = await handler(makeEvent("key-111", "user-owner"));
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe("");
  });

  it("returns 403 when caller is not the key owner", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        key_id: "key-222",
        owner_id: "user-owner",
        revoked: false,
      },
    });

    const result = await handler(makeEvent("key-222", "user-intruder"));
    expect(result.statusCode).toBe(403);
  });

  it("returns 404 when key does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(makeEvent("key-nonexistent", "user-123"));
    expect(result.statusCode).toBe(404);
  });

  it("returns 204 idempotently for already-revoked key", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        key_id: "key-333",
        owner_id: "user-owner",
        revoked: true,
        revoked_at: "2026-04-01T00:00:00.000Z",
      },
    });

    const result = await handler(makeEvent("key-333", "user-owner"));
    expect(result.statusCode).toBe(204);
    // Should not call UpdateCommand for already-revoked keys
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when key_id path param is missing", async () => {
    const result = await handler(makeEvent(undefined, "user-123"));
    expect(result.statusCode).toBe(400);
  });

  it("returns 401 when no owner identity is present", async () => {
    const result = await handler(makeEvent("key-123"));
    expect(result.statusCode).toBe(401);
  });

  it("returns 500 on DynamoDB error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

    const result = await handler(makeEvent("key-999", "user-123"));
    expect(result.statusCode).toBe(500);
  });

  it("uses Cognito sub when api key owner_id is absent", async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          key_id: "key-444",
          owner_id: "cognito-sub-abc",
          revoked: false,
        },
      })
      .mockResolvedValueOnce({});

    const result = await handler(makeEvent("key-444", undefined, "cognito-sub-abc"));
    expect(result.statusCode).toBe(204);
  });
});
