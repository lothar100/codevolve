/**
 * Lambda custom authorizer for codeVolve API Gateway.
 *
 * Verifies Cognito-issued JWTs:
 * 1. Extracts Bearer token from Authorization header.
 * 2. Decodes the JWT header to get the key ID (kid).
 * 3. Fetches the JWKS from the Cognito User Pool endpoint.
 * 4. Verifies the JWT signature using the matching public key.
 * 5. Returns an IAM Allow policy on success, Deny on failure.
 *
 * Environment variables required:
 *   COGNITO_USER_POOL_ID  — e.g. us-east-2_AbCdEfGhI
 *   COGNITO_REGION        — e.g. us-east-2 (defaults to AWS_REGION)
 */

import * as https from "https";
import * as crypto from "crypto";
import type {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
} from "aws-lambda";

// ---------------------------------------------------------------------------
// Configuration — read lazily so tests can set process.env before calling
// ---------------------------------------------------------------------------

function getUserPoolId(): string {
  return process.env.COGNITO_USER_POOL_ID ?? "";
}

function getCognitoRegion(): string {
  return process.env.COGNITO_REGION ?? process.env.AWS_REGION ?? "us-east-2";
}

function jwksUrl(): string {
  return `https://cognito-idp.${getCognitoRegion()}.amazonaws.com/${getUserPoolId()}/.well-known/jwks.json`;
}

// ---------------------------------------------------------------------------
// JWKS types
// ---------------------------------------------------------------------------

interface JwksKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface JwksResponse {
  keys: JwksKey[];
}

// ---------------------------------------------------------------------------
// HTTP helper — fetch JWKS (no external libraries)
// ---------------------------------------------------------------------------

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`JWKS fetch failed: HTTP ${res.statusCode}`));
        return;
      }
      let raw = "";
      res.on("data", (chunk: string) => {
        raw += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw) as T);
        } catch (err) {
          reject(new Error(`JWKS parse error: ${String(err)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error("JWKS request timed out"));
    });
  });
}

// ---------------------------------------------------------------------------
// In-memory JWKS cache — refreshed per cold start
// ---------------------------------------------------------------------------

let cachedKeys: JwksKey[] | null = null;

/** Reset the JWKS cache. Exported for use in unit tests only. */
export function resetJwksCache(): void {
  cachedKeys = null;
}

async function getJwksKeys(): Promise<JwksKey[]> {
  if (cachedKeys !== null) {
    return cachedKeys;
  }
  const jwks = await fetchJson<JwksResponse>(jwksUrl());
  cachedKeys = jwks.keys;
  return cachedKeys;
}

// ---------------------------------------------------------------------------
// JWT utilities
// ---------------------------------------------------------------------------

/**
 * Decode a base64url segment (no padding required).
 */
function decodeBase64Url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const padded2 = pad === 0 ? padded : padded + "=".repeat(4 - pad);
  return Buffer.from(padded2, "base64");
}

interface JwtHeader {
  kid: string;
  alg: string;
}

interface JwtClaims {
  sub: string;
  iss: string;
  exp: number;
  iat: number;
  token_use?: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Split a JWT into its three parts (header, payload, signature).
 * Returns null if the token is malformed.
 */
function splitJwt(
  token: string,
): { header: JwtHeader; claims: JwtClaims; signingInput: string; signature: Buffer } | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const header = JSON.parse(decodeBase64Url(parts[0]).toString("utf8")) as JwtHeader;
    const claims = JSON.parse(decodeBase64Url(parts[1]).toString("utf8")) as JwtClaims;
    const signature = decodeBase64Url(parts[2]);
    const signingInput = `${parts[0]}.${parts[1]}`;
    return { header, claims, signingInput, signature };
  } catch {
    return null;
  }
}

/**
 * Build a Node.js crypto PublicKey from a JWK RSA key.
 */
function jwkToPublicKey(jwk: JwksKey): crypto.KeyObject {
  // Build a KeyObject from the JWK components using importPublicKey
  const keyDetails: crypto.JsonWebKeyInput = {
    format: "jwk",
    key: {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: jwk.alg,
      use: jwk.use,
    },
  };
  return crypto.createPublicKey(keyDetails);
}

/**
 * Verify a JWT against the Cognito JWKS endpoint.
 * Returns the decoded claims on success; throws on failure.
 */
export async function verifyToken(token: string): Promise<JwtClaims> {
  const parsed = splitJwt(token);
  if (parsed === null) {
    throw new Error("Malformed JWT");
  }

  const { header, claims, signingInput, signature } = parsed;

  if (header.alg !== "RS256") {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Validate expiry
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSeconds) {
    throw new Error("Token expired");
  }

  // Validate issuer
  const expectedIss = `https://cognito-idp.${getCognitoRegion()}.amazonaws.com/${getUserPoolId()}`;
  if (claims.iss !== expectedIss) {
    throw new Error(`Invalid issuer: ${claims.iss}`);
  }

  // Find matching key
  const keys = await getJwksKeys();
  const matchingKey = keys.find((k) => k.kid === header.kid);
  if (matchingKey === undefined) {
    throw new Error(`No JWKS key found for kid: ${header.kid}`);
  }

  // Verify signature
  const publicKey = jwkToPublicKey(matchingKey);
  const verify = crypto.createVerify("RSA-SHA256");
  verify.update(signingInput);
  const valid = verify.verify(publicKey, signature);

  if (!valid) {
    throw new Error("Invalid JWT signature");
  }

  return claims;
}

// ---------------------------------------------------------------------------
// IAM policy builder
// ---------------------------------------------------------------------------

function buildPolicy(
  principalId: string,
  effect: "Allow" | "Deny",
  resource: string,
  context?: Record<string, string>,
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context: context ?? {},
  };
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayTokenAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  const authHeader = event.authorizationToken ?? "";

  // Extract Bearer token
  if (!authHeader.startsWith("Bearer ")) {
    console.warn("[authorizer] Missing or malformed Authorization header");
    // Returning Deny rather than throwing so API Gateway returns 403
    return buildPolicy("anonymous", "Deny", event.methodArn);
  }

  const token = authHeader.slice("Bearer ".length).trim();

  try {
    const claims = await verifyToken(token);
    const userId = claims.sub;
    console.info("[authorizer] Token valid for user:", userId);
    return buildPolicy(userId, "Allow", event.methodArn, {
      userId,
      email: typeof claims.email === "string" ? claims.email : "",
    });
  } catch (err) {
    console.warn("[authorizer] Token verification failed:", String(err));
    return buildPolicy("anonymous", "Deny", event.methodArn);
  }
};
