/**
 * GET /problems — List problems, optionally filtered by domain, difficulty, or status.
 *
 * When `domain` is provided, queries GSI-status-domain (efficient).
 * When `domain` is omitted, falls back to a table scan with filter.
 * Default status filter is "active" (excludes archived).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, PROBLEMS_TABLE } from "../shared/dynamo.js";
import { success, error } from "../shared/response.js";
import type { Problem } from "../shared/types.js";

const ListProblemsParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  next_token: z.string().optional(),
  domain: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  status: z.string().default("active"),
});

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const rawParams: Record<string, unknown> = {
      ...(event.queryStringParameters ?? {}),
    };

    const parseResult = ListProblemsParamsSchema.safeParse(rawParams);
    if (!parseResult.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join(".") || "_root";
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return error(400, "VALIDATION_ERROR", "Request validation failed", fieldErrors);
    }

    const params = parseResult.data;

    // Decode next_token (base64 encoded ExclusiveStartKey)
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (params.next_token) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(params.next_token, "base64").toString("utf-8"),
        );
      } catch {
        return error(400, "VALIDATION_ERROR", "Invalid next_token");
      }
    }

    let items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    if (params.domain) {
      // Query GSI-status-domain: PK = status, SK = domain_primary
      // Build filter for difficulty if provided
      const filterParts: string[] = [];
      const exprNames: Record<string, string> = {};
      const exprValues: Record<string, unknown> = {};

      if (params.difficulty) {
        filterParts.push("difficulty = :difficulty");
        exprValues[":difficulty"] = params.difficulty;
      }

      const filterExpression =
        filterParts.length > 0 ? filterParts.join(" AND ") : undefined;

      const result = await docClient.send(
        new QueryCommand({
          TableName: PROBLEMS_TABLE,
          IndexName: "GSI-status-domain",
          KeyConditionExpression: "#status = :status AND domain_primary = :domain",
          ExpressionAttributeNames: {
            "#status": "status",
            ...exprNames,
          },
          ExpressionAttributeValues: {
            ":status": params.status,
            ":domain": params.domain,
            ...exprValues,
          },
          ...(filterExpression ? { FilterExpression: filterExpression } : {}),
          Limit: params.limit,
          ...(exclusiveStartKey
            ? { ExclusiveStartKey: exclusiveStartKey }
            : {}),
        }),
      );
      items = (result.Items ?? []) as Record<string, unknown>[];
      lastEvaluatedKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } else {
      // No domain filter — Scan with filter on status (and difficulty if provided)
      const filterParts: string[] = [];
      const exprNames: Record<string, string> = {};
      const exprValues: Record<string, unknown> = {};

      filterParts.push("#status = :status");
      exprNames["#status"] = "status";
      exprValues[":status"] = params.status;

      if (params.difficulty) {
        filterParts.push("difficulty = :difficulty");
        exprValues[":difficulty"] = params.difficulty;
      }

      const filterExpression = filterParts.join(" AND ");

      const result = await docClient.send(
        new ScanCommand({
          TableName: PROBLEMS_TABLE,
          FilterExpression: filterExpression,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          Limit: params.limit,
          ...(exclusiveStartKey
            ? { ExclusiveStartKey: exclusiveStartKey }
            : {}),
        }),
      );
      items = (result.Items ?? []) as Record<string, unknown>[];
      lastEvaluatedKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    }

    // Map to API response shape (exclude internal DynamoDB fields)
    const problems = items.map(mapProblemFromDynamo);

    // Encode next_token
    const nextToken = lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64")
      : null;

    return success(200, {
      problems,
      pagination: {
        limit: params.limit,
        next_token: nextToken,
      },
    });
  } catch (err) {
    console.error("listProblems error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}

function mapProblemFromDynamo(item: Record<string, unknown>): Problem {
  return {
    problem_id: item.problem_id as string,
    name: item.name as string,
    description: item.description as string,
    difficulty: item.difficulty as Problem["difficulty"],
    domain: item.domain as string[],
    tags: (item.tags as string[]) ?? [],
    ...(item.constraints !== undefined
      ? { constraints: item.constraints as string }
      : {}),
    examples: (item.examples as Problem["examples"]) ?? [],
    canonical_skill_id: (item.canonical_skill_id as string) ?? null,
    skill_count: (item.skill_count as number) ?? 0,
    created_at: item.created_at as string,
    updated_at: item.updated_at as string,
  };
}
