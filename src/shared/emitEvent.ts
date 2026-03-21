/**
 * Robust, fire-and-forget event emission to Kinesis.
 *
 * This module is imported by ALL Lambda handlers (registry, router, execution,
 * validation, etc.). It must NEVER throw — a Kinesis outage must not break
 * /resolve, /execute, or any other endpoint.
 *
 * Events are validated against the AnalyticsEvent Zod schema before sending.
 * Invalid events are silently dropped with a warning log.
 */

import {
  KinesisClient,
  PutRecordCommand,
  PutRecordsCommand,
  type PutRecordsRequestEntry,
} from "@aws-sdk/client-kinesis";
import type { AnalyticsEvent } from "./types.js";
import { AnalyticsEventSchema } from "./validation.js";

const kinesisClient = new KinesisClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

export const EVENTS_STREAM =
  process.env.EVENTS_STREAM ?? "codevolve-events";

/**
 * Derive partition key: skill_id if present, otherwise event_type.
 * Keeps all events for a skill on the same shard for ordering.
 */
function partitionKey(event: AnalyticsEvent): string {
  return event.skill_id ?? event.event_type;
}

/**
 * Emit a single analytics event to Kinesis.
 *
 * - Adds a server-assigned ISO-8601 timestamp.
 * - Validates against Zod schema; drops invalid events with a warning.
 * - Fire-and-forget: never throws. Errors are logged to CloudWatch.
 */
export async function emitEvent(
  event: Omit<AnalyticsEvent, "timestamp">,
): Promise<void> {
  try {
    const fullEvent: AnalyticsEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    const parseResult = AnalyticsEventSchema.safeParse(fullEvent);
    if (!parseResult.success) {
      console.warn(
        "[emitEvent] Dropping invalid event:",
        JSON.stringify(parseResult.error.issues),
        "Event:",
        JSON.stringify(event),
      );
      return;
    }

    await kinesisClient.send(
      new PutRecordCommand({
        StreamName: EVENTS_STREAM,
        PartitionKey: partitionKey(fullEvent),
        Data: Buffer.from(JSON.stringify(fullEvent)),
      }),
    );
  } catch (err) {
    console.error("[emitEvent] Failed to emit event (swallowed):", err);
  }
}

/**
 * Emit a batch of analytics events to Kinesis via PutRecords.
 *
 * - Adds server-assigned timestamps.
 * - Validates each event; invalid events are dropped with warnings.
 * - Fire-and-forget: never throws. Errors are logged to CloudWatch.
 * - Kinesis PutRecords limit is 500 records; this function handles
 *   batches up to that limit (callers should keep batches <= 100 per API contract).
 */
export async function emitEvents(
  events: Omit<AnalyticsEvent, "timestamp">[],
): Promise<void> {
  try {
    const now = new Date().toISOString();

    const records: PutRecordsRequestEntry[] = [];
    for (const event of events) {
      const fullEvent: AnalyticsEvent = {
        ...event,
        timestamp: now,
      };

      const parseResult = AnalyticsEventSchema.safeParse(fullEvent);
      if (!parseResult.success) {
        console.warn(
          "[emitEvents] Dropping invalid event:",
          JSON.stringify(parseResult.error.issues),
          "Event:",
          JSON.stringify(event),
        );
        continue;
      }

      records.push({
        PartitionKey: partitionKey(fullEvent),
        Data: Buffer.from(JSON.stringify(fullEvent)),
      });
    }

    if (records.length === 0) {
      return;
    }

    await kinesisClient.send(
      new PutRecordsCommand({
        StreamName: EVENTS_STREAM,
        Records: records,
      }),
    );
  } catch (err) {
    console.error("[emitEvents] Failed to emit events (swallowed):", err);
  }
}

export { kinesisClient };
