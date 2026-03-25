/**
 * Unit tests for the JWT authorizer Lambda.
 *
 * Tests cover:
 * - JWT extraction and validation
 * - Auth rejection (missing token, invalid token, expired token, wrong issuer)
 * - JWKS key lookup (kid mismatch)
 * - IAM policy structure
 */

import type { APIGatewayTokenAuthorizerEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

// We mock the https module to avoid real network calls in unit tests
const mockHttpsGet = jest.fn();
jest.mock("https", () => ({
  get: (url: unknown, callback: unknown) => mockHttpsGet(url, callback),
}));

// We mock crypto to control signature verification
const mockVerifyUpdate = jest.fn();
const mockVerifyVerify = jest.fn();
const mockCreateVerify = jest.fn(() => ({
  update: mockVerifyUpdate,
  verify: mockVerifyVerify,
}));
const mockCreatePublicKey = jest.fn();

jest.mock("crypto", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createVerify: (alg: any) => (mockCreateVerify as any)(alg),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createPublicKey: (input: any) => (mockCreatePublicKey as any)(input),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { handler, verifyToken, resetJwksCache } from "../../../src/auth/authorizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_POOL_ID = "us-east-2_TestPool";
const REGION = "us-east-2";

beforeEach(() => {
  jest.clearAllMocks();
  process.env.COGNITO_USER_POOL_ID = USER_POOL_ID;
  process.env.COGNITO_REGION = REGION;
  process.env.AWS_REGION = REGION;
  // Reset the in-module JWKS cache so each test fetches fresh keys
  resetJwksCache();
});

/**
 * Build a fake JWT with the given header and claims.
 * The signature field is arbitrary — crypto.createVerify is mocked.
 */
function buildFakeJwt(header: object, claims: object, sig = "fakesig"): string {
  const encodeB64Url = (obj: object): string =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  return `${encodeB64Url(header)}.${encodeB64Url(claims)}.${sig}`;
}

function makeAuthorizerEvent(token: string): APIGatewayTokenAuthorizerEvent {
  return {
    type: "TOKEN",
    authorizationToken: `Bearer ${token}`,
    methodArn: "arn:aws:execute-api:us-east-2:123456789:abc123/v1/POST/skills",
  };
}

/**
 * Set up the https mock to return a JWKS with one key.
 */
function mockJwksSuccess(kid = "test-kid"): void {
  const jwksResponse = JSON.stringify({
    keys: [
      {
        kid,
        kty: "RSA",
        alg: "RS256",
        use: "sig",
        n: "test-n-value",
        e: "AQAB",
      },
    ],
  });

  mockHttpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
    const mockRes = {
      statusCode: 200,
      on: jest.fn((event: string, handler: (data?: string) => void) => {
        if (event === "data") {
          handler(jwksResponse);
        } else if (event === "end") {
          handler();
        }
      }),
    };
    callback(mockRes);
    return { on: jest.fn(), setTimeout: jest.fn() };
  });
}

// ---------------------------------------------------------------------------
// Tests: handler — Authorization header extraction
// ---------------------------------------------------------------------------

