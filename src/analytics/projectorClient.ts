import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../shared/dynamo.js";

let analyticsClientOverride: DynamoDBDocumentClient | null = null;

export function getAnalyticsDocClient(): DynamoDBDocumentClient {
  return analyticsClientOverride ?? docClient;
}

export function _setAnalyticsDocClientForTesting(
  client: DynamoDBDocumentClient | null,
): void {
  analyticsClientOverride = client;
}
