/**
 * POST /auth/accounts/{account_id}/status - Ops-only account suspension control.
 *
 * Auth: Cognito ID token.
 * Updates an account's runtime status so all API keys under that account can be
 * suspended or re-activated by the custom authorizer.
 *
 * Request body: { status: "active" | "suspended", reason?: string }
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { ACCOUNTS_TABLE, docClient } from "./shared.js";
import { error, success } from "../shared/response.js";
import { validate } from "../shared/validation.js";

const SetAccountStatusRequestSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().max(512).optional(),
});

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const accountId = event.pathParameters?.["account_id"];
    if (!accountId) {
      return error(400, "VALIDATION_ERROR", "account_id path parameter is required", undefined, event);
    }

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return error(400, "VALIDATION_ERROR", "Invalid JSON in request body", undefined, event);
    }

    const validation = validate(SetAccountStatusRequestSchema, body);
    if (!validation.success) {
      return error(
        400,
        validation.error.code,
        validation.error.message,
        validation.error.details,
        event,
      );
    }

    const existing = await docClient.send(
      new GetCommand({
        TableName: ACCOUNTS_TABLE,
        Key: { account_id: accountId },
      }),
    );

    if (!existing.Item) {
      return error(404, "NOT_FOUND", `Account ${accountId} not found`, undefined, event);
    }

    const data = validation.data;
    const now = new Date().toISOString();
    const updateExpression =
      data.status === "suspended"
        ? "SET #status = :status, suspended_at = :now, status_reason = :reason"
        : "SET #status = :status, reactivated_at = :now, status_reason = :reason REMOVE suspended_at";

    await docClient.send(
      new UpdateCommand({
        TableName: ACCOUNTS_TABLE,
        Key: { account_id: accountId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": data.status,
          ":now": now,
          ":reason": data.reason ?? null,
        },
        ConditionExpression: "attribute_exists(account_id)",
      }),
    );

    return success(200, {
      account_id: accountId,
      status: data.status,
      updated_at: now,
      reason: data.reason ?? null,
    }, event);
  } catch (err) {
    console.error("setAccountStatus error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred", undefined, event);
  }
};
