/**
 * Analytics consumer Lambda handler.
 *
 * Reads AnalyticsEvent records from the codevolve-events Kinesis stream and
 * writes them in batches to the ClickHouse analytics_events table.
 *
 * Two-phase processing (per docs/analytics-consumer.md §6.1):
 *
 *   Phase 1 — Parse: decode and validate each Kinesis record.
 *     Parse failures are collected immediately as batchItemFailures.
 *     Successfully parsed records accumulate into a rows[] array.
 *
 *   Phase 2 — Insert: bulk INSERT all rows into ClickHouse.
 *     On success, return only the Phase 1 failures.
 *     On failure, mark all rows as failed and combine with Phase 1 failures.
 */

import type {
  KinesisStreamEvent,
  KinesisStreamBatchResponse,
} from "aws-lambda";
import { ClickHouseError } from "@clickhouse/client";
import { AnalyticsEventSchema } from "../shared/validation.js";
import { getClickHouseClient } from "./clickhouseClient.js";
import { deriveEventId } from "./eventId.js";
import { toClickHouseRow } from "./toClickHouseRow.js";

/**
 * Kinesis stream handler. Returns a KinesisStreamBatchResponse so that
 * partial failures are reported back to Kinesis for bisect-on-failure retry.
 */
export async function handler(
  event: KinesisStreamEvent,
): Promise<KinesisStreamBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  const rows: ReturnType<typeof toClickHouseRow>[] = [];
  // Track which sequence numbers correspond to which rows (for insert failure).
  const rowSequenceNumbers: string[] = [];

  // -------------------------------------------------------------------------
  // Phase 1 — Parse each Kinesis record
  // -------------------------------------------------------------------------

  for (const record of event.Records) {
    const sequenceNumber = record.kinesis.sequenceNumber;

    let parsed: unknown;
    try {
      const decoded = Buffer.from(record.kinesis.data, "base64").toString(
        "utf-8",
      );
      parsed = JSON.parse(decoded);
    } catch (err) {
      console.error(
        `[consumer] Failed to JSON-parse Kinesis record ${sequenceNumber}:`,
        err,
      );
      batchItemFailures.push({ itemIdentifier: sequenceNumber });
      continue;
    }

    const validation = AnalyticsEventSchema.safeParse(parsed);
    if (!validation.success) {
      const rawPreview = JSON.stringify(parsed).slice(0, 500);
      console.error(
        `[consumer] Kinesis record ${sequenceNumber} failed Zod validation:`,
        validation.error.flatten(),
        `raw (truncated): ${rawPreview}`,
      );
      batchItemFailures.push({ itemIdentifier: sequenceNumber });
      continue;
    }

    const eventId = deriveEventId(validation.data);
    rows.push(toClickHouseRow(validation.data, eventId));
    rowSequenceNumbers.push(sequenceNumber);
  }

  // -------------------------------------------------------------------------
  // Phase 2 — Batch insert to ClickHouse
  // -------------------------------------------------------------------------

  if (rows.length === 0) {
    // Nothing to insert — return parse failures only.
    return { batchItemFailures };
  }

  try {
    const client = await getClickHouseClient();
    await client.insert({
      table: "analytics_events",
      values: rows,
      format: "JSONEachRow",
    });

    // All rows inserted successfully — return only Phase 1 parse failures.
    return { batchItemFailures };
  } catch (err) {
    const isPermanent = err instanceof ClickHouseError;

    if (isPermanent) {
      // HTTP 400 / schema mismatch — ClickHouse actively rejected the data.
      const sample = rows.slice(0, 3);
      console.error(
        `[consumer] Permanent ClickHouse insert error (schema mismatch or bad request). ` +
          `Batch size: ${rows.length}. First 3 rows sample:`,
        JSON.stringify(sample),
        `Error:`,
        err,
      );
    } else {
      // Transient error (network, ClickHouse unavailable, timeout).
      console.error(
        `[consumer] Transient ClickHouse insert error. ` +
          `Batch size: ${rows.length}. Will retry via Kinesis.`,
        err,
      );
    }

    // Mark all successfully-parsed rows as failed so Kinesis retries them.
    for (const seqNum of rowSequenceNumbers) {
      batchItemFailures.push({ itemIdentifier: seqNum });
    }

    return { batchItemFailures };
  }
}
