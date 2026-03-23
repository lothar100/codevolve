import { AnalyticsEvent } from '../shared/types.js';

/**
 * Represents one row in the ClickHouse `analytics_events` table.
 *
 * Column mapping follows the table DDL shape defined in the analytics
 * consumer design. All optional columns default to null so that
 * INSERT payloads are complete and type-safe.
 */
export interface ClickHouseRow {
  event_id: string;
  event_type: string;
  timestamp: string;
  skill_id: string;       // "" when null
  intent: string;         // "" when null
  latency_ms: number;
  confidence: number | null; // Nullable(Float64) — stays null when absent
  cache_hit: number;      // ClickHouse UInt8: 0 or 1
  input_hash: string;     // "" when null
  success: number;        // ClickHouse UInt8: 0 or 1
}

/**
 * Converts a validated AnalyticsEvent and its derived event_id into a
 * ClickHouseRow ready for insertion.
 *
 * Booleans are mapped to UInt8 (0/1) because ClickHouse's Bool type is an
 * alias for UInt8 and the JS client serialises them as numbers by default.
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
    confidence: event.confidence ?? null,
    cache_hit: event.cache_hit ? 1 : 0,
    input_hash: event.input_hash ?? "",
    success: event.success ? 1 : 0,
  };
}
