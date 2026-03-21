/**
 * GET /skills — List and filter skills.
 *
 * Supports filtering by language, domain, tag, status, problem_id,
 * is_canonical, free-text search, and cursor-based pagination.
 * Excludes archived skills by default.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { success, error } from "../shared/response.js";
import type { Skill } from "../shared/types.js";

const ListSkillsParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  next_token: z.string().optional(),
  language: z.string().optional(),
  domain: z.union([z.string(), z.array(z.string())]).optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  problem_id: z.string().uuid().optional(),
  is_canonical: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  include_archived: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),
  sort_by: z.string().optional(),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().optional(),
});

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    // Merge single + multi-value query params
    const rawParams: Record<string, unknown> = {
      ...(event.queryStringParameters ?? {}),
    };
    // API Gateway multiValueQueryStringParameters for repeatable params
    const multi = event.multiValueQueryStringParameters ?? {};
    if (multi.domain && multi.domain.length > 1) rawParams.domain = multi.domain;
    if (multi.tag && multi.tag.length > 1) rawParams.tag = multi.tag;
    if (multi.status && multi.status.length > 1) rawParams.status = multi.status;

    const parseResult = ListSkillsParamsSchema.safeParse(rawParams);
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

    // Phase 1: only "confidence" is supported for sort_by.
    // created_at, updated_at, name are not backed by GSIs.
    const UNSUPPORTED_SORT_KEYS = ["created_at", "updated_at", "name"];
    if (params.sort_by !== undefined) {
      if (UNSUPPORTED_SORT_KEYS.includes(params.sort_by)) {
        return error(
          400,
          "UNSUPPORTED_SORT_KEY",
          `sort_by "${params.sort_by}" is not supported in Phase 1. Only "confidence" is supported.`,
        );
      }
      if (params.sort_by !== "confidence") {
        return error(400, "VALIDATION_ERROR", `Invalid sort_by value: "${params.sort_by}"`);
      }
      // sort_by=confidence requires a language filter (maps to GSI-language-confidence)
      if (!params.language) {
        return error(
          400,
          "VALIDATION_ERROR",
          `sort_by "confidence" requires a language filter`,
        );
      }
    }

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

    // Build filter expressions
    const filterParts: string[] = [];
    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, unknown> = {};

    // Exclude archived by default
    if (!params.include_archived) {
      filterParts.push("#sk_status <> :archived_status");
      exprNames["#sk_status"] = "status";
      exprValues[":archived_status"] = "archived";
    }

    // Domain filter
    const domains = params.domain
      ? Array.isArray(params.domain) ? params.domain : [params.domain]
      : [];
    for (let i = 0; i < domains.length; i++) {
      filterParts.push(`contains(#domain, :domain${i})`);
      exprNames["#domain"] = "domain";
      exprValues[`:domain${i}`] = domains[i];
    }

    // Tag filter
    const tags = params.tag
      ? Array.isArray(params.tag) ? params.tag : [params.tag]
      : [];
    for (let i = 0; i < tags.length; i++) {
      filterParts.push(`contains(tags, :tag${i})`);
      exprValues[`:tag${i}`] = tags[i];
    }

    // Status filter (when using GSI-language-confidence, status is a filter)
    const statuses = params.status
      ? Array.isArray(params.status) ? params.status : [params.status]
      : [];
    if (statuses.length > 0) {
      const statusConditions = statuses.map((_, i) => `#sk_status = :status${i}`);
      filterParts.push(`(${statusConditions.join(" OR ")})`);
      exprNames["#sk_status"] = "status";
      statuses.forEach((s, i) => {
        exprValues[`:status${i}`] = s;
      });
    }

    // is_canonical filter
    if (params.is_canonical !== undefined) {
      filterParts.push("is_canonical = :is_canonical");
      exprValues[":is_canonical"] = params.is_canonical;
    }

    // Free-text search filter
    if (params.q) {
      const qLower = params.q.toLowerCase();
      filterParts.push(
        "(contains(#sk_name_lower, :q) OR contains(#sk_desc_lower, :q))",
      );
      // DynamoDB contains is case-sensitive, so we filter client-side for q
      // Actually, we'll use contains on the original fields and do case-insensitive
      // post-filtering. For now, use contains on name and description directly.
      filterParts.pop(); // remove the above
      filterParts.push(
        "(contains(#sk_name, :q) OR contains(description, :q))",
      );
      exprNames["#sk_name"] = "name";
      exprValues[":q"] = params.q;
    }

    const filterExpression =
      filterParts.length > 0 ? filterParts.join(" AND ") : undefined;

    let items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    // Choose query strategy
    if (params.problem_id) {
      // Use GSI-problem-status
      const result = await docClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          IndexName: "GSI-problem-status",
          KeyConditionExpression: "problem_id = :pid",
          ExpressionAttributeValues: {
            ":pid": params.problem_id,
            ...exprValues,
          },
          ...(filterExpression ? { FilterExpression: filterExpression } : {}),
          ...(Object.keys(exprNames).length > 0
            ? { ExpressionAttributeNames: exprNames }
            : {}),
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
    } else if (params.language) {
      // Use GSI-language-confidence
      const result = await docClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          IndexName: "GSI-language-confidence",
          KeyConditionExpression: "#lang = :language",
          ExpressionAttributeValues: {
            ":language": params.language,
            ...exprValues,
          },
          ExpressionAttributeNames: {
            "#lang": "language",
            ...exprNames,
          },
          ...(filterExpression ? { FilterExpression: filterExpression } : {}),
          ScanIndexForward: false, // confidence desc by default
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
      // No partition key filter available — must Scan
      const result = await docClient.send(
        new ScanCommand({
          TableName: SKILLS_TABLE,
          ...(filterExpression
            ? {
                FilterExpression: filterExpression,
                ExpressionAttributeValues: exprValues,
                ...(Object.keys(exprNames).length > 0
                  ? { ExpressionAttributeNames: exprNames }
                  : {}),
              }
            : {}),
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

    // Deduplicate: keep only latest version per skill_id
    const latestBySkillId = new Map<string, Record<string, unknown>>();
    for (const item of items) {
      const sid = item.skill_id as string;
      const existing = latestBySkillId.get(sid);
      if (
        !existing ||
        (item.version_number as number) > (existing.version_number as number)
      ) {
        latestBySkillId.set(sid, item);
      }
    }
    let dedupedItems = Array.from(latestBySkillId.values());

    // Client-side sort (only confidence is supported in Phase 1)
    if (params.sort_by === "confidence") {
      const sortOrder = params.sort_order;
      dedupedItems.sort((a, b) => {
        const aVal = (a.confidence as number) ?? 0;
        const bVal = (b.confidence as number) ?? 0;
        if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
        if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }

    // Map to API response shape
    const skills = dedupedItems.map(mapSkillFromDynamo);

    // Encode next_token
    const nextToken = lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64")
      : null;

    return success(200, {
      skills,
      pagination: {
        limit: params.limit,
        next_token: nextToken,
      },
    });
  } catch (err) {
    console.error("listSkills error:", err);
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
