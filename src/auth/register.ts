/**
 * POST /auth/register — Public self-serve registration for standalone agents.
 *
 * Auth: none.
 * Creates a new standalone agent principal and its first API key.
 * The raw key is returned exactly once in the response and is never stored.
 *
 * Response 201 with { agent_id, key_id, api_key, name, created_at }.
 *
 * Environment variables required:
 *   API_KEYS_TABLE — DynamoDB table name for codevolve-api-keys
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
  API_KEYS_TABLE,
  buildApiKeyRecord,
  docClient,
  generateStandaloneAgentId,
} from "./shared.js";
import { validate } from "../shared/validation.js";
import { error, success } from "../shared/response.js";

const RegisterRequestSchema = z.object({
  name: z.string().min(1).max(128).default("Initial agent key"),
  description: z.string().max(512).optional(),
});

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    let body: unknown = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
      }
    }

    const validation = validate(RegisterRequestSchema, body);
    if (!validation.success) {
      return error(
        400,
        validation.error.code,
        validation.error.message,
        validation.error.details,
      );
    }

    const data = validation.data;
    const keyName = data.name ?? "Initial agent key";
    const agentId = generateStandaloneAgentId();
    const issuedKey = buildApiKeyRecord({
      ownerId: agentId,
      name: keyName,
      description: data.description,
      ownerType: "agent",
      createdVia: "self_serve_registration",
    });

    await docClient.send(
      new PutCommand({
        TableName: API_KEYS_TABLE,
        Item: issuedKey.item,
        ConditionExpression: "attribute_not_exists(key_id)",
      }),
    );

    return success(201, {
      agent_id: agentId,
      key_id: issuedKey.keyId,
      api_key: issuedKey.rawKey,
      name: keyName,
      created_at: issuedKey.createdAt,
    });
  } catch (err) {
    console.error("registerAgent error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
};
