/**
 * Bedrock Titan Embed Text v2 embedding generation.
 *
 * Generates 1024-dimension, L2-normalized embedding vectors for
 * semantic skill search in /resolve.
 *
 * Architecture constraint: no LLM calls in /resolve hot path.
 * This module is only used at skill-write time (createSkill) and at
 * /resolve request time to embed the incoming intent.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const BEDROCK_MODEL_ID = "amazon.titan-embed-text-v2:0";
const EMBEDDING_DIMENSIONS = 1024;
const MAX_EMBEDDING_TEXT_CHARS = 8_192;

export const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

/**
 * Build the canonical embedding text for a skill from its fields.
 *
 * Format: "{name}. {description} domain:{d0} {d1} ... tags:{t0} {t1} ..."
 * Truncates description if total length exceeds MAX_EMBEDDING_TEXT_CHARS.
 */
export function buildEmbeddingText(fields: {
  name: string;
  description: string;
  domain: string[];
  tags: string[];
}): string {
  const domainSuffix =
    fields.domain.length > 0 ? ` domain:${fields.domain.join(" ")}` : "";
  const tagSuffix =
    fields.tags.length > 0 ? ` tags:${fields.tags.join(" ")}` : "";
  const suffix = domainSuffix + tagSuffix;

  // Core format: "{name}. {description}{suffix}"
  const prefix = `${fields.name}. `;
  const maxDescLen = MAX_EMBEDDING_TEXT_CHARS - prefix.length - suffix.length;

  const description =
    fields.description.length > maxDescLen
      ? fields.description.slice(0, maxDescLen)
      : fields.description;

  return `${prefix}${description}${suffix}`;
}

/**
 * Generate a 1024-dimension Float32Array embedding from text via Bedrock Titan v2.
 *
 * Bedrock returns pre-normalized vectors (normalize: true), so no
 * client-side normalization is needed. Returns a Float32Array for
 * performance-efficient cosine similarity computation.
 *
 * Throws on Bedrock errors — callers handle retry and error mapping.
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text,
        dimensions: EMBEDDING_DIMENSIONS,
        normalize: true,
      }),
    }),
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as {
    embedding: number[];
  };

  return new Float32Array(responseBody.embedding);
}

/**
 * Generate an embedding with one retry on HTTP 429 (throttle).
 * Returns the Float32Array on success.
 * Throws a typed EmbeddingError on failure.
 */
export interface EmbeddingError extends Error {
  code: "EMBEDDING_ERROR" | "EMBEDDING_THROTTLED";
  statusCode: number;
}

export async function generateEmbeddingWithRetry(
  text: string,
): Promise<Float32Array> {
  try {
    return await generateEmbedding(text);
  } catch (firstErr: unknown) {
    const firstStatus = extractHttpStatus(firstErr);

    if (firstStatus === 429) {
      // Retry once after 200ms backoff
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      try {
        return await generateEmbedding(text);
      } catch (retryErr: unknown) {
        const retryStatus = extractHttpStatus(retryErr);
        throw makeEmbeddingError(
          retryStatus === 429 ? "EMBEDDING_THROTTLED" : "EMBEDDING_ERROR",
          retryStatus,
          retryErr,
        );
      }
    }

    throw makeEmbeddingError("EMBEDDING_ERROR", firstStatus, firstErr);
  }
}

function extractHttpStatus(err: unknown): number {
  if (
    err !== null &&
    typeof err === "object" &&
    "$metadata" in err &&
    typeof (err as { $metadata: { httpStatusCode?: number } }).$metadata
      .httpStatusCode === "number"
  ) {
    return (err as { $metadata: { httpStatusCode: number } }).$metadata
      .httpStatusCode;
  }
  return 500;
}

function makeEmbeddingError(
  code: EmbeddingError["code"],
  statusCode: number,
  cause: unknown,
): EmbeddingError {
  const message =
    code === "EMBEDDING_THROTTLED"
      ? "Bedrock embedding service is throttling requests"
      : "Bedrock embedding service returned an error";

  const err = new Error(message) as EmbeddingError;
  err.code = code;
  err.statusCode = statusCode;
  err.cause = cause;
  return err;
}
