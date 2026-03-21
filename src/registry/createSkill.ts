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
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { docClient, PROBLEMS_TABLE, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate, CreateSkillRequestSchema } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { generateEmbedding, buildEmbeddingText } from "./bedrock.js";

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

    // Check uniqueness: problem_id + name + language + version_label
    // Query GSI-problem-status to find skills with same problem_id, then filter
    const existingSkills = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        IndexName: "GSI-problem-status",
        KeyConditionExpression: "problem_id = :pid",
        FilterExpression:
          "#n = :name AND #lang = :language AND version_label = :vl",
        ExpressionAttributeNames: {
          "#n": "name",
          "#lang": "language",
        },
        ExpressionAttributeValues: {
          ":pid": data.problem_id,
          ":name": data.name,
          ":language": data.language,
          ":vl": data.version_label ?? "0.1.0",
        },
      }),
    );

    if (existingSkills.Items && existingSkills.Items.length > 0) {
      return error(
        409,
        "CONFLICT",
        `Skill with same problem_id, name, language, and version already exists`,
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

    // Write to Skills table
    await docClient.send(
      new PutCommand({
        TableName: SKILLS_TABLE,
        Item: skillItem,
      }),
    );

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
