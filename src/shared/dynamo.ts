/**
 * DynamoDB DocumentClient singleton and table name constants.
 *
 * All table names are sourced from environment variables so that
 * they can differ between stages (dev, staging, prod).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// ---------------------------------------------------------------------------
// Table names — always read from environment variables
// ---------------------------------------------------------------------------

export const PROBLEMS_TABLE =
  process.env.PROBLEMS_TABLE ?? "codevolve-problems";
export const SKILLS_TABLE = process.env.SKILLS_TABLE ?? "codevolve-skills";
export const CACHE_TABLE = process.env.CACHE_TABLE ?? "codevolve-cache";
export const ARCHIVE_TABLE = process.env.ARCHIVE_TABLE ?? "codevolve-archive";
