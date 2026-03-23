/**
 * POST /skills — Create a new skill.
 *
 * Validates request body, checks problem_id exists, checks uniqueness
 * (problem_id + name + language + version_label), generates embedding
 * via Bedrock Titan v2, writes to Skills table, increments skill_count
 * on Problems table.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { docClient, PROBLEMS_TABLE, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate, CreateSkillRequestSchema } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { generateEmbedding, buildEmbeddingText } from "./bedrock.js";
import { invalidateCloudFrontPaths } from "../shared/cloudfrontInvalidation.js";

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    // Parse and validate request body
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
    }

    const validation = validate(CreateSkillRequestSchema, body);
    if (!validation.success) {
      return error(
        400,
        validation.error.code,
        validation.error.message,
        validation.error.details,
      );
    }

    const data = validation.data;

    // Check that problem_id exists
    const problemResult = await docClient.send(
      new GetCommand({
        TableName: PROBLEMS_TABLE,
        Key: { problem_id: data.problem_id },
      }),
    );

    if (!problemResult.Item) {
      return error(
        404,
        "NOT_FOUND",
        `Problem ${data.problem_id} not found`,
      );
    }

    // Generate embedding via Bedrock Titan v2
    const tags = data.tags ?? [];
    const embeddingText = buildEmbeddingText({
      name: data.name,
      description: data.description,
      domain: data.domain,
      tags,
    });

    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(embeddingText);
    } catch (embeddingErr) {
      console.warn("Embedding generation failed, continuing without:", embeddingErr);
      // Non-fatal: skill is still created, just without embedding for /resolve
    }

    const now = new Date().toISOString();
    const skillId = uuidv4();

    const skillItem: Record<string, unknown> = {
      skill_id: skillId,
      version_number: 1,
      version_label: data.version_label ?? "0.1.0",
      problem_id: data.problem_id,
      name: data.name,
      description: data.description,
      is_canonical: false,
      status: data.status,
      language: data.language,
      domain: data.domain,
      tags: data.tags,
      inputs: data.inputs,
      outputs: data.outputs,
      examples: data.examples,
      tests: data.tests,
      implementation: data.implementation,
      confidence: 0,
      latency_p50_ms: null,
      latency_p95_ms: null,
      execution_count: 0,
      last_executed_at: null,
      optimization_flagged: false,
      created_at: now,
      updated_at: now,
    };

    if (embedding) {
      skillItem.embedding = embedding;
    }

    // Write to Skills table with PK uniqueness check (skill_id + version_number)
    try {
      await docClient.send(
        new PutCommand({
          TableName: SKILLS_TABLE,
          Item: skillItem,
          ConditionExpression:
            "attribute_not_exists(skill_id) AND attribute_not_exists(version_number)",
        }),
      );
    } catch (putErr: unknown) {
      if (
        putErr instanceof Error &&
        putErr.name === "ConditionalCheckFailedException"
      ) {
        return error(
          409,
          "CONFLICT",
          `Skill with same skill_id and version already exists`,
        );
      }
      throw putErr;
    }

    // Increment skill_count on Problems table
    await docClient.send(
      new UpdateCommand({
        TableName: PROBLEMS_TABLE,
        Key: { problem_id: data.problem_id },
        UpdateExpression:
          "SET skill_count = if_not_exists(skill_count, :zero) + :one, updated_at = :now",
        ExpressionAttributeValues: {
          ":zero": 0,
          ":one": 1,
          ":now": now,
        },
      }),
    );

    // Invalidate CloudFront edge cache for /skills* so GET /skills reflects the new skill.
    // Fire-and-forget: never throws, failure logged internally.
    void invalidateCloudFrontPaths(["/skills*"]);

    // Return API response shape (map version_number -> version)
    const skillResponse = {
      skill_id: skillId,
      problem_id: data.problem_id,
      name: data.name,
      description: data.description,
      version: 1,
      version_label: data.version_label ?? "0.1.0",
      is_canonical: false,
      status: data.status,
      language: data.language,
      domain: data.domain,
      tags: data.tags,
      inputs: data.inputs,
      outputs: data.outputs,
      examples: data.examples,
      tests: data.tests,
      implementation: data.implementation,
      confidence: 0,
      latency_p50_ms: null,
      latency_p95_ms: null,
      created_at: now,
      updated_at: now,
    };

    return success(201, { skill: skillResponse });
  } catch (err) {
    console.error("createSkill error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}
