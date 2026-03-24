/**
 * POST /skills/:id/promote-canonical — Promote a skill to canonical status.
 *
 * Full rewrite per IMPL-13-C spec (docs/validation-evolve.md §4):
 *
 * 1. GetItem — fetch skill; 404 if not found
 * 2. validatePromotionGate(skill) — return gate error if not valid
 * 3. Query GSI-canonical filtered by same language to find previous canonical
 * 4. TransactWriteItems: promote + demote (if exists) + update problems table
 * 5. Handle TransactionCanceledException → ConditionalCheckFailed → 422
 * 6. Invalidate CloudFront cache for affected paths (fire-and-forget)
 * 7. Re-fetch and return PromoteCanonicalResponse
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, PROBLEMS_TABLE, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { validatePromotionGate, type SkillGateInput } from "./promoteCanonicalGate.js";
import type { Skill } from "../shared/types.js";

const PathParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Response shape for a successful promotion.
 */
export interface PromoteCanonicalResponse {
  skill: Skill;
  demoted_skill_id: string | null;
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    // Step 1: Validate path parameter
    const pathValidation = validate(PathParamsSchema, {
      id: event.pathParameters?.id,
    });
    if (!pathValidation.success) {
      return error(400, "VALIDATION_ERROR", "Invalid skill ID format");
    }

    const skillId = pathValidation.data.id;

    // Step 2: GetItem — fetch the latest version of the skill
    // The skills table PK is skill_id, SK is version_number. We query to get latest.
    const skillResult = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        KeyConditionExpression: "skill_id = :sid",
        ExpressionAttributeValues: { ":sid": skillId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );

    const skillItem = skillResult.Items?.[0] as Record<string, unknown> | undefined;

    if (!skillItem) {
      return error(404, "NOT_FOUND", `Skill ${skillId} not found`);
    }

    // Step 3: Run promotion gate
    // Map DynamoDB item to SkillGateInput — includes fields not on the Skill domain type.
    const gateInput: SkillGateInput = {
      is_canonical: skillItem.is_canonical as boolean | undefined,
      confidence: skillItem.confidence as number | undefined,
      test_fail_count: skillItem.test_fail_count as number | undefined,
      test_pass_count: skillItem.test_pass_count as number | undefined,
      status: skillItem.status as string | undefined,
      // `archived` boolean field is distinct from status === "archived".
      // It is an explicit boolean attribute set by the archive mechanism.
      archived: skillItem.archived as boolean | undefined,
    };

    const gate = validatePromotionGate(gateInput);
    if (!gate.valid) {
      return error(gate.status, gate.code, gate.message);
    }

    const problemId = skillItem.problem_id as string;
    const language = skillItem.language as string;
    const versionNumber = skillItem.version_number as number;
    const now = new Date().toISOString();

    // Step 4: Query GSI-canonical for previous canonical skill with same language
    // The GSI-canonical partition key is `is_canonical_status` (composite string "true#verified"
    // or "true#optimized"), sort key is `problem_id`. We filter by language.
    // We must scan both possible is_canonical_status values.
    let demotedSkillId: string | null = null;
    let demotedVersionNumber: number | null = null;

