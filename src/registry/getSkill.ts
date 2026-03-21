/**
 * GET /skills/:id — Retrieve a single skill by ID.
 *
 * Optional ?version= query param for specific version.
 * Without version, returns the latest version (descending sort, Limit 1).
 * Archived skills ARE returned.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import type { Skill } from "../shared/types.js";

const PathParamsSchema = z.object({
  id: z.string().uuid(),
});

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
    const versionParam = event.queryStringParameters?.version;

    let item: Record<string, unknown> | undefined;

    if (versionParam) {
      // Specific version requested
      const versionNumber = parseInt(versionParam, 10);
      if (isNaN(versionNumber) || versionNumber < 1) {
        return error(
          400,
          "VALIDATION_ERROR",
          "version must be a positive integer",
        );
      }

      const result = await docClient.send(
        new GetCommand({
          TableName: SKILLS_TABLE,
          Key: {
            skill_id: skillId,
            version_number: versionNumber,
          },
        }),
      );
      item = result.Item as Record<string, unknown> | undefined;
    } else {
      // Latest version: query with descending sort, limit 1
      const result = await docClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          KeyConditionExpression: "skill_id = :sid",
          ExpressionAttributeValues: { ":sid": skillId },
          ScanIndexForward: false,
          Limit: 1,
        }),
      );
      item = result.Items?.[0] as Record<string, unknown> | undefined;
    }

    if (!item) {
      return error(404, "NOT_FOUND", `Skill ${skillId} not found`);
    }

    return success(200, { skill: mapSkillFromDynamo(item) });
  } catch (err) {
    console.error("getSkill error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}

function mapSkillFromDynamo(item: Record<string, unknown>): Skill {
  return {
    skill_id: item.skill_id as string,
    problem_id: item.problem_id as string,
    name: item.name as string,
    description: item.description as string,
    version: item.version_number as number,
    ...(item.version_label
      ? { version_label: item.version_label as string }
      : {}),
    is_canonical: (item.is_canonical as boolean) ?? false,
    status: item.status as Skill["status"],
    language: item.language as Skill["language"],
    domain: item.domain as string[],
    tags: (item.tags as string[]) ?? [],
    inputs: item.inputs as Skill["inputs"],
    outputs: item.outputs as Skill["outputs"],
    examples: (item.examples as Skill["examples"]) ?? [],
    tests: (item.tests as Skill["tests"]) ?? [],
    implementation: (item.implementation as string) ?? "",
    confidence: (item.confidence as number) ?? 0,
    latency_p50_ms: (item.latency_p50_ms as number) ?? null,
    latency_p95_ms: (item.latency_p95_ms as number) ?? null,
    created_at: item.created_at as string,
    updated_at: item.updated_at as string,
  };
}
