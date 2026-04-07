/**
 * DELETE /auth/keys/{key_id} — Soft-delete (revoke) an API key.
 *
 * Auth: Cognito ID token or API key (owner only).
 * Sets revoked = true and revoked_at = ISO8601 timestamp.
 * Returns 204 on success, 403 if caller is not the key owner, 404 if not found.
 *
 * Environment variables required:
 *   API_KEYS_TABLE — DynamoDB table name for codevolve-api-keys
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, API_KEYS_TABLE } from "./shared.js";
import { error } from "../shared/response.js";
import type { APIGatewayProxyResult as Result } from "aws-lambda";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiKeyRecord {
  key_id: string;
  owner_id: string;
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// 204 helper (no body)
// ---------------------------------------------------------------------------

function noContent(): Result {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,Accept,X-Request-Id,X-Agent-Id,Authorization,X-Api-Key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: "",
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const keyId = event.pathParameters?.["key_id"];
    if (!keyId) {
      return error(400, "VALIDATION_ERROR", "key_id path parameter is required");
    }

    // Derive owner_id from authorizer context
    const ownerIdFromApiKey =
      event.requestContext?.authorizer?.["owner_id"] as string | undefined;
    const ownerIdFromCognito =
      event.requestContext?.authorizer?.claims?.["sub"] as string | undefined;
    const callerId = ownerIdFromApiKey ?? ownerIdFromCognito;

    if (!callerId) {
      return error(401, "UNAUTHORIZED", "Missing or invalid authorization");
    }

    // Fetch the key record
    const getResult = await docClient.send(
      new GetCommand({
        TableName: API_KEYS_TABLE,
        Key: { key_id: keyId },
      }),
    );

    if (!getResult.Item) {
      return error(404, "NOT_FOUND", `API key ${keyId} not found`);
    }

    const record = getResult.Item as ApiKeyRecord;

    // Ownership check
    if (record.owner_id !== callerId) {
      return error(403, "FORBIDDEN", "You do not own this API key");
    }

    if (record.revoked) {
      // Idempotent — already revoked is still a 204
      return noContent();
    }

    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: API_KEYS_TABLE,
        Key: { key_id: keyId },
        UpdateExpression: "SET revoked = :true, revoked_at = :now",
        ConditionExpression: "attribute_exists(key_id)",
        ExpressionAttributeValues: {
          ":true": true,
          ":now": now,
        },
      }),
    );

    return noContent();
  } catch (err) {
    console.error("deleteApiKey error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
};
