import { createHash } from "crypto";

/**
 * Deterministic event ID generation for analytics event idempotency.
 *
 * The Kinesis analytics projector uses this ID to detect and deduplicate
 * replayed events. Idempotency is required because Kinesis guarantees
 * at-least-once delivery.
 */

export const NULL_FIELD_SENTINEL = "null";

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
