/**
 * POST /problems — Create a new problem.
 *
 * Validates request body, checks name uniqueness via Scan,
 * generates problem_id, writes to Problems table.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
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

    // Check name uniqueness via Scan with filter
    const existingCheck = await docClient.send(
      new ScanCommand({
        TableName: PROBLEMS_TABLE,
        FilterExpression: "#n = :name",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: { ":name": data.name },
        Limit: 1,
      }),
    );

    if (existingCheck.Items && existingCheck.Items.length > 0) {
      return error(409, "CONFLICT", `Problem with name "${data.name}" already exists`);
    }

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
      }),
    );

    // Return the problem object matching the API contract (exclude internal fields)
    const { domain_primary, status, ...problemResponse } = problem;
    return success(201, { problem: problemResponse });
  } catch (err) {
    console.error("createProblem error:", err);
    return error(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}
