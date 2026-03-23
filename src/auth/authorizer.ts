/**
 * Cognito JWT custom authorizer Lambda.
 *
 * Used as a backup authorizer for non-native-Cognito integrations.
 * Validates a Bearer token from the Authorization header against the
 * configured Cognito User Pool and returns an IAM policy document.
 *
 * Environment variables:
 *   COGNITO_USER_POOL_ID  — e.g. "us-east-2_abc123"
 *   COGNITO_CLIENT_ID     — App client ID for the user pool
 */

import {
  APIGatewayTokenAuthorizerEvent,
  APIGatewayAuthorizerResult,
  StatementEffect,
} from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";

const USER_POOL_ID = process.env["COGNITO_USER_POOL_ID"] ?? "";
const CLIENT_ID = process.env["COGNITO_CLIENT_ID"] ?? "";

// Verifier is created at cold-start and reused across invocations (JWKS caching).
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "access",
  clientId: CLIENT_ID,
});

/**
 * Build a minimal IAM policy document for API Gateway.
 */
function buildPolicy(
  principalId: string,
  effect: StatementEffect,
  methodArn: string,
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: methodArn,
        },
      ],
    },
  };
}

export const handler = async (
  event: APIGatewayTokenAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  const token = event.authorizationToken ?? "";

  // Expect "Bearer <jwt>"
  const parts = token.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
    console.warn("Authorizer: missing or malformed Authorization header");
    return buildPolicy("anonymous", "Deny", event.methodArn);
  }

  const jwt = parts[1];

  try {
    const payload = await verifier.verify(jwt);
    const sub = typeof payload["sub"] === "string" ? payload["sub"] : "unknown";
    console.info("Authorizer: token valid for sub=%s", sub);
    return buildPolicy(sub, "Allow", event.methodArn);
  } catch (err) {
    console.warn("Authorizer: token verification failed", err);
    return buildPolicy("anonymous", "Deny", event.methodArn);
  }
};
