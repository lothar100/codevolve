/**
 * Shared DynamoDB client and constants for auth handlers.
 */

import * as crypto from "crypto";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const API_KEYS_TABLE =
  process.env.API_KEYS_TABLE ?? "codevolve-api-keys";
export const ACCOUNTS_TABLE =
  process.env.ACCOUNTS_TABLE ?? "codevolve-accounts";

export const API_KEY_PREFIX = "cvk_";
export const AGENT_ID_PREFIX = "agt_";

export interface AuthContext {
  accountId: string;
  authSource: "api_key" | "cognito";
}

export interface ApiKeyWriteInput {
  ownerId: string;
  name: string;
  description?: string;
  ownerType?: "agent" | "user";
  createdVia?: "self_serve_registration" | "authenticated_key_management";
}

export interface ApiKeyWriteRecord {
  keyId: string;
  rawKey: string;
  keyHash: string;
  createdAt: string;
  item: Record<string, unknown>;
}

export interface StandaloneAccountBootstrapInput {
  accountId: string;
  agentId: string;
  agentName: string;
  createdAt?: string;
}

export function generateStandaloneAgentId(): string {
  return `${AGENT_ID_PREFIX}${crypto.randomUUID()}`;
}

export function generateStandaloneAgentName(): string {
  return `Standalone agent ${crypto.randomUUID().slice(0, 8)}`;
}

export function deriveOwnerId(
  event: APIGatewayProxyEvent,
): string | undefined {
  const ownerIdFromApiKey =
    event.requestContext?.authorizer?.["owner_id"] as string | undefined;
  const ownerIdFromAuthorizer =
    event.requestContext?.authorizer?.["userId"] as string | undefined;
  const ownerIdFromCognito =
    event.requestContext?.authorizer?.claims?.["sub"] as string | undefined;
  const ownerIdFromPrincipal =
    event.requestContext?.authorizer?.principalId as string | undefined;

  return (
    ownerIdFromApiKey ??
    ownerIdFromAuthorizer ??
    ownerIdFromCognito ??
    ownerIdFromPrincipal
  );
}

export function deriveAuthContext(
  event: APIGatewayProxyEvent,
): AuthContext | undefined {
  const ownerIdFromApiKey =
    event.requestContext?.authorizer?.["owner_id"] as string | undefined;

  if (ownerIdFromApiKey) {
    return {
      accountId: ownerIdFromApiKey,
      authSource: "api_key",
    };
  }

  const accountId = deriveOwnerId(event);
  if (!accountId) {
    return undefined;
  }

  return {
    accountId,
    authSource: "cognito",
  };
}

export function generateRawKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(36).toString("base64url");
}

export function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function buildApiKeyRecord(input: ApiKeyWriteInput): ApiKeyWriteRecord {
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const item: Record<string, unknown> = {
    key_id: keyId,
    api_key_hash: keyHash,
    owner_id: input.ownerId,
    name: input.name,
    created_at: createdAt,
    revoked: false,
  };

  if (input.description !== undefined) {
    item["description"] = input.description;
  }

  if (input.ownerType !== undefined) {
    item["owner_type"] = input.ownerType;
  }

  if (input.createdVia !== undefined) {
    item["created_via"] = input.createdVia;
  }

  return {
    keyId,
    rawKey,
    keyHash,
    createdAt,
    item,
  };
}

export function buildStandaloneAccountRecord(
  input: StandaloneAccountBootstrapInput,
): Record<string, unknown> {
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    account_id: input.accountId,
    agent_id: input.agentId,
    agent_name: input.agentName,
    status: "active",
    created_at: createdAt,
    updated_at: createdAt,
  };
}
