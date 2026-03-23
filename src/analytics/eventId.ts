import { createHash } from 'crypto';
import { AnalyticsEvent } from '../shared/types.js';

/**
 * Derives a stable, deterministic event_id from the event's content.
 * Used as the ReplacingMergeTree deduplication key in ClickHouse.
 *
 * Formula (per docs/analytics-consumer.md §5.2):
 *   SHA-256(skill_id + "|" + event_type + "|" + timestamp + "|" + (input_hash ?? "null"))
 */
export function deriveEventId(event: AnalyticsEvent): string {
  const raw = [
    event.skill_id ?? 'null',
    event.event_type,
    event.timestamp,
    event.input_hash ?? 'null',
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}
