/**
 * Unit tests for src/auth/apiKeyAuthorizer.ts
 */

import type { APIGatewayTokenAuthorizerEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mock @aws-sdk/lib-dynamodb before importing the handler
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
  UpdateCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

// ---------------------------------------------------------------------------
// Import after mocks are wired
// ---------------------------------------------------------------------------

import { handler } from "../../../src/auth/apiKeyAuthorizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEY_PREFIX = "cvk_";
const VALID_KEY = `${KEY_PREFIX}${"a".repeat(48)}`;
const METHOD_ARN = "arn:aws:execute-api:us-east-2:123456789012:abc123/v1/POST/skills";

function makeEvent(authorizationToken: string): APIGatewayTokenAuthorizerEvent {
  return {
    type: "TOKEN",
    authorizationToken,
    methodArn: METHOD_ARN,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("apiKeyAuthorizer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows a valid, non-revoked key", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          key_id: "key-123",
          owner_id: "user-abc",
          revoked: false,
          api_key_hash: "somehash",
          name: "test key",
          created_at: new Date().toISOString(),
        },
      ],
    });
    // fire-and-forget UpdateCommand
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(VALID_KEY));

    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
    expect(result.principalId).toBe("user-abc");
  });

  it("denies a revoked key", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          key_id: "key-456",
          owner_id: "user-abc",
          revoked: true,
          api_key_hash: "somehash",
          name: "revoked key",
          created_at: new Date().toISOString(),
          revoked_at: new Date().toISOString(),
        },
      ],
    });

    const result = await handler(makeEvent(VALID_KEY));

    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
    expect(result.principalId).toBe("anonymous");
  });

  it("denies a non-existent key", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(VALID_KEY));

    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
    expect(result.principalId).toBe("anonymous");
  });

  it("denies a malformed key without cvk_ prefix", async () => {
    const result = await handler(makeEvent("invalidkey_noprefixhere"));

    // Should not even call DynamoDB
    expect(mockSend).not.toHaveBeenCalled();
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
    expect(result.principalId).toBe("anonymous");
  });

  it("denies an empty token", async () => {
    const result = await handler(makeEvent(""));

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  it("denies when DynamoDB throws", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler(makeEvent(VALID_KEY));

    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  it("does not crash when last_used_at update fails (fire-and-forget)", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            key_id: "key-789",
            owner_id: "user-xyz",
            revoked: false,
            api_key_hash: "somehash",
            name: "test key",
            created_at: new Date().toISOString(),
          },
        ],
      })
      .mockRejectedValueOnce(new Error("Update failed"));

    const result = await handler(makeEvent(VALID_KEY));

    // Should still allow despite the fire-and-forget update failing
    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
  });
});
