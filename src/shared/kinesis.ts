/**
 * Kinesis client singleton and helper for emitting analytics events.
 *
 * All analytics events flow through Kinesis to the analytics store
 * (ClickHouse / BigQuery). They never touch DynamoDB (ADR-002).
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
 * Partition key is `skill_id` when available (keeps all events for a
 * skill on the same shard for ordering), otherwise falls back to
 * `event_type`.
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
