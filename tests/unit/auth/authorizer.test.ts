/**
 * Unit tests for src/auth/authorizer.ts
 *
 * Mocks `aws-jwt-verify` so no real Cognito calls are made.
 */

import { APIGatewayTokenAuthorizerEvent } from "aws-lambda";

// ---- Mock aws-jwt-verify before importing the handler ----

const mockVerify = jest.fn();

jest.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({
      verify: mockVerify,
    })),
  },
}));

// Set required env vars before the module is loaded.
process.env["COGNITO_USER_POOL_ID"] = "us-east-2_testpool";
process.env["COGNITO_CLIENT_ID"] = "testclientid";

import { handler } from "../../../src/auth/authorizer.js";

// ---- Helpers ----

function makeEvent(
  authorizationToken: string,
  methodArn = "arn:aws:execute-api:us-east-2:123456789:testapi/v1/POST/skills",
): APIGatewayTokenAuthorizerEvent {
  return {
    type: "TOKEN",
    authorizationToken,
    methodArn,
  };
}

// ---- Tests ----

describe("authorizer handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns Allow policy for a valid Bearer token", async () => {
    mockVerify.mockResolvedValueOnce({ sub: "user-abc-123" });

    const result = await handler(makeEvent("Bearer valid.jwt.token"));

    const stmt = result.policyDocument.Statement[0] as unknown as Record<string, unknown>;
    expect(result.principalId).toBe("user-abc-123");
    expect(stmt?.["Effect"]).toBe("Allow");
    expect(stmt?.["Action"]).toBe("execute-api:Invoke");
  });

  it("returns Deny policy for an invalid/expired token", async () => {
    mockVerify.mockRejectedValueOnce(new Error("Token expired"));

    const result = await handler(makeEvent("Bearer expired.jwt.token"));

    expect(result.principalId).toBe("anonymous");
    expect(result.policyDocument.Statement[0]?.Effect).toBe("Deny");
  });

  it("returns Deny policy when Authorization header is missing", async () => {
    const result = await handler(makeEvent(""));

    expect(result.principalId).toBe("anonymous");
    expect(result.policyDocument.Statement[0]?.Effect).toBe("Deny");
    // verify should never be called with a missing token
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns Deny policy when Authorization header has no Bearer prefix", async () => {
    const result = await handler(makeEvent("Basic dXNlcjpwYXNz"));

    expect(result.principalId).toBe("anonymous");
    expect(result.policyDocument.Statement[0]?.Effect).toBe("Deny");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns Deny policy when token part is empty (just 'Bearer ')", async () => {
    const result = await handler(makeEvent("Bearer "));

    expect(result.principalId).toBe("anonymous");
    expect(result.policyDocument.Statement[0]?.Effect).toBe("Deny");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("uses sub from JWT payload as principalId", async () => {
    mockVerify.mockResolvedValueOnce({ sub: "sub-xyz-999", email: "a@b.com" });

    const result = await handler(makeEvent("Bearer another.valid.token"));

    expect(result.principalId).toBe("sub-xyz-999");
    expect(result.policyDocument.Statement[0]?.Effect).toBe("Allow");
  });

  it("uses 'unknown' as principalId when payload sub is not a string", async () => {
    mockVerify.mockResolvedValueOnce({ sub: 42 });

    const result = await handler(makeEvent("Bearer valid.no-string-sub"));

    expect(result.principalId).toBe("unknown");
    expect(result.policyDocument.Statement[0]?.Effect).toBe("Allow");
  });
});
