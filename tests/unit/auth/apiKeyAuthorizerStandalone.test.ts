/**
 * Regression tests for standalone-agent API key authorization.
 */

import type { APIGatewayTokenAuthorizerEvent } from "aws-lambda";

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: mockSend }),
  },
  GetCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  QueryCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  UpdateCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

import { handler } from "../../../src/auth/apiKeyAuthorizer.js";

const VALID_KEY = `cvk_${"a".repeat(48)}`;
const METHOD_ARN =
  "arn:aws:execute-api:us-east-2:123456789012:abc123/v1/POST/auth/keys";

function makeEvent(): APIGatewayTokenAuthorizerEvent {
  return {
    type: "TOKEN",
    authorizationToken: VALID_KEY,
    methodArn: METHOD_ARN,
  };
}

describe("apiKeyAuthorizer standalone agent coverage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows a standalone registration key without requiring an account lookup", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            key_id: "key-standalone",
            owner_id: "agt_123",
            owner_type: "agent",
            created_via: "self_serve_registration",
            revoked: false,
            api_key_hash: "somehash",
            name: "bootstrap key",
            created_at: new Date().toISOString(),
          },
        ],
      })
      .mockResolvedValueOnce({});

    const result = await handler(makeEvent());

    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
    expect(result.principalId).toBe("agt_123");
    expect(result.context).toMatchObject({
      owner_id: "agt_123",
      account_id: "agt_123",
      key_id: "key-standalone",
    });
    expect(result.context?.["agent_id"]).toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
