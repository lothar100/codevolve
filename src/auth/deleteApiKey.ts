/**
 * DELETE /auth/keys/{key_id} â€” Soft-delete (revoke) an API key.
 *
 * Auth: Cognito ID token or API key (owner only).
 * Sets revoked = true and revoked_at = ISO8601 timestamp.
 * Returns 204 on success, 403 if caller is not the key owner, 404 if not found.
 *
 * Environment variables required:
 *   API_KEYS_TABLE â€” DynamoDB table name for codevolve-api-keys
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { deriveAuthContext, docClient, API_KEYS_TABLE } from "./shared.js";
import { error, noContent } from "../shared/response.js";

interface ApiKeyRecord {
  key_id: string;
  owner_id: string;
  revoked: boolean;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const keyId = event.pathParameters?.["key_id"];
    if (!keyId) {
      return error(400, "VALIDATION_ERROR", "key_id path parameter is required", undefined, event);
    }

    const authContext = deriveAuthContext(event);
    if (!authContext) {
      return error(401, "UNAUTHORIZED", "Missing or invalid authorization", undefined, event);
    }

    const getResult = await docClient.send(
      new GetCommand({
        TableName: API_KEYS_TABLE,
        Key: { key_id: keyId },
      }),
    );

    if (!getResult.Item) {
      return error(404, "NOT_FOUND", `API key ${keyId} not found`, undefined, event);
    }

    const record = getResult.Item as ApiKeyRecord;
    if (record.owner_id !== authContext.accountId) {
      return error(403, "FORBIDDEN", "You do not own this API key", undefined, event);
    }

    if (record.revoked) {
      return noContent(204, event);
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

    return noContent(204, event);
  } catch (err) {
    console.error("deleteApiKey error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred", undefined, event);
  }
};