describe("handler — Authorization header", () => {
  it("returns Deny when Authorization header is missing", async () => {
    const event: APIGatewayTokenAuthorizerEvent = {
      type: "TOKEN",
      authorizationToken: "",
      methodArn: "arn:aws:execute-api:us-east-2:123:abc/v1/POST/skills",
    };
    const result = await handler(event);
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
    expect(result.principalId).toBe("anonymous");
  });

  it("returns Deny when token does not start with 'Bearer '", async () => {
    const event: APIGatewayTokenAuthorizerEvent = {
      type: "TOKEN",
      authorizationToken: "Basic dXNlcjpwYXNz",
      methodArn: "arn:aws:execute-api:us-east-2:123:abc/v1/POST/skills",
    };
    const result = await handler(event);
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  it("returns Deny when JWT is malformed (not 3 parts)", async () => {
    const event = makeAuthorizerEvent("not.a.valid.jwt.here");
    const result = await handler(event);
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });
});

// ---------------------------------------------------------------------------
// Tests: verifyToken — claim validation
// ---------------------------------------------------------------------------

describe("verifyToken — claim validation", () => {
  beforeEach(() => {
    mockJwksSuccess("test-kid");
    mockCreatePublicKey.mockReturnValue({});
    mockVerifyUpdate.mockReturnValue(undefined);
    mockVerifyVerify.mockReturnValue(true);
  });

  it("rejects an expired token", async () => {
    const expiredClaims = {
      sub: "user-123",
      iss: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      iat: Math.floor(Date.now() / 1000) - 7200,
    };
    const token = buildFakeJwt({ kid: "test-kid", alg: "RS256" }, expiredClaims);
    await expect(verifyToken(token)).rejects.toThrow("Token expired");
  });

  it("rejects a token with a wrong issuer", async () => {
    const claims = {
      sub: "user-123",
      iss: "https://cognito-idp.us-west-2.amazonaws.com/wrong-pool",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = buildFakeJwt({ kid: "test-kid", alg: "RS256" }, claims);
    await expect(verifyToken(token)).rejects.toThrow("Invalid issuer");
  });

  it("rejects a token with a non-RS256 algorithm", async () => {
    const claims = {
      sub: "user-123",
      iss: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = buildFakeJwt({ kid: "test-kid", alg: "HS256" }, claims);
    await expect(verifyToken(token)).rejects.toThrow("Unsupported algorithm");
  });

  it("rejects a token when no matching kid is found in JWKS", async () => {
    const claims = {
      sub: "user-123",
      iss: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    // kid in token does not match the mocked JWKS key ("test-kid")
    const token = buildFakeJwt({ kid: "unknown-kid", alg: "RS256" }, claims);
    await expect(verifyToken(token)).rejects.toThrow("No JWKS key found for kid");
  });

  it("rejects a token with an invalid signature", async () => {
    mockVerifyVerify.mockReturnValue(false); // signature check fails
    const claims = {
      sub: "user-123",
      iss: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = buildFakeJwt({ kid: "test-kid", alg: "RS256" }, claims);
    await expect(verifyToken(token)).rejects.toThrow("Invalid JWT signature");
  });

  it("accepts a valid token and returns claims", async () => {
    const expectedSub = "user-abc-123";
    const claims = {
      sub: expectedSub,
      email: "user@example.com",
      iss: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = buildFakeJwt({ kid: "test-kid", alg: "RS256" }, claims);
    const result = await verifyToken(token);
    expect(result.sub).toBe(expectedSub);
    expect(result.email).toBe("user@example.com");
  });
});

// ---------------------------------------------------------------------------
// Tests: handler — IAM policy output
// ---------------------------------------------------------------------------

describe("handler — IAM policy output", () => {
  const methodArn = "arn:aws:execute-api:us-east-2:123456789:abc123/v1/POST/skills";

  beforeEach(() => {
    mockJwksSuccess("test-kid");
    mockCreatePublicKey.mockReturnValue({});
    mockVerifyUpdate.mockReturnValue(undefined);
    mockVerifyVerify.mockReturnValue(true);
  });

  it("returns Allow policy with userId in context for a valid token", async () => {
    const userId = "cognito-user-xyz";
    const claims = {
      sub: userId,
      email: "xyz@example.com",
      iss: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = buildFakeJwt({ kid: "test-kid", alg: "RS256" }, claims);
    const event = makeAuthorizerEvent(token);

    const result = await handler(event);

    expect(result.principalId).toBe(userId);
    const stmt = result.policyDocument.Statement[0] as {
      Effect: string;
      Resource?: string;
    };
    expect(stmt.Effect).toBe("Allow");
    expect(stmt.Resource).toBe(methodArn);
    expect(result.context?.["userId"]).toBe(userId);
    expect(result.context?.["email"]).toBe("xyz@example.com");
  });

  it("returns Deny policy for an invalid token", async () => {
    mockVerifyVerify.mockReturnValue(false);
    const claims = {
      sub: "user-123",
      iss: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = buildFakeJwt({ kid: "test-kid", alg: "RS256" }, claims);
    const event = makeAuthorizerEvent(token);

    const result = await handler(event);

    expect(result.principalId).toBe("anonymous");
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  it("policy document Version is 2012-10-17", async () => {
    const event: APIGatewayTokenAuthorizerEvent = {
      type: "TOKEN",
      authorizationToken: "",
      methodArn,
    };
    const result = await handler(event);
    expect(result.policyDocument.Version).toBe("2012-10-17");
  });
});
