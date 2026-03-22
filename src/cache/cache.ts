/**
 * Cache layer for skill execution results.
 *
 * Provides three operations against the `codevolve-cache` DynamoDB table:
 *   - getCachedOutput  — look up a prior execution result by (skill_id, input_hash)
 *   - writeCachedOutput — persist a new result with a 24-hour TTL
 *   - incrementCacheHit — bump hit_count and record last_hit_at on a cache hit
 *
 * Table: codevolve-cache
 * PK: skill_id (S)
 * SK: input_hash (S)
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// ---------------------------------------------------------------------------
// DynamoDB client singleton
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const CACHE_TABLE_NAME = process.env.CACHE_TABLE_NAME ?? "codevolve-cache";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CachedOutput {
  output: Record<string, unknown>;
  version_number: number;
  hit_count: number;
  created_at: string;
}

export interface WriteCacheParams {
  skill_id: string;
  input_hash: string;
  version_number: number;
  output: Record<string, unknown>;
  input_snapshot: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// getCachedOutput
// ---------------------------------------------------------------------------

// Throws on DynamoDB errors — callers should catch and handle (unlike incrementCacheHit which swallows).
/**
 * Returns the cached execution output for (skill_id, input_hash), or null
 * if no entry exists.
 */
export async function getCachedOutput(
  skillId: string,
  inputHash: string,
): Promise<CachedOutput | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: CACHE_TABLE_NAME,
      Key: {
        skill_id: skillId,
        input_hash: inputHash,
      },
    }),
  );

  if (!result.Item) {
    return null;
  }

  const item = result.Item;

  return {
    output: item.output as Record<string, unknown>,
    version_number: item.version_number as number,
    hit_count: item.hit_count as number,
    created_at: item.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// writeCachedOutput
// ---------------------------------------------------------------------------

/**
 * Writes a new cache entry with a 24-hour TTL.
 *
 * Sets hit_count to 0 and omits last_hit_at on initial write.
 * Throws on DynamoDB errors — callers may fire-and-forget but errors propagate.
 */
export async function writeCachedOutput(params: WriteCacheParams): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 86400;

  await docClient.send(
    new PutCommand({
      TableName: CACHE_TABLE_NAME,
      Item: {
        skill_id: params.skill_id,
        input_hash: params.input_hash,
        version_number: params.version_number,
        output: params.output,
        input_snapshot: params.input_snapshot,
        hit_count: 0,
        created_at: now,
        ttl,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// incrementCacheHit
// ---------------------------------------------------------------------------

/**
 * Increments hit_count by 1 and sets last_hit_at to the current timestamp.
 *
 * Errors are caught and logged — this is a fire-and-forget operation and
 * must never crash the caller.
 */
export async function incrementCacheHit(
  skillId: string,
  inputHash: string,
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: CACHE_TABLE_NAME,
        Key: {
          skill_id: skillId,
          input_hash: inputHash,
        },
        UpdateExpression: "ADD hit_count :one SET last_hit_at = :now",
        ExpressionAttributeValues: {
          ":one": 1,
          ":now": new Date().toISOString(),
        },
      }),
    );
  } catch (err) {
    console.error("incrementCacheHit error — continuing:", err);
  }
}
