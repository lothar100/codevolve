/**
 * POST /auth/keys — Create a new API key.
 *
 * Auth: Cognito ID token (human) or existing API key (agents can self-issue).
 * The raw key is returned exactly once in the response and is never stored.
 * Only the SHA-256 hash is persisted in the codevolve-api-keys table.
 *
 * Response 201 with { key_id, api_key, name, created_at, owner_id }.
 *
 * Environment variables required:
 *   API_KEYS_TABLE — DynamoDB table name for codevolve-api-keys
 */

import * as crypto from "crypto";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, API_KEYS_TABLE } from "./shared.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
});

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

const KEY_PREFIX = "cvk_";

/**
 * Generate a new raw API key: `cvk_` + 48 base64url chars (from 36 random bytes).
 */
function generateRawKey(): string {
  return KEY_PREFIX + crypto.randomBytes(36).toString("base64url");
}

function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    // Derive owner_id from authorizer context (API key or Cognito)
    const ownerIdFromApiKey =
      event.requestContext?.authorizer?.["owner_id"] as string | undefined;
    const ownerIdFromCognito =
      event.requestContext?.authorizer?.claims?.["sub"] as string | undefined;
    const ownerId = ownerIdFromApiKey ?? ownerIdFromCognito;

    if (!ownerId) {
      return error(401, "UNAUTHORIZED", "Missing or invalid authorization");
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
    }

    const validation = validate(CreateApiKeyRequestSchema, body);
    if (!validation.success) {
      return error(
        400,
        validation.error.code,
        validation.error.message,
        validation.error.details,
      );
    }

    const data = validation.data;
    const rawKey = generateRawKey();
    const keyHash = hashKey(rawKey);
    const keyId = crypto.randomUUID();
    const now = new Date().toISOString();

    const item: Record<string, unknown> = {
      key_id: keyId,
      api_key_hash: keyHash,
      owner_id: ownerId,
      name: data.name,
      created_at: now,
      revoked: false,
    };

    if (data.description !== undefined) {
      item["description"] = data.description;
    }

    await docClient.send(
      new PutCommand({
        TableName: API_KEYS_TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(key_id)",
      }),
    );

    // Return the raw key ONCE — never stored, shown only here
    return success(201, {
      key_id: keyId,
      api_key: rawKey,
      name: data.name,
      created_at: now,
      owner_id: ownerId,
    });
  } catch (err) {
    console.error("createApiKey error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
};
