/**
 * POST /resolve — Skill Router
 *
 * Canonical public route is POST /intent. This handler preserves the
 * compatibility naming internally while returning intent-first fields.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import {
  buildChainSuggestion,
  resolveIntentRequest,
  type ChainSuggestion,
  type IntentMatch,
} from "./intentCore.js";

const IntentRequestSchema = z.object({
  intent: z.string().min(1).max(1000),
  language: z.string().optional(),
  domain: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  top_k: z.number().int().min(1).max(20).optional(),
  min_confidence: z.number().min(0).max(1).optional(),
});

interface IntentResponse {
  matches: IntentMatch[];
  best_match: IntentMatch | null;
  intent_confidence: number;
  resolve_confidence: number;
  evolve_triggered: boolean;
  latency_ms: number;
  chain_suggestion?: ChainSuggestion;
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const startMs = Date.now();

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const validation = validate(IntentRequestSchema, body);
  if (!validation.success) {
    return error(
      400,
      validation.error.code,
      validation.error.message,
      validation.error.details,
    );
  }

  const req = validation.data;

  try {
    const result = await resolveIntentRequest(req);
    const chainSuggestion = await buildChainSuggestion(req);
    const latencyMs = Date.now() - startMs;

    void emitEvent({
      event_type: "resolve",
      skill_id: result.bestMatch?.skill_id ?? null,
      intent: chainSuggestion ? `chain:${req.intent}` : req.intent,
      latency_ms: latencyMs,
      confidence: result.intentConfidence,
      cache_hit: false,
      input_hash: result.inputHash,
      success: result.matches.length > 0 || chainSuggestion !== null,
    }).catch((emitErr) =>
      console.warn("[resolve] emitEvent failed (swallowed):", emitErr),
    );

    const responseBody: IntentResponse = {
      matches: result.matches,
      best_match: result.bestMatch,
      intent_confidence: result.intentConfidence,
      resolve_confidence: result.intentConfidence,
      evolve_triggered: result.evolveTriggered,
      latency_ms: latencyMs,
      ...(chainSuggestion ? { chain_suggestion: chainSuggestion } : {}),
    };

    return success(200, responseBody);
  } catch (err) {
    console.error("[resolve] Unexpected failure:", err);
    const errCode =
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "DB_SCAN_ERROR";
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
    return error(503, errCode, errCode === "DB_SCAN_ERROR" ? "Database scan failed" : "Embedding service unavailable");
  }
}
