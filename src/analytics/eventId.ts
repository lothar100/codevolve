/**
 * Deterministic event ID generation for analytics event idempotency.
 *
 * The Kinesis → ClickHouse consumer uses this ID to detect and deduplicate
 * replayed events. Idempotency is required because Kinesis guarantees
 * at-least-once delivery.
 *
 * ## Null field sentinel: "null" (the string literal)
 *
 * When an AnalyticsEvent field is null (skill_id, intent, confidence,
 * input_hash), we substitute the string literal "null" — not an empty
 * string "" — before hashing.
 *
 * Rationale:
 *   - An empty string "" is a valid non-null value for `intent` (an agent
 *     may submit an empty intent string). Using "" as the sentinel would
 *     collapse null and empty-string into the same hash bucket, breaking
 *     deduplication correctness.
 *   - The string "null" is unambiguous: it cannot be confused with a valid
 *     UUID (skill_id), a valid intent string (would be rejected by zod min
 *     validation), or a valid input_hash (hex string).
 *   - This sentinel is intentional and must NOT be changed to "" without
 *     a coordinated migration of all downstream hash comparisons and the
 *     ClickHouse dedup column.
 *
 * This file is the single source of truth for the sentinel value.
 * docs/analytics-consumer.md §5.2 documents this same choice.
 */

import { createHash } from "crypto";

/**
 * The sentinel string used in place of null fields when computing the event ID.
 * Using the string "null" (not empty string "") to avoid collisions with valid
 * empty-string intent values.
 */
export const NULL_FIELD_SENTINEL = "null";

/**
 * Compute a deterministic, deduplication-safe ID for an analytics event.
 *
 * The ID is a SHA-256 hex digest of the canonical concatenation:
 *   `{event_type}|{timestamp}|{skill_id}|{intent}|{input_hash}`
 *
 * Null fields are replaced with the NULL_FIELD_SENTINEL ("null") before
 * concatenation.
 *
 * @param event_type  - e.g. "resolve", "execute", "validate", "fail"
 * @param timestamp   - ISO8601 string, server-assigned
 * @param skill_id    - UUID string or null
 * @param intent      - intent string or null
 * @param input_hash  - SHA-256 hex digest of inputs or null
 * @returns           - 64-character hex SHA-256 digest
 */
export function computeEventId(
  event_type: string,
  timestamp: string,
  skill_id: string | null,
  intent: string | null,
  input_hash: string | null,
): string {
  const parts = [
    event_type,
    timestamp,
    skill_id ?? NULL_FIELD_SENTINEL,
    intent ?? NULL_FIELD_SENTINEL,
    input_hash ?? NULL_FIELD_SENTINEL,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
