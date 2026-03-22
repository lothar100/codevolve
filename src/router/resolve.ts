/**
 * POST /resolve — Skill Router
 *
 * Embeds the caller's intent via Bedrock Titan v2, scans DynamoDB skills
 * for candidate skills (excluding archived and skills without embeddings),
 * ranks by cosine similarity + tag/domain boost, and returns the top-k
 * matches with a resolve confidence score.
 *
 * Architecture constraints:
 * - No LLM calls in this path — only Bedrock embedding (deterministic).
 * - Must respond p95 < 100ms (embedding call is the dominant latency).
 * - Never returns HTTP 404; low-confidence resolves return 200 with
 *   best_match: null and evolve_triggered: true.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import {
  buildEmbeddingText,
  generateEmbeddingWithRetry,
  type EmbeddingError,
} from "../lib/embeddings.js";
import { cosineSimilarity, computeBoost } from "../lib/similarity.js";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const ResolveRequestSchema = z.object({
  intent: z.string().min(1).max(1000),
  language: z.string().optional(),
  domain: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  top_k: z.number().int().min(1).max(20).default(5),
  min_confidence: z.number().min(0).max(1).optional(),
});

type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface ResolveMatch {
  skill_id: string;
  name: string;
  description: string;
  language: string;
  status: string;
  is_canonical: boolean;
  confidence: number;
  similarity_score: number;
  domain: string[];
  tags: string[];
}

interface ResolveResponse {
  matches: ResolveMatch[];
  best_match: ResolveMatch | null;
  resolve_confidence: number;
  evolve_triggered: boolean;
  latency_ms: number;
}

// ---------------------------------------------------------------------------
// DynamoDB skill item shape (projected fields only)
// ---------------------------------------------------------------------------

interface SkillItem {
  skill_id: string;
  version_number: number;
  name: string;
  description: string;
  language: string;
  status: string;
  is_canonical: boolean;
  confidence: number;
  domain: string[];
  tags: string[];
  // DynamoDB stores embedding as a list of numbers (L attribute)
  embedding?: number[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.50;
const PROJECTION =
  "skill_id, version_number, #nm, description, #lang, #st, is_canonical, confidence, #dom, tags, embedding";
const EXPR_NAMES: Record<string, string> = {
  "#st": "status",
  "#nm": "name",
  "#lang": "language",
  "#dom": "domain",
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const startMs = Date.now();

  // Parse and validate request body
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const validation = validate(ResolveRequestSchema, body);
  if (!validation.success) {
    return error(
      400,
      validation.error.code,
      validation.error.message,
      validation.error.details,
    );
  }

  const req = validation.data;
  const effectiveThreshold = Math.max(
    CONFIDENCE_THRESHOLD,
    req.min_confidence ?? 0,
  );

  // -------------------------------------------------------------------------
  // Embed the intent
  // -------------------------------------------------------------------------

  let intentEmbedding: Float32Array;
  try {
    // Build a minimal text for the intent (name = intent, no domain/tags yet)
    const intentText = buildEmbeddingText({
      name: req.intent,
      description: "",
      domain: req.domain ?? [],
      tags: req.tags ?? [],
    });
    intentEmbedding = await generateEmbeddingWithRetry(intentText);
  } catch (embErr: unknown) {
    const e = embErr as EmbeddingError;
    const code = e.code ?? "EMBEDDING_ERROR";
    console.error("[resolve] Bedrock embedding failed:", embErr);
    void emitEvent({
      event_type: "resolve",
      skill_id: null,
      intent: req.intent,
      latency_ms: Date.now() - startMs,
      confidence: 0,
      cache_hit: false,
      input_hash: null,
      success: false,
    }).catch((emitErr) =>
      console.warn("[resolve] emitEvent failed (swallowed):", emitErr),
    );
    return error(503, code, e.message ?? "Embedding service unavailable");
  }

  // -------------------------------------------------------------------------
  // Fetch skill candidates from DynamoDB
  // -------------------------------------------------------------------------

  let candidates: SkillItem[];
  try {
    candidates = await fetchCandidates(req.language);
  } catch (dbErr: unknown) {
    console.error("[resolve] DynamoDB scan failed:", dbErr);
    void emitEvent({
      event_type: "resolve",
      skill_id: null,
      intent: req.intent,
      latency_ms: Date.now() - startMs,
      confidence: 0,
      cache_hit: false,
      input_hash: null,
      success: false,
    }).catch((emitErr) =>
      console.warn("[resolve] emitEvent failed (swallowed):", emitErr),
    );
    return error(503, "DB_SCAN_ERROR", "Database scan failed");
  }

  // -------------------------------------------------------------------------
  // Score and rank candidates
  // -------------------------------------------------------------------------

  interface ScoredCandidate {
    item: SkillItem;
    similarityScore: number;
    finalScore: number;
  }

  const scored: ScoredCandidate[] = [];

  for (const item of candidates) {
    // Skip skills without embeddings
    if (!item.embedding || item.embedding.length === 0) {
      continue;
    }

    // Parse embedding once as Float32Array
    const skillVec = new Float32Array(item.embedding);
    const sim = cosineSimilarity(intentEmbedding, skillVec);
    const boost = computeBoost({
      requestTags: req.tags ?? [],
      requestDomain: req.domain ?? [],
      skillTags: item.tags ?? [],
      skillDomain: item.domain ?? [],
    });

    scored.push({
      item,
      similarityScore: sim,
      finalScore: sim + boost,
    });
  }

  // Sort descending by finalScore
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Take top_k, cap confidence at 1.0
  const topMatches: ResolveMatch[] = scored
    .slice(0, req.top_k)
    .map((s) => ({
      skill_id: s.item.skill_id,
      name: s.item.name,
      description: s.item.description,
      language: s.item.language,
      status: s.item.status,
      is_canonical: s.item.is_canonical,
      confidence: Math.min(1, s.finalScore),
      similarity_score: s.similarityScore,
      domain: s.item.domain ?? [],
      tags: s.item.tags ?? [],
    }));

  // Determine resolve_confidence and whether evolve should trigger
  const resolveConfidence =
    topMatches.length > 0 ? (topMatches[0].confidence) : 0;

  const evolveTriggered =
    topMatches.length === 0 || resolveConfidence < effectiveThreshold;

  const bestMatch: ResolveMatch | null =
    resolveConfidence >= effectiveThreshold ? (topMatches[0] ?? null) : null;

  const latencyMs = Date.now() - startMs;

  // -------------------------------------------------------------------------
  // Emit Kinesis analytics event (fire-and-forget — do not await)
  // -------------------------------------------------------------------------

  void emitEvent({
    event_type: "resolve",
    skill_id: bestMatch?.skill_id ?? null,
    intent: req.intent,
    latency_ms: latencyMs,
    confidence: resolveConfidence,
    cache_hit: false,
    input_hash: null,
    success: topMatches.length > 0,
  }).catch((emitErr) =>
    console.warn("[resolve] emitEvent failed (swallowed):", emitErr),
  );

  // -------------------------------------------------------------------------
  // Return response
  // -------------------------------------------------------------------------

  const responseBody: ResolveResponse = {
    matches: topMatches,
    best_match: bestMatch,
    resolve_confidence: resolveConfidence,
    evolve_triggered: evolveTriggered,
    latency_ms: latencyMs,
  };

  return success(200, responseBody);
}

// ---------------------------------------------------------------------------
// DynamoDB helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all active (non-archived) skill candidates that have an embedding.
 *
 * If language is provided, query GSI-language-confidence first to narrow
 * the candidate set. Otherwise, full table scan with filter.
 *
 * Handles DynamoDB pagination via LastEvaluatedKey loop.
 */
async function fetchCandidates(language?: string): Promise<SkillItem[]> {
  const items: SkillItem[] = [];

  if (language) {
    // Use GSI-language-confidence to pre-filter by language
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await docClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          IndexName: "GSI-language-confidence",
          KeyConditionExpression: "#lang = :lang",
          FilterExpression:
            "attribute_exists(embedding) AND #st <> :archived",
          ExpressionAttributeNames: EXPR_NAMES,
          ExpressionAttributeValues: {
            ":lang": language,
            ":archived": "archived",
          },
          ProjectionExpression: PROJECTION,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of resp.Items ?? []) {
        items.push(item as SkillItem);
      }
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey !== undefined);
  } else {
    // Full table scan
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await docClient.send(
        new ScanCommand({
          TableName: SKILLS_TABLE,
          FilterExpression:
            "attribute_exists(embedding) AND #st <> :archived",
          ExpressionAttributeNames: EXPR_NAMES,
          ExpressionAttributeValues: {
            ":archived": "archived",
          },
          ProjectionExpression: PROJECTION,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of resp.Items ?? []) {
        items.push(item as SkillItem);
      }
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey !== undefined);
  }

  return items;
}
