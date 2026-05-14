/**
 * GET /auth/keys — List API keys for the authenticated owner.
 *
 * Auth: Cognito ID token or API key.
 * Queries gsi-owner GSI by owner_id.
 * Never returns api_key or api_key_hash.
 *
 * Environment variables required:
 *   API_KEYS_TABLE — DynamoDB table name for codevolve-api-keys
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { deriveAuthContext, docClient, API_KEYS_TABLE } from "./shared.js";
import { success, error } from "../shared/response.js";

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

interface ApiKeySummary {
  key_id: string;
  name: string;
  description?: string;
  created_at: string;
  last_used_at?: string;
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const authContext = deriveAuthContext(event);

    if (!authContext) {
      return error(401, "UNAUTHORIZED", "Missing or invalid authorization");
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: API_KEYS_TABLE,
        IndexName: "gsi-owner",
        KeyConditionExpression: "owner_id = :owner",
        ExpressionAttributeValues: { ":owner": authContext.accountId },
      }),
    );

    const keys: ApiKeySummary[] = (result.Items ?? []).map(
      (item: Record<string, unknown>) => {
        const record = item as unknown as ApiKeyRecord;
        const summary: ApiKeySummary = {
          key_id: record.key_id,
          name: record.name,
          created_at: record.created_at,
          revoked: record.revoked,
        };
        if (record.description !== undefined) {
          summary.description = record.description;
        }
        if (record.last_used_at !== undefined) {
          summary.last_used_at = record.last_used_at;
        }
        return summary;
      },
    );

    return success(200, { keys });
  } catch (err) {
    console.error("listApiKeys error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
};
