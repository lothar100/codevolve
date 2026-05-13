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
export const ARCHIVE_TABLE = process.env.ARCHIVE_TABLE ?? "codevolve-archive";
export const EVOLVE_JOBS_TABLE =
  process.env.EVOLVE_JOBS_TABLE ?? "codevolve-evolve-jobs";
export const ANALYTICS_BUCKETS_TABLE =
  process.env.ANALYTICS_BUCKETS_TABLE ?? "codevolve-analytics-buckets";
export const ANALYTICS_INTENT_SUMMARIES_TABLE =
  process.env.ANALYTICS_INTENT_SUMMARIES_TABLE ??
  "codevolve-analytics-intent-summaries";
export const ANALYTICS_RECENT_FEEDS_TABLE =
  process.env.ANALYTICS_RECENT_FEEDS_TABLE ??
  "codevolve-analytics-recent-feeds";
export const ANALYTICS_INPUT_STATE_TABLE =
  process.env.ANALYTICS_INPUT_STATE_TABLE ?? "codevolve-analytics-input-state";
