import { createHash } from "node:crypto";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import {
  buildEmbeddingText,
  generateEmbeddingWithRetry,
} from "../lib/embeddings.js";
import { cosineSimilarity, computeBoost } from "../lib/similarity.js";

export interface IntentResolutionRequest {
  intent: string;
  language?: string;
  domain?: string[];
  tags?: string[];
  top_k?: number;
  min_confidence?: number;
}

export interface IntentMatch {
  skill_id: string;
  name: string;
  description: string;
  language: string;
  status: string;
  is_canonical: boolean;
  confidence: number;
  similarity_score: number;
  implementation_token_size: number | null;
  domain: string[];
  tags: string[];
}

export interface ChainSuggestionStep {
  step: number;
  intent: string;
  confidence: number;
  best_match: IntentMatch | null;
  input_mapping: Record<string, string>;
}

export interface ChainSuggestion {
  kind: "intent_chain";
  rationale: string;
  overall_confidence: number;
  steps: ChainSuggestionStep[];
}

export interface IntentResolutionResult {
  matches: IntentMatch[];
  bestMatch: IntentMatch | null;
  intentConfidence: number;
  evolveTriggered: boolean;
  inputHash: string;
}

interface SkillItem {
  skill_id: string;
  version_number: number;
  name: string;
  description: string;
  language: string;
  status: string;
  is_canonical: boolean;
  confidence: number;
  implementation_token_size?: number | null;
  domain: string[];
  tags: string[];
  embedding?: number[];
}

const CONFIDENCE_THRESHOLD = 0.5;
const MAX_ADAPTIVE_TOP_K = 5;
const PROJECTION =
  "skill_id, version_number, #nm, description, #lang, #st, is_canonical, confidence, implementation_token_size, #dom, tags, embedding";
const EXPR_NAMES: Record<string, string> = {
  "#st": "status",
  "#nm": "name",
  "#lang": "language",
  "#dom": "domain",
};

export async function resolveIntentRequest(
  req: IntentResolutionRequest,
): Promise<IntentResolutionResult> {
  const effectiveThreshold = Math.max(
    CONFIDENCE_THRESHOLD,
    req.min_confidence ?? 0,
  );

  const intentText = buildEmbeddingText({
    name: req.intent,
    description: "",
    domain: req.domain ?? [],
    tags: req.tags ?? [],
  });
  const intentEmbedding = await generateEmbeddingWithRetry(intentText);
  const candidates = await fetchCandidates(req.language);

  interface ScoredCandidate {
    item: SkillItem;
    similarityScore: number;
    finalScore: number;
  }

  const scored: ScoredCandidate[] = [];
  for (const item of candidates) {
    if (!item.embedding || item.embedding.length === 0) {
      continue;
    }

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

  scored.sort((a, b) => b.finalScore - a.finalScore);

  const topScore = scored[0]?.finalScore ?? 0;
  const topK = computeIntentTopK(topScore, req.top_k);
  const matches: IntentMatch[] = scored
    .slice(0, topK)
    .map((s) => ({
      skill_id: s.item.skill_id,
      name: s.item.name,
      description: s.item.description,
      language: s.item.language,
      status: s.item.status,
      is_canonical: s.item.is_canonical,
      confidence: Math.min(1, s.finalScore),
      similarity_score: s.similarityScore,
      implementation_token_size: s.item.implementation_token_size ?? null,
      domain: s.item.domain ?? [],
      tags: s.item.tags ?? [],
    }));

  const intentConfidence = matches[0]?.confidence ?? 0;
  const evolveTriggered =
    matches.length === 0 || intentConfidence < effectiveThreshold;
  const bestMatch =
    intentConfidence >= effectiveThreshold ? (matches[0] ?? null) : null;

  return {
    matches,
    bestMatch,
    intentConfidence,
    evolveTriggered,
    inputHash: hashIntentRequest(req, bestMatch?.skill_id),
  };
}

export async function buildChainSuggestion(
  req: IntentResolutionRequest,
): Promise<ChainSuggestion | null> {
  const splitSteps = splitComposableIntent(req.intent);
  if (splitSteps.length < 2) {
    return null;
  }

  const steps: ChainSuggestionStep[] = [];
  for (let i = 0; i < splitSteps.length; i++) {
    const stepIntent = splitSteps[i];
    const result = await resolveIntentRequest({
      intent: stepIntent,
      language: req.language,
      domain: req.domain,
      tags: req.tags,
      top_k: 1,
      min_confidence: req.min_confidence,
    });

    steps.push({
      step: i + 1,
      intent: stepIntent,
      confidence: result.intentConfidence,
      best_match: result.bestMatch,
      input_mapping: i === 0 ? {} : { previous_output: "input" },
    });
  }

  if (steps.every((step) => step.best_match === null)) {
    return null;
  }

  return {
    kind: "intent_chain",
    rationale:
      "The request appears to describe multiple local steps, so the router split it into an ordered chain suggestion.",
    overall_confidence:
      steps.reduce((sum, step) => sum + step.confidence, 0) / steps.length,
    steps,
  };
}

export async function fetchSkillSummaryById(skillId: string): Promise<IntentMatch | null> {
  const resp = await docClient.send(
    new QueryCommand({
      TableName: SKILLS_TABLE,
      KeyConditionExpression: "skill_id = :sid",
      ExpressionAttributeValues: { ":sid": skillId },
      ScanIndexForward: false,
      Limit: 1,
      ProjectionExpression: PROJECTION,
      ExpressionAttributeNames: EXPR_NAMES,
    }),
  );

  const item = resp.Items?.[0] as SkillItem | undefined;
  if (!item || item.status === "archived") {
    return null;
  }

  return {
    skill_id: item.skill_id,
    name: item.name,
    description: item.description,
    language: item.language,
    status: item.status,
    is_canonical: item.is_canonical,
    confidence: item.confidence,
    similarity_score: item.confidence,
    implementation_token_size: item.implementation_token_size ?? null,
    domain: item.domain ?? [],
    tags: item.tags ?? [],
  };
}

export function splitComposableIntent(intent: string): string[] {
  return intent
    .split(/\s+(?:then|and then|after that|afterwards)\s+|->|=>|;/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
}

export function hashIntentRequest(
  req: {
    intent: string;
    language?: string;
    domain?: string[];
    tags?: string[];
  },
  skillId?: string | null,
): string {
  const normalized = {
    intent: req.intent,
    skill_id: skillId ?? null,
    language: req.language ?? null,
    domain: [...(req.domain ?? [])].sort(),
    tags: [...(req.tags ?? [])].sort(),
  };

  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

function computeIntentTopK(bestScore: number, requestedTopK?: number): number {
  const normalizedConfidence = clamp((bestScore - 0.5) * 2, 0, 1);
  const adaptiveTopK = clamp(
    Math.round(1 + 4 * (1 - normalizedConfidence)),
    1,
    MAX_ADAPTIVE_TOP_K,
  );

  if (requestedTopK === undefined) {
    return adaptiveTopK;
  }

  return Math.min(requestedTopK, adaptiveTopK);
}

async function fetchCandidates(language?: string): Promise<SkillItem[]> {
  const items: SkillItem[] = [];

  if (language) {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await docClient.send(
        new QueryCommand({
          TableName: SKILLS_TABLE,
          IndexName: "GSI-language-confidence",
          KeyConditionExpression: "#lang = :lang",
          FilterExpression: "attribute_exists(embedding) AND #st <> :archived",
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
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await docClient.send(
        new ScanCommand({
          TableName: SKILLS_TABLE,
          FilterExpression: "attribute_exists(embedding) AND #st <> :archived",
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
