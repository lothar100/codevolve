/**
 * POST /problems — Create a new problem.
 *
 * Validates request body, generates problem_id, and writes to the Problems
 * table using a conditional PutItem (attribute_not_exists(problem_id)) to
 * prevent duplicate UUID collisions.
 *
 * NOTE: Full name-uniqueness enforcement requires a DynamoDB GSI keyed on
 * `name`. Without that index, concurrent requests with identical names can
 * both succeed (TOCTOU race). This is a known limitation tracked for Phase 2.
 * The scan-based pre-check has been removed because it is both slower and
 * equally susceptible to the race condition.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { docClient, PROBLEMS_TABLE } from "../shared/dynamo.js";
import { validate, CreateProblemRequestSchema } from "../shared/validation.js";
import { success, error } from "../shared/response.js";

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

    const validation = validate(CreateProblemRequestSchema, body);
    if (!validation.success) {
      return error(400, validation.error.code, validation.error.message, validation.error.details);
    }

    const data = validation.data;

    const now = new Date().toISOString();
    const problem = {
      problem_id: uuidv4(),
      name: data.name,
      description: data.description,
      difficulty: data.difficulty,
      domain: data.domain,
      tags: data.tags,
      ...(data.constraints !== undefined ? { constraints: data.constraints } : {}),
      examples: [],
      canonical_skill_id: null,
      skill_count: 0,
      status: "active",
      domain_primary: data.domain[0], // denormalized for GSI-status-domain
      created_at: now,
      updated_at: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: PROBLEMS_TABLE,
        Item: problem,
        // Prevent overwriting an existing record with the same problem_id.
        // UUID collisions from uuidv4() are astronomically unlikely but this
        // makes the write safe and surfaces any future key-generation bugs.
        ConditionExpression: "attribute_not_exists(problem_id)",
      }),
    );

    // Return the problem object matching the API contract (exclude internal fields)
    const { domain_primary, status, ...problemResponse } = problem;
    return success(201, { problem: problemResponse });
  } catch (err) {
    // ConditionalCheckFailedException means a problem with this problem_id
    // already exists (UUID collision — should never happen in practice).
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      return error(409, "CONFLICT", `Problem with id already exists`);
    }
    console.error("createProblem error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}