    const canonicalQueryVerified = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        IndexName: "GSI-canonical",
        KeyConditionExpression:
          "is_canonical_status = :ics AND problem_id = :pid",
        FilterExpression: "#lang = :language",
        ExpressionAttributeNames: { "#lang": "language" },
        ExpressionAttributeValues: {
          ":ics": "true#verified",
          ":pid": problemId,
          ":language": language,
        },
      }),
    );

    const canonicalQueryOptimized = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        IndexName: "GSI-canonical",
        KeyConditionExpression:
          "is_canonical_status = :ics AND problem_id = :pid",
        FilterExpression: "#lang = :language",
        ExpressionAttributeNames: { "#lang": "language" },
        ExpressionAttributeValues: {
          ":ics": "true#optimized",
          ":pid": problemId,
          ":language": language,
        },
      }),
    );

    // Merge results, excluding the skill being promoted (already_canonical guard
    // in gate ensures it's not currently canonical, but be defensive)
    const allCanonicalItems = [
      ...(canonicalQueryVerified.Items ?? []),
      ...(canonicalQueryOptimized.Items ?? []),
    ].filter((item) => item.skill_id !== skillId);

    const prevCanonical = allCanonicalItems[0] as Record<string, unknown> | undefined;

    if (prevCanonical) {
      demotedSkillId = prevCanonical.skill_id as string;
      demotedVersionNumber = prevCanonical.version_number as number;
    }

    // Step 5: TransactWriteItems — atomic promote + demote + problems update
    // The is_canonical_status composite attribute powers the GSI-canonical sparse index.
    const isCanonicalStatus = `true#optimized`; // Promotion always sets status to optimized.

    const transactItems: TransactWriteCommandInput["TransactItems"] = [
      // 5a: Promote the skill
      {
        Update: {
          TableName: SKILLS_TABLE,
          Key: { skill_id: skillId, version_number: versionNumber },
          UpdateExpression:
            "SET is_canonical = :true, is_canonical_status = :ics, #status = :optimized, updated_at = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":true": true,
            ":ics": isCanonicalStatus,
            ":optimized": "optimized",
            ":now": now,
          },
          ConditionExpression: "attribute_exists(skill_id)",
        },
      },
      // 5c: Update problems table — set canonical_skill_id
      {
        Update: {
          TableName: PROBLEMS_TABLE,
          Key: { problem_id: problemId },
          UpdateExpression:
            "SET canonical_skill_id = :sid, updated_at = :now",
          ExpressionAttributeValues: {
            ":sid": skillId,
            ":now": now,
          },
          ConditionExpression: "attribute_exists(problem_id)",
        },
      },
    ];

    // 5b: Demote previous canonical (if exists)
    if (demotedSkillId !== null && demotedVersionNumber !== null) {
      transactItems.push({
        Update: {
          TableName: SKILLS_TABLE,
          Key: {
            skill_id: demotedSkillId,
            version_number: demotedVersionNumber,
          },
          UpdateExpression:
            "SET is_canonical = :false, updated_at = :now REMOVE is_canonical_status",
          ExpressionAttributeValues: {
            ":false": false,
            ":now": now,
          },
          ConditionExpression: "attribute_exists(skill_id)",
        },
      });
    }

    try {
      await docClient.send(
        new TransactWriteCommand({ TransactItems: transactItems }),
      );
    } catch (txErr) {
      const err_ = txErr as { name?: string; message?: string; CancellationReasons?: unknown[] };
      if (
        err_.name === "TransactionCanceledException" ||
        (err_.message ?? "").includes("TransactionCanceledException")
      ) {
        // Check if any reason is ConditionalCheckFailed
        const reasons = err_.CancellationReasons as Array<{ Code?: string }> | undefined;
        const hasConditionalFail = reasons?.some((r) => r?.Code === "ConditionalCheckFailed");
        if (hasConditionalFail) {
          return error(
            422,
            "PRECONDITION_FAILED",
            "Promotion transaction failed: a conditional check failed (skill or problem may have changed concurrently)",
          );
        }
        return error(
          422,
          "PRECONDITION_FAILED",
          "Promotion transaction cancelled",
        );
      }
      throw txErr; // Re-throw unexpected errors to be caught by outer handler
    }

    // Step 6: Invalidate CloudFront cache for affected skill and problem paths (fire-and-forget)
    void invalidateCloudFrontPaths(skillId, problemId, demotedSkillId).catch((cfErr) => {
      console.warn("[promoteCanonical] CloudFront invalidation failed (non-fatal):", cfErr);
    });

    // Step 7: Re-fetch the promoted skill and return
    const refetchResult = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        KeyConditionExpression: "skill_id = :sid",
        ExpressionAttributeValues: { ":sid": skillId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );

    const promotedItem = refetchResult.Items?.[0] as Record<string, unknown> | undefined;
    if (!promotedItem) {
      // Extremely unlikely — we just wrote it. Return from local state as fallback.
      return error(500, "INTERNAL_ERROR", "Failed to re-fetch promoted skill");
    }

    const promotedSkill: Skill = mapSkillFromDynamo(promotedItem);

    const response: PromoteCanonicalResponse = {
      skill: promotedSkill,
      demoted_skill_id: demotedSkillId,
    };

    return success(200, response);
  } catch (err) {
    console.error("promoteCanonical error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}

/**
 * Fire-and-forget CloudFront cache invalidation for affected paths.
 * Only runs when the CLOUDFRONT_DISTRIBUTION_ID env var is set.
 * Errors are swallowed — a cache invalidation failure must never block the response.
 *
 * Implementation note: uses a runtime eval-based dynamic require to avoid adding
 * @aws-sdk/client-cloudfront as a compile-time dependency. The CDK bundler will
 * include the package when CLOUDFRONT_DISTRIBUTION_ID is configured in the stack.
 * If the package is absent at runtime (local dev without CloudFront), this function
 * is a no-op because the env var check guards the require.
 */
async function invalidateCloudFrontPaths(
  skillId: string,
  problemId: string,
  demotedSkillId: string | null,
): Promise<void> {
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  if (!distributionId) {
    return; // CloudFront not configured; skip silently
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const cf = require("@aws-sdk/client-cloudfront") as any;
    const cfClient = new cf.CloudFrontClient({
      region: process.env.AWS_REGION ?? "us-east-2",
    });

    const paths = [
      `/skills/${skillId}`,
      `/problems/${problemId}`,
    ];
    if (demotedSkillId) {
      paths.push(`/skills/${demotedSkillId}`);
    }

    await cfClient.send(
      new cf.CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `promote-${skillId}-${Date.now()}`,
          Paths: {
            Quantity: paths.length,
            Items: paths,
          },
        },
      }),
    );
  } catch (err) {
    // Propagate so the caller's .catch() logs it as a warning
    throw err;
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
