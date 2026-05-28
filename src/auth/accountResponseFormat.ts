import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { ACCOUNTS_TABLE, deriveAuthContext, docClient } from "./shared.js";
import { error, success } from "../shared/response.js";
import {
  DEFAULT_RESPONSE_FORMAT,
  normalizeResponseFormat,
} from "../shared/responseFormat.js";
import { validate } from "../shared/validation.js";

interface AccountRecord {
  account_id: string;
  response_format?: string;
  response_format_updated_at?: string;
  updated_at?: string;
  created_at?: string;
}

const SetResponseFormatRequestSchema = z.object({
  response_format: z.enum(["json", "toon"]),
});

function buildResponse(record: AccountRecord, fallbackAccountId: string) {
  return {
    account_id: record.account_id ?? fallbackAccountId,
    response_format:
      normalizeResponseFormat(record.response_format) ?? DEFAULT_RESPONSE_FORMAT,
    updated_at:
      record.response_format_updated_at ??
      record.updated_at ??
      record.created_at ??
      new Date().toISOString(),
  };
}

async function handleGet(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const authContext = deriveAuthContext(event);
  if (!authContext) {
    return error(401, "UNAUTHORIZED", "Missing or invalid authorization", undefined, event);
  }

  const account = await docClient.send(
    new GetCommand({
      TableName: ACCOUNTS_TABLE,
      Key: { account_id: authContext.accountId },
    }),
  );

  if (!account.Item) {
    return error(404, "NOT_FOUND", `Account ${authContext.accountId} not found`, undefined, event);
  }

  return success(
    200,
    buildResponse(account.Item as AccountRecord, authContext.accountId),
    event,
  );
}

async function handlePut(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const authContext = deriveAuthContext(event);
  if (!authContext) {
    return error(401, "UNAUTHORIZED", "Missing or invalid authorization", undefined, event);
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body", undefined, event);
  }

  const validation = validate(SetResponseFormatRequestSchema, body);
  if (!validation.success) {
    return error(
      400,
      validation.error.code,
      validation.error.message,
      validation.error.details,
      event,
    );
  }

  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: ACCOUNTS_TABLE,
        Key: { account_id: authContext.accountId },
        UpdateExpression:
          "SET response_format = :responseFormat, response_format_updated_at = :updatedAt, updated_at = :updatedAt",
        ExpressionAttributeValues: {
          ":responseFormat": validation.data.response_format,
          ":updatedAt": now,
        },
        ConditionExpression: "attribute_exists(account_id)",
      }),
    );
  } catch (err) {
    const message = String(err);
    if (message.includes("ConditionalCheckFailed")) {
      return error(404, "NOT_FOUND", `Account ${authContext.accountId} not found`, undefined, event);
    }
    throw err;
  }

  return success(
    200,
    {
      account_id: authContext.accountId,
      response_format: validation.data.response_format,
      updated_at: now,
    },
    event,
  );
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    if (event.httpMethod === "GET") {
      return await handleGet(event);
    }

    if (event.httpMethod === "PUT") {
      return await handlePut(event);
    }

    return error(
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${event.httpMethod} not allowed`,
      undefined,
      event,
    );
  } catch (err) {
    console.error("accountResponseFormat error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred", undefined, event);
  }
};
