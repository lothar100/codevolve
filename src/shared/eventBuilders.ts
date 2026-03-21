/**
 * Typed builder functions for common analytics events.
 *
 * These ensure consistent event construction across all Lambda handlers.
 * Each builder returns an event without a timestamp — the emitEvent()
 * utility adds the server timestamp at send time.
 */

import type { AnalyticsEvent } from "./types.js";

type EventWithoutTimestamp = Omit<AnalyticsEvent, "timestamp">;

/**
 * Build a "resolve" analytics event.
 */
export function buildResolveEvent(params: {
  intent: string;
  skillId?: string | null;
  confidence: number;
  latencyMs: number;
  success: boolean;
}): EventWithoutTimestamp {
  return {
    event_type: "resolve",
    skill_id: params.skillId ?? null,
    intent: params.intent,
    latency_ms: params.latencyMs,
    confidence: params.confidence,
    cache_hit: false,
    input_hash: null,
    success: params.success,
  };
}

/**
 * Build an "execute" analytics event.
 */
export function buildExecuteEvent(params: {
  skillId: string;
  latencyMs: number;
  cacheHit: boolean;
  inputHash: string;
  success: boolean;
}): EventWithoutTimestamp {
  return {
    event_type: "execute",
    skill_id: params.skillId,
    intent: null,
    latency_ms: params.latencyMs,
    confidence: null,
    cache_hit: params.cacheHit,
    input_hash: params.inputHash,
    success: params.success,
  };
}

/**
 * Build a "validate" analytics event.
 */
export function buildValidateEvent(params: {
  skillId: string;
  confidence: number;
  latencyMs: number;
  success: boolean;
}): EventWithoutTimestamp {
  return {
    event_type: "validate",
    skill_id: params.skillId,
    intent: null,
    latency_ms: params.latencyMs,
    confidence: params.confidence,
    cache_hit: false,
    input_hash: null,
    success: params.success,
  };
}

/**
 * Build a "fail" analytics event.
 * The `reason` is stored in the `intent` field for gap-detection analytics.
 */
export function buildFailEvent(params: {
  skillId?: string | null;
  intent?: string | null;
  latencyMs: number;
  reason: string;
}): EventWithoutTimestamp {
  return {
    event_type: "fail",
    skill_id: params.skillId ?? null,
    intent: params.intent ?? params.reason,
    latency_ms: params.latencyMs,
    confidence: null,
    cache_hit: false,
    input_hash: null,
    success: false,
  };
}
