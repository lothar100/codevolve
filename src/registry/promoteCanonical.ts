/**
 * POST /skills/:skill_id/promote-canonical
 *
 * Promotes a skill to canonical status for its problem_id. Gate conditions:
 *   1. confidence >= 0.85
 *   2. test_fail_count === 0 (all tests passing from last /validate run)
 *
 * Uses DynamoDB TransactWriteCommand to atomically promote the target skill and
 * demote the previous canonical (if one exists) for the same problem_id.
 *
 * Emits a promote_canonical Kinesis event (fire-and-forget — failure never
 * crashes the handler).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, PROBLEMS_TABLE, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import type { Skill } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const PathParamsSchema = z.object({
  skill_id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const startMs = Date.now();

  try {
    // CDK registers this route as /skills/{id}/promote-canonical so the path
    // parameter arrives as "id". Accept both names for forward-compatibility.
    const rawId = event.pathParameters?.skill_id ?? event.pathParameters?.id;
    const pathValidation = validate(PathParamsSchema, { skill_id: rawId });
    if (!pathValidation.success) {
      return error(400, "VALIDATION_ERROR", "Invalid skill_id format");
    }

    const skillId = pathValidation.data.skill_id;

    // ------------------------------------------------------------------
    // 1. Fetch the latest version of the target skill
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // 2. Already canonical — 409 CONFLICT per spec §4.1
    // ------------------------------------------------------------------
    if (skillItem.is_canonical === true) {
      return error(409, "CONFLICT", "Skill is already the canonical for this problem");
    }

    // ------------------------------------------------------------------
    // 3. Archived gate
    // ------------------------------------------------------------------
    if (skillItem.status === "archived") {
      return error(422, "PRECONDITION_FAILED", "Cannot promote an archived skill");
    }

    // ------------------------------------------------------------------
    // 4. Gate condition 1: confidence >= 0.85
    // ------------------------------------------------------------------
    const confidence = (skillItem.confidence as number) ?? 0;
    if (confidence < 0.85) {
      return error(
        422,
        "PRECONDITION_FAILED",
        "Skill confidence must be >= 0.85",
        { confidence },
      );
    }

    // ------------------------------------------------------------------
    // 5. Gate condition 2: test_fail_count === 0
    // ------------------------------------------------------------------
    const testFailCount = (skillItem.test_fail_count as number) ?? 0;
    if (testFailCount > 0) {
      return error(
        422,
        "PRECONDITION_FAILED",
        "Skill has failing tests",
        { test_fail_count: testFailCount },
      );
    }

    // ------------------------------------------------------------------
    // 5b. Gate condition 3: must have been validated (test_pass_count > 0)
    // ------------------------------------------------------------------
    const testPassCount = (skillItem.test_pass_count as number | undefined) ?? 0;
    if (testPassCount === 0) {
      return error(
        422,
        "PRECONDITION_FAILED",
        "Skill has not been validated or all tests are failing",
        { test_pass_count: testPassCount },
      );
    }

    const problemId = skillItem.problem_id as string;
    const versionNumber = skillItem.version_number as number;
    const now = new Date().toISOString();

    // ------------------------------------------------------------------
    // 6. Find the current canonical for the same problem_id + language
    //    Uses GSI-canonical (is_canonical_status PK) with language filter.
    //    Query both verified and optimized statuses since either can be canonical.
    // ------------------------------------------------------------------
    const skillLanguage = skillItem.language as string;
    let previousCanonicalItem: Record<string, unknown> | null = null;

    for (const statusSuffix of ["verified", "optimized"]) {
      const canonicalQuery = await docClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          IndexName: "GSI-canonical",
          KeyConditionExpression: "is_canonical_status = :ics",
          FilterExpression: "problem_id = :pid AND #lang = :lang",
          ExpressionAttributeNames: { "#lang": "language" },
          ExpressionAttributeValues: {
            ":ics": `true#${statusSuffix}`,
            ":pid": problemId,
            ":lang": skillLanguage,
          },
          Limit: 1,
        }),
      );
      if (canonicalQuery.Items && canonicalQuery.Items.length > 0) {
        previousCanonicalItem = canonicalQuery.Items[0] as Record<string, unknown>;
        break;
      }
    }

    const previousCanonicalId: string | null = previousCanonicalItem
      ? (previousCanonicalItem.skill_id as string)
      : null;
    const previousCanonicalVersion: number | null = previousCanonicalItem
      ? (previousCanonicalItem.version_number as number)
      : null;

    // ------------------------------------------------------------------
    // 7. TransactWriteCommand — atomically promote + demote + update Problem
    // ------------------------------------------------------------------
    const isCanonicalStatus = `true#${skillItem.status as string}`;

    const transactInput: TransactWriteCommandInput = {
      TransactItems: [
        // Promote target skill — ConditionExpression guards against race conditions
        {
          Update: {
            TableName: SKILLS_TABLE,
            Key: {
              skill_id: skillId,
              version_number: versionNumber,
            },
            UpdateExpression:
              "SET is_canonical = :true, is_canonical_status = :ics, updated_at = :now",
            ConditionExpression:
              "confidence >= :threshold AND test_fail_count = :zero",
            ExpressionAttributeValues: {
              ":true": true,
              ":ics": isCanonicalStatus,
              ":now": now,
              ":threshold": 0.85,
              ":zero": 0,
            },
          },
        },
        // Update Problems table canonical_skill_id
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
          },
        },
      ],
    };

    // Demote the previous canonical if one exists
    if (previousCanonicalId !== null && previousCanonicalVersion !== null) {
      transactInput.TransactItems!.push({
        Update: {
          TableName: SKILLS_TABLE,
          Key: {
            skill_id: previousCanonicalId,
            version_number: previousCanonicalVersion,
          },
          UpdateExpression:
            "SET is_canonical = :false, updated_at = :now REMOVE is_canonical_status",
          ExpressionAttributeValues: {
            ":false": false,
            ":now": now,
          },
        },
      });
    }

    try {
      await docClient.send(new TransactWriteCommand(transactInput));
    } catch (txErr) {
      if (
        txErr instanceof Error &&
        txErr.name === "TransactionCanceledException"
      ) {
        return error(
          422,
          "PRECONDITION_FAILED",
          "Promotion conditions no longer met — concurrent modification detected",
        );
      }
      throw txErr;
    }

    // ------------------------------------------------------------------
    // 8. Emit Kinesis event (fire-and-forget)
    // ------------------------------------------------------------------
    try {
      await emitEvent({
        event_type: "promote_canonical",
        skill_id: skillId,
        intent: `problem_id=${problemId} previous_canonical_id=${previousCanonicalId ?? "null"}`,
        latency_ms: Date.now() - startMs,
        confidence,
        cache_hit: false,
        input_hash: null,
        success: true,
      });
    } catch (emitErr) {
      console.error(
        "[promoteCanonical] Kinesis emit failed (swallowed):",
        emitErr,
      );
    }

    // ------------------------------------------------------------------
    // 9. Return the promoted skill record
    // ------------------------------------------------------------------
    const promotedSkill: Skill = {
      ...mapSkillFromDynamo(skillItem),
      is_canonical: true,
      updated_at: now,
    };

    return success(200, {
      skill: promotedSkill,
      demoted_skill_id: previousCanonicalId,
    });
  } catch (err) {
    console.error("[promoteCanonical] Unexpected error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    latency_p50_ms: (item.latency_p50_ms as number | null) ?? null,
    latency_p95_ms: (item.latency_p95_ms as number | null) ?? null,
    created_at: item.created_at as string,
    updated_at: item.updated_at as string,
  };
}
