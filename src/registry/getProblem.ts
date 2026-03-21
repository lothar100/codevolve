/**
 * GET /problems/:id — Get a problem and all its associated skills.
 *
 * Fetches the problem from the Problems table, then queries all skills
 * for this problem via GSI-problem-status, sorted by confidence desc.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, PROBLEMS_TABLE, SKILLS_TABLE } from "../shared/dynamo.js";
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
      return error(400, "VALIDATION_ERROR", "Invalid problem ID format");
    }

    const problemId = pathValidation.data.id;
    const includeArchived =
      event.queryStringParameters?.include_archived_skills === "true";

    // Fetch the problem
    const problemResult = await docClient.send(
      new GetCommand({
        TableName: PROBLEMS_TABLE,
        Key: { problem_id: problemId },
      }),
    );

    if (!problemResult.Item) {
      return error(404, "NOT_FOUND", `Problem ${problemId} not found`);
    }

    // Query all skills for this problem via GSI-problem-status
    const skillsResult = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        IndexName: "GSI-problem-status",
        KeyConditionExpression: "problem_id = :pid",
        ExpressionAttributeValues: { ":pid": problemId },
      }),
    );

    let skills = (skillsResult.Items ?? []) as Record<string, unknown>[];

    // Filter out archived skills unless requested
    if (!includeArchived) {
      skills = skills.filter((s) => s.status !== "archived");
    }

    // For skills with multiple versions, keep only the latest version per skill_id
    const latestBySkillId = new Map<string, Record<string, unknown>>();
    for (const skill of skills) {
      const sid = skill.skill_id as string;
      const existing = latestBySkillId.get(sid);
      if (
        !existing ||
        (skill.version_number as number) > (existing.version_number as number)
      ) {
        latestBySkillId.set(sid, skill);
      }
    }
    skills = Array.from(latestBySkillId.values());

    // Sort by confidence descending
    skills.sort(
      (a, b) => ((b.confidence as number) ?? 0) - ((a.confidence as number) ?? 0),
    );

    // Map DynamoDB items to API response shape
    const mappedSkills = skills.map(mapSkillFromDynamo);

    // Map problem to API shape
    const problem = problemResult.Item;
    const { domain_primary, status, ...problemFields } = problem;

    return success(200, {
      problem: problemFields,
      skills: mappedSkills,
      skill_count: problem.skill_count ?? 0,
    });
  } catch (err) {
    console.error("getProblem error:", err);
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
    ...(item.version_label ? { version_label: item.version_label as string } : {}),
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
