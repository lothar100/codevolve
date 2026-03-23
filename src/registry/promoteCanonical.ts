/**
 * POST /skills/:id/promote-canonical — Promote a skill to canonical status.
 *
 * Validates preconditions (confidence >= 0.85, has tests, status verified/optimized,
 * not archived, not already canonical), then sets is_canonical = true and demotes
 * the previous canonical skill for the same problem_id + language if one exists.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, PROBLEMS_TABLE, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import type { Skill } from "../shared/types.js";
import { invalidateCloudFrontPaths } from "../shared/cloudfrontInvalidation.js";

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

    // Get the latest version of the skill
    const skillResult = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        KeyConditionExpression: "skill_id = :sid",
        ExpressionAttributeValues: { ":sid": skillId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );

    const skillItem = skillResult.Items?.[0] as
      | Record<string, unknown>
      | undefined;

    if (!skillItem) {
      return error(404, "NOT_FOUND", `Skill ${skillId} not found`);
    }

    // Check: not already canonical
    if (skillItem.is_canonical === true) {
      return error(409, "CONFLICT", "Skill is already canonical");
    }

    // Check: not archived
    if (skillItem.status === "archived") {
      return error(
        422,
        "PRECONDITION_FAILED",
        "Cannot promote an archived skill",
      );
    }

    // Check: status must be verified or optimized
    if (skillItem.status !== "verified" && skillItem.status !== "optimized") {
      return error(
        422,
        "PRECONDITION_FAILED",
        `Skill status must be "verified" or "optimized", got "${skillItem.status}"`,
      );
    }

    // Check: confidence >= 0.85
    const confidence = (skillItem.confidence as number) ?? 0;
    if (confidence < 0.85) {
      return error(
        422,
        "PRECONDITION_FAILED",
        `Skill confidence must be >= 0.85, got ${confidence}`,
      );
    }

    // Check: has tests
    const tests = skillItem.tests as unknown[];
    if (!tests || tests.length === 0) {
      return error(
        422,
        "PRECONDITION_FAILED",
        "Skill must have at least one test",
      );
    }

    const problemId = skillItem.problem_id as string;
    const language = skillItem.language as string;
    const versionNumber = skillItem.version_number as number;
    const now = new Date().toISOString();

    // Find the current canonical skill for same problem_id + language
    let demotedSkillId: string | null = null;

    const canonicalQuery = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        IndexName: "GSI-problem-status",
        KeyConditionExpression: "problem_id = :pid",
        FilterExpression:
          "is_canonical = :true AND #lang = :language",
        ExpressionAttributeNames: { "#lang": "language" },
        ExpressionAttributeValues: {
          ":pid": problemId,
          ":true": true,
          ":language": language,
        },
      }),
    );

    // Demote the previous canonical skill (if any)
    if (canonicalQuery.Items && canonicalQuery.Items.length > 0) {
      for (const prevCanonical of canonicalQuery.Items) {
        const prevSkillId = prevCanonical.skill_id as string;
        const prevVersion = prevCanonical.version_number as number;
        demotedSkillId = prevSkillId;

        await docClient.send(
          new UpdateCommand({
            TableName: SKILLS_TABLE,
            Key: {
              skill_id: prevSkillId,
              version_number: prevVersion,
            },
            UpdateExpression:
              "SET is_canonical = :false, updated_at = :now REMOVE is_canonical_status",
            ExpressionAttributeValues: {
              ":false": false,
              ":now": now,
            },
          }),
        );
      }
    }

    // Promote this skill
    const isCanonicalStatus = `true#${skillItem.status}`;

    await docClient.send(
      new UpdateCommand({
        TableName: SKILLS_TABLE,
        Key: {
          skill_id: skillId,
          version_number: versionNumber,
        },
        UpdateExpression:
          "SET is_canonical = :true, is_canonical_status = :ics, updated_at = :now",
        ExpressionAttributeValues: {
          ":true": true,
          ":ics": isCanonicalStatus,
          ":now": now,
        },
      }),
    );

    // Update canonical_skill_id on Problems table
    await docClient.send(
      new UpdateCommand({
        TableName: PROBLEMS_TABLE,
        Key: { problem_id: problemId },
        UpdateExpression:
          "SET canonical_skill_id = :sid, updated_at = :now",
        ExpressionAttributeValues: {
          ":sid": skillId,
          ":now": now,
        },
      }),
    );

    // Invalidate CloudFront edge cache for both /skills* and /problems* because
    // canonical promotion changes the skill record and the problem's canonical_skill_id.
    // Fire-and-forget: never throws, failure logged internally.
    void invalidateCloudFrontPaths([
      `/skills/${skillId}`,
      `/skills*`,
      `/problems/${problemId}`,
      `/problems*`,
    ]);

    // Build response
    const promotedSkill: Skill = {
      ...mapSkillFromDynamo(skillItem),
      is_canonical: true,
      updated_at: now,
    };

    return success(200, {
      skill: promotedSkill,
      demoted_skill_id: demotedSkillId,
    });
  } catch (err) {
    console.error("promoteCanonical error:", err);
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
