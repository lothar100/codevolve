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

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
  AGENT_ID_PREFIX,
  API_KEYS_TABLE,
  buildApiKeyRecord,
  deriveAuthContext,
  docClient,
} from "./shared.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
});

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const authContext = deriveAuthContext(event);

    if (!authContext) {
      return error(401, "UNAUTHORIZED", "Missing or invalid authorization", undefined, event);
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return error(400, "VALIDATION_ERROR", "Invalid JSON in request body", undefined, event);
    }

    const validation = validate(CreateApiKeyRequestSchema, body);
    if (validation.success === false) {
      return error(
        400,
        validation.error.code,
        validation.error.message,
        validation.error.details,
        event,
      );
    }

    const data = validation.data;
    const ownerId = authContext.accountId;
    const accountId =
      (event.requestContext?.authorizer?.["account_id"] as string | undefined) ??
      ownerId;
    const agentId =
      (event.requestContext?.authorizer?.["agent_id"] as string | undefined) ??
      (ownerId.startsWith(AGENT_ID_PREFIX) ? ownerId : undefined);
    const issuedKey = buildApiKeyRecord({
      ownerId,
      name: data.name,
      description: data.description,
      ownerType:
        authContext.authSource === "api_key" || ownerId.startsWith(AGENT_ID_PREFIX)
          ? "agent"
          : "user",
      createdVia: "authenticated_key_management",
    });
    issuedKey.item["account_id"] = accountId;
    if (agentId) {
      issuedKey.item["agent_id"] = agentId;
    }

    await docClient.send(
      new PutCommand({
        TableName: API_KEYS_TABLE,
        Item: issuedKey.item,
        ConditionExpression: "attribute_not_exists(key_id)",
      }),
    );

    // Return the raw key ONCE — never stored, shown only here
    return success(201, {
      key_id: issuedKey.keyId,
      api_key: issuedKey.rawKey,
      name: data.name,
      created_at: issuedKey.createdAt,
      owner_id: ownerId,
    }, event);
  } catch (err) {
    console.error("createApiKey error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred", undefined, event);
  }
};
