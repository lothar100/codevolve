/**
 * TOKEN-type Lambda authorizer for API key authentication.
 *
 * Validates X-Api-Key header values against the codevolve-api-keys table.
 * Key lookup uses the gsi-key-hash GSI (O(1) by SHA-256 hash of the key).
 *
 * Rules:
 * - Key must exist in the table.
 * - Key must not be revoked.
 * - Key must belong to an active account when account metadata is present.
 * - Key must have the cvk_ prefix (malformed keys are denied immediately).
 *
 * This handler NEVER throws - it always returns Allow or Deny.
 *
 * Environment variables required:
 *   API_KEYS_TABLE - DynamoDB table name for codevolve-api-keys
 *   ACCOUNTS_TABLE - DynamoDB table name for codevolve accounts
 */

import * as crypto from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
} from "aws-lambda";
import {
  DEFAULT_RESPONSE_FORMAT,
  normalizeResponseFormat,
} from "../shared/responseFormat.js";

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const API_KEYS_TABLE =
  process.env.API_KEYS_TABLE ?? "codevolve-api-keys";
const ACCOUNTS_TABLE =
  process.env.ACCOUNTS_TABLE ?? "codevolve-accounts";

const KEY_PREFIX = "cvk_";

interface ApiKeyRecord {
  key_id: string;
  api_key_hash: string;
  owner_id: string;
  account_id?: string;
  agent_id?: string;
  name: string;
  description?: string;
  created_at: string;
  last_used_at?: string;
  revoked: boolean;
  revoked_at?: string;
}

interface AccountRecord {
  account_id: string;
  status?: string;
  suspended_at?: string;
  response_format?: string;
}

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

async function lookupAccountById(accountId: string): Promise<AccountRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: ACCOUNTS_TABLE,
      Key: { account_id: accountId },
    }),
  );

  return (result.Item as AccountRecord | undefined) ?? null;
}

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

export const handler = async (
  event: APIGatewayTokenAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  const rawKey = event.authorizationToken ?? "";

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

    const resolvedAccountId = record.account_id ?? record.owner_id;

    let account: AccountRecord | null = null;
    if (resolvedAccountId) {
      account = await lookupAccountById(resolvedAccountId);
      if (account?.status === "suspended") {
        console.warn("[apiKeyAuthorizer] Account is suspended:", resolvedAccountId);
        return buildPolicy("anonymous", "Deny", event.methodArn);
      }
    }

    updateLastUsed(record.key_id);
    const resolvedResponseFormat =
      normalizeResponseFormat(account?.response_format) ??
      DEFAULT_RESPONSE_FORMAT;

    console.info("[apiKeyAuthorizer] Key accepted for owner:", record.owner_id);
    return buildPolicy(record.owner_id, "Allow", event.methodArn, {
      owner_id: record.owner_id,
      account_id: resolvedAccountId,
      ...(record.agent_id ? { agent_id: record.agent_id } : {}),
      key_id: record.key_id,
      response_format: resolvedResponseFormat,
    });
  } catch (err) {
    console.error("[apiKeyAuthorizer] Unexpected error:", String(err));
    return buildPolicy("anonymous", "Deny", event.methodArn);
  }
};
