/**
 * GET /skills/:id/versions — List all versions of a skill.
 *
 * Returns SkillVersionSummary objects ordered by version_number descending
 * (latest first). Supports cursor-based pagination via limit + next_token.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate, PaginationParamsSchema } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import type { SkillStatus } from "../shared/types.js";

const PathParamsSchema = z.object({
  id: z.string().uuid(),
});

export interface SkillVersionSummary {
  skill_id: string;
  version: number;
  version_label?: string;
  status: SkillStatus;
  confidence: number;
  is_canonical: boolean;
  created_at: string;
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    // Validate path parameter
    const pathValidation = validate(PathParamsSchema, {
      id: event.pathParameters?.id,
    });
    if (!pathValidation.success) {
      return error(400, "VALIDATION_ERROR", "Invalid skill ID format");
    }

    const skillId = pathValidation.data.id;

    // Validate pagination query params
    const paginationValidation = validate(PaginationParamsSchema, {
      limit: event.queryStringParameters?.limit,
      next_token: event.queryStringParameters?.next_token,
    });
    if (!paginationValidation.success) {
      return error(
        400,
        "VALIDATION_ERROR",
        "Invalid pagination parameters",
        paginationValidation.error.details,
      );
    }

    const { limit, next_token } = paginationValidation.data;

    // Build ExclusiveStartKey from next_token if provided
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (next_token) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(next_token, "base64").toString("utf-8"),
        );
      } catch {
        return error(400, "VALIDATION_ERROR", "Invalid next_token");
      }
    }

    // Query DynamoDB: all versions for this skill_id, descending by version_number
    const result = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        KeyConditionExpression: "skill_id = :sid",
        ExpressionAttributeValues: { ":sid": skillId },
        ScanIndexForward: false,
        Limit: limit,
        ...(exclusiveStartKey
          ? { ExclusiveStartKey: exclusiveStartKey }
          : {}),
      }),
    );

    const items = result.Items ?? [];

    // 404 if no versions exist and this is the first page
    if (items.length === 0 && !next_token) {
      return error(404, "NOT_FOUND", `No skill found with id ${skillId}`);
    }

    // Map DynamoDB items to SkillVersionSummary
    const versions: SkillVersionSummary[] = items.map((item) => ({
      skill_id: item.skill_id as string,
      version: item.version_number as number,
      ...(item.version_label
        ? { version_label: item.version_label as string }
        : {}),
      status: item.status as SkillStatus,
      confidence: (item.confidence as number) ?? 0,
      is_canonical: (item.is_canonical as boolean) ?? false,
      created_at: item.created_at as string,
    }));

    // Build next_token from LastEvaluatedKey
    const nextToken = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64")
      : null;

    return success(200, {
      skill_id: skillId,
      versions,
      pagination: {
        limit,
        next_token: nextToken,
      },
    });
  } catch (err) {
    console.error("listSkillVersions error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}
