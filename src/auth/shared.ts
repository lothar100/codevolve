/**
 * Shared DynamoDB client and constants for auth handlers.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const API_KEYS_TABLE =
  process.env.API_KEYS_TABLE ?? "codevolve-api-keys";
