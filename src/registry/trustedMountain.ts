/**
 * Trusted Mountain — per-user saved skill set.
 *
 * A "trusted mountain" is a named collection of skill_ids that a
 * user has bookmarked. Stored in `codevolve-trusted-mountains`:
 *   PK: user_id (String)
 *   SK: skill_id (String)
 *   Attributes: saved_at (ISO-8601 string)
 *
 * Routes (all require Cognito auth):
 *   GET    /users/me/trusted-mountain          → list saved skills
 *   POST   /users/me/trusted-mountain          → add skill_id
 *   DELETE /users/me/trusted-mountain/{skill_id} → remove skill_id
 *
 * The user_id is always extracted from the JWT authorizer context
 * (requestContext.authorizer.userId), never from the request body.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient } from "../shared/dynamo.js";
import { error, success } from "../shared/response.js";

// ---------------------------------------------------------------------------
// Table name
// ---------------------------------------------------------------------------

export const TRUSTED_MOUNTAIN_TABLE =
  process.env.TRUSTED_MOUNTAIN_TABLE ?? "codevolve-trusted-mountains";

// ---------------------------------------------------------------------------
// Zod schema for POST body
// ---------------------------------------------------------------------------

const AddSkillBodySchema = z.object({
  skill_id: z.string().uuid("skill_id must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the authenticated user_id from the API Gateway authorizer context.
 * Returns null if not present (should never happen on protected routes, but
 * we guard defensively).
 */
function extractUserId(event: APIGatewayProxyEvent): string | null {
  const ctx = event.requestContext?.authorizer;
  if (ctx === null || ctx === undefined) {
    return null;
  }
  const userId = ctx["userId"];
  if (typeof userId !== "string" || userId.length === 0) {
    return null;
  }
  return userId;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /users/me/trusted-mountain
 * Returns all skill_ids saved by the authenticated user.
 */
async function listTrustedMountain(
  userId: string,
): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TRUSTED_MOUNTAIN_TABLE,
      KeyConditionExpression: "user_id = :uid",
      ExpressionAttributeValues: { ":uid": userId },
    }),
  );

  const items = (result.Items ?? []).map((item) => ({
    skill_id: item["skill_id"] as string,
    saved_at: item["saved_at"] as string,
  }));

  return success(200, { items });
}

/**
 * POST /users/me/trusted-mountain
 * Body: { skill_id: string }
 * Adds a skill_id to the user's trusted mountain.
 * Idempotent: re-adding the same skill_id updates saved_at.
 */
async function addToTrustedMountain(
  userId: string,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const parsed = AddSkillBodySchema.safeParse(body);
  if (!parsed.success) {
    return error(
      400,
      "VALIDATION_ERROR",
      "Invalid request body",
      { issues: parsed.error.issues } as Record<string, unknown>,
    );
  }

  const { skill_id } = parsed.data;
  const saved_at = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TRUSTED_MOUNTAIN_TABLE,
      Item: { user_id: userId, skill_id, saved_at },
    }),
  );

  return success(200, { user_id: userId, skill_id, saved_at });
}

/**
 * DELETE /users/me/trusted-mountain/{skill_id}
 * Removes a skill_id from the user's trusted mountain.
 * Returns 404 if the entry does not exist.
 */
async function removeFromTrustedMountain(
  userId: string,
  skillId: string,
): Promise<APIGatewayProxyResult> {
  // Verify the item exists before deleting
  const existing = await docClient.send(
    new GetCommand({
      TableName: TRUSTED_MOUNTAIN_TABLE,
      Key: { user_id: userId, skill_id: skillId },
    }),
  );

  if (existing.Item === undefined) {
    return error(404, "NOT_FOUND", `skill_id ${skillId} is not in your trusted mountain`);
  }

  await docClient.send(
    new DeleteCommand({
      TableName: TRUSTED_MOUNTAIN_TABLE,
      Key: { user_id: userId, skill_id: skillId },
    }),
  );

  return success(200, { deleted: true, skill_id: skillId });
}

// ---------------------------------------------------------------------------
// Main Lambda handler — routes by HTTP method and path parameters
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  // All routes require authentication
  const userId = extractUserId(event);
  if (userId === null) {
    return error(401, "UNAUTHORIZED", "Authentication required");
  }

  const method = event.httpMethod.toUpperCase();

  try {
    if (method === "GET") {
      return await listTrustedMountain(userId);
    }

    if (method === "POST") {
      return await addToTrustedMountain(userId, event);
    }

    if (method === "DELETE") {
      const skillId = event.pathParameters?.["skill_id"];
      if (skillId === undefined || skillId === null || skillId.length === 0) {
        return error(400, "VALIDATION_ERROR", "skill_id path parameter is required");
      }
      return await removeFromTrustedMountain(userId, skillId);
    }

    return error(405, "METHOD_NOT_ALLOWED", `Method ${method} not allowed`);
  } catch (err) {
    console.error("[trustedMountain] Unhandled error:", err);
    return error(500, "INTERNAL_ERROR", "An internal error occurred");
  }
};
