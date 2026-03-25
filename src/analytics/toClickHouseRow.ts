import { AnalyticsEvent } from '../shared/types.js';

/**
 * Represents one row in the ClickHouse `analytics_events` table.
 *
 * Column mapping follows the table DDL shape defined in the analytics
 * consumer design. The confidence column is Float64 (non-nullable) per
 * docs/analytics-consumer.md §4 DDL. When the event has no confidence
 * value, we insert -1.0 as the sentinel (W-01 fix).
 */
export interface ClickHouseRow {
  event_id: string;
  event_type: string;
  timestamp: string;
  skill_id: string;       // "" when null
  intent: string;         // "" when null
  latency_ms: number;
  confidence: number;     // Float64 — -1.0 sentinel when absent (spec DDL §4)
  cache_hit: number;      // ClickHouse UInt8: 0 or 1
  input_hash: string;     // "" when null
  success: number;        // ClickHouse UInt8: 0 or 1
}

/**
 * The sentinel value written to ClickHouse when `confidence` is absent.
 * Matches the Float64 column DDL in docs/analytics-consumer.md §4:
 * "confidence Float64 -- -1.0 when field is null"
 */
export const CONFIDENCE_NULL_SENTINEL = -1.0;

/**
 * Converts a validated AnalyticsEvent and its derived event_id into a
 * ClickHouseRow ready for insertion.
 *
 * Booleans are mapped to UInt8 (0/1) because ClickHouse's Bool type is an
 * alias for UInt8 and the JS client serialises them as numbers by default.
 *
 * W-01 fix: confidence null → -1.0 (Float64 sentinel) to match the
 * non-nullable Float64 column declared in the ClickHouse DDL.
 */
export function toClickHouseRow(
  event: AnalyticsEvent,
  eventId: string,
): ClickHouseRow {
  return {
    event_id: eventId,
    event_type: event.event_type,
    timestamp: event.timestamp,
    skill_id: event.skill_id ?? "",
    intent: event.intent ?? "",
    latency_ms: event.latency_ms,
    confidence: event.confidence ?? CONFIDENCE_NULL_SENTINEL,
    cache_hit: event.cache_hit ? 1 : 0,
    input_hash: event.input_hash ?? "",
    success: event.success ? 1 : 0,
  };
}
