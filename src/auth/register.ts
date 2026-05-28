/**
 * POST /auth/register — Public self-serve registration for standalone agents.
 *
 * Auth: none.
 * Creates a new standalone agent account, its first agent principal, and its
 * first API key.
 * The raw key is returned exactly once in the response and is never stored.
 *
 * Response 201 with
 * { account_id, agent_id, agent_name, key_id, api_key, key_name, name, created_at }.
 *
 * Environment variables required:
 *   API_KEYS_TABLE — DynamoDB table name for codevolve-api-keys
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
  ACCOUNTS_TABLE,
  API_KEYS_TABLE,
  buildStandaloneAccountRecord,
  buildApiKeyRecord,
  docClient,
  generateStandaloneAgentId,
  generateStandaloneAgentName,
} from "./shared.js";
import { validate } from "../shared/validation.js";
import { error, success } from "../shared/response.js";

const RegisterRequestSchema = z.object({
  agent_name: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(128).optional(),
  key_name: z.string().trim().min(1).max(128).optional(),
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
        return error(400, "VALIDATION_ERROR", "Invalid JSON in request body", undefined, event);
      }
    }

    const validation = validate(RegisterRequestSchema, body);
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
    const agentName =
      data.agent_name ?? data.name ?? generateStandaloneAgentName();
    const responseName = data.name ?? agentName;
    const keyName = data.key_name ?? "Initial agent key";
    const agentId = generateStandaloneAgentId();
    const accountId = agentId;
    const issuedKey = buildApiKeyRecord({
      ownerId: accountId,
      name: keyName,
      description: data.description,
      ownerType: "agent",
      createdVia: "self_serve_registration",
    });
    issuedKey.item["account_id"] = accountId;
    issuedKey.item["agent_id"] = agentId;

    const accountRecord = buildStandaloneAccountRecord({
      accountId,
      agentId,
      agentName,
      createdAt: issuedKey.createdAt,
    });

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: ACCOUNTS_TABLE,
              Item: accountRecord,
              ConditionExpression: "attribute_not_exists(account_id)",
            },
          },
          {
            Put: {
              TableName: API_KEYS_TABLE,
              Item: issuedKey.item,
              ConditionExpression: "attribute_not_exists(key_id)",
            },
          },
        ],
      }),
    );

    return success(201, {
      account_id: accountId,
      agent_id: agentId,
      agent_name: agentName,
      key_id: issuedKey.keyId,
      api_key: issuedKey.rawKey,
      key_name: keyName,
      name: responseName,
      created_at: issuedKey.createdAt,
    }, event);
  } catch (err) {
    console.error("registerAgent error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred", undefined, event);
  }
};
