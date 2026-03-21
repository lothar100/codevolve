/**
 * Low-level Kinesis client singleton and raw emit helper.
 *
 * WARNING: This module throws on Kinesis errors. It is intended as an
 * internal building block only. Lambda handlers and application code
 * must NOT import from this module directly — use `emitEvent` /
 * `emitEvents` from `./emitEvent.ts` instead, which wraps all calls in
 * fire-and-forget error handling so that a Kinesis outage never crashes
 * a handler.
 *
 * All analytics events flow through Kinesis to the analytics store
 * (ClickHouse / BigQuery). They never touch DynamoDB (ADR-002).
 *
 * @internal
 */

import { KinesisClient, PutRecordCommand } from "@aws-sdk/client-kinesis";
import type { AnalyticsEvent } from "./types.js";

const kinesisClient = new KinesisClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

export const EVENTS_STREAM =
  process.env.EVENTS_STREAM ?? "codevolve-events";

/**
 * Emit a single analytics event to the Kinesis stream.
 *
 * WARNING: This function THROWS on failure. Do not call from handler
 * code — use the fire-and-forget wrapper in `./emitEvent.ts` instead.
 *
 * Partition key is `skill_id` when available (keeps all events for a
 * skill on the same shard for ordering), otherwise falls back to
 * `event_type`.
 *
 * @internal
 */
export async function emitEvent(event: AnalyticsEvent): Promise<void> {
  const partitionKey = event.skill_id ?? event.event_type;

  await kinesisClient.send(
    new PutRecordCommand({
      StreamName: EVENTS_STREAM,
      PartitionKey: partitionKey,
      Data: Buffer.from(JSON.stringify(event)),
    }),
  );
}

export { kinesisClient };
