/**
 * TOKEN-type Lambda authorizer for API key authentication.
 *
 * Validates X-Api-Key header values against the codevolve-api-keys table.
 * Key lookup uses the gsi-key-hash GSI (O(1) by SHA-256 hash of the key).
 *
 * Rules:
 * - Key must exist in the table.
 * - Key must not be revoked.
 * - Key must have the cvk_ prefix (malformed keys are denied immediately).
 *
 * This handler NEVER throws — it always returns Allow or Deny.
 *
 * Environment variables required:
 *   API_KEYS_TABLE — DynamoDB table name for codevolve-api-keys
 */

import * as crypto from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
} from "aws-lambda";

// ---------------------------------------------------------------------------
// DynamoDB client
// ---------------------------------------------------------------------------

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEYS_TABLE =
  process.env.API_KEYS_TABLE ?? "codevolve-api-keys";

const KEY_PREFIX = "cvk_";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiKeyRecord {
  key_id: string;
  api_key_hash: string;
  owner_id: string;
  name: string;
  description?: string;
  created_at: string;
  last_used_at?: string;
  revoked: boolean;
  revoked_at?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

async function lookupKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: API_KEYS_TABLE,
      IndexName: "gsi-key-hash",
      KeyConditionExpression: "api_key_hash = :h",
      ExpressionAttributeValues: { ":h": hash },
      Limit: 1,
    }),
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as ApiKeyRecord;
}

/**
 * Fire-and-forget last_used_at update. Never awaited, never crashes the handler.
 */
function updateLastUsed(keyId: string): void {
  const now = new Date().toISOString();
  docClient
    .send(
      new UpdateCommand({
        TableName: API_KEYS_TABLE,
        Key: { key_id: keyId },
        UpdateExpression: "SET last_used_at = :now",
        ExpressionAttributeValues: { ":now": now },
      }),
    )
    .catch((err: unknown) => {
      console.error("[apiKeyAuthorizer] Failed to update last_used_at:", String(err));
    });
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
  const rawKey = event.authorizationToken ?? "";

  // Reject keys without the expected prefix immediately
  if (!rawKey.startsWith(KEY_PREFIX)) {
    console.warn("[apiKeyAuthorizer] Key missing cvk_ prefix");
    return buildPolicy("anonymous", "Deny", event.methodArn);
  }

  try {
    const hash = hashKey(rawKey);
    const record = await lookupKeyByHash(hash);

    if (record === null) {
      console.warn("[apiKeyAuthorizer] Key not found");
      return buildPolicy("anonymous", "Deny", event.methodArn);
    }

    if (record.revoked) {
      console.warn("[apiKeyAuthorizer] Key is revoked:", record.key_id);
      return buildPolicy("anonymous", "Deny", event.methodArn);
    }

    // Fire-and-forget last_used_at update — do not await
    updateLastUsed(record.key_id);

    console.info("[apiKeyAuthorizer] Key accepted for owner:", record.owner_id);
    return buildPolicy(record.owner_id, "Allow", event.methodArn, {
      owner_id: record.owner_id,
      key_id: record.key_id,
    });
  } catch (err) {
    console.error("[apiKeyAuthorizer] Unexpected error:", String(err));
    return buildPolicy("anonymous", "Deny", event.methodArn);
  }
};
