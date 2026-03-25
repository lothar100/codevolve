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
 *   Phase 2 — Dedup + Insert:
 *     §5.3 two-layer dedup strategy:
 *       Layer 1 (hot-path): pre-insert SELECT checks for existing event_ids.
 *         Filters out rows whose event_id already exists in ClickHouse.
 *         Handles the hot-path retry window before ReplacingMergeTree compacts.
 *       Layer 2 (eventual): ReplacingMergeTree background compaction.
 *         Collapses any duplicates that slip through the pre-insert check
 *         (e.g. concurrent inserts).
 *     Bulk INSERT the deduplicated rows into ClickHouse.
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
import { computeEventId as deriveEventId } from "./eventId.js";
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

    const ev = validation.data;
    const eventId = deriveEventId(ev.event_type, ev.timestamp, ev.skill_id ?? null, ev.intent ?? null, ev.input_hash ?? null);
    rows.push(toClickHouseRow(ev, eventId));
    rowSequenceNumbers.push(sequenceNumber);
  }

  // -------------------------------------------------------------------------
  // Phase 2 — Dedup check + batch insert to ClickHouse
  // -------------------------------------------------------------------------

  if (rows.length === 0) {
    // Nothing to insert — return parse failures only.
    return { batchItemFailures };
  }

  try {
    const client = getClickHouseClient();

    // W-02 fix: Layer 1 dedup — pre-insert SELECT to filter rows whose
    // event_id already exists in ClickHouse (spec §5.3 hot-path check).
    // This eliminates duplicates during high-retry windows before
    // ReplacingMergeTree background compaction has a chance to run.
    const eventIds = rows.map((r) => r.event_id);
    const escapedIds = eventIds.map((id) => `'${id}'`).join(", ");
    const existingResultSet = await client.query({
      query: `SELECT event_id FROM analytics_events WHERE event_id IN (${escapedIds})`,
      format: "JSONEachRow",
    });
    const existingRows = await existingResultSet.json<{ event_id: string }>();
    const existingIdSet = new Set(existingRows.map((r) => r.event_id));

    // Filter out rows whose event_id is already present.
    const newRows: ReturnType<typeof toClickHouseRow>[] = [];
    const newRowSequenceNumbers: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (!existingIdSet.has(rows[i].event_id)) {
        newRows.push(rows[i]);
        newRowSequenceNumbers.push(rowSequenceNumbers[i]);
      } else {
        // Already present — this is a successful dedup, not a failure.
        // Do not add to batchItemFailures; Kinesis will not retry these.
        console.warn(
          `[consumer] Skipping duplicate event_id ${rows[i].event_id} (seq ${rowSequenceNumbers[i]})`,
        );
      }
    }

    if (newRows.length === 0) {
      // All rows were duplicates — nothing to insert.
      return { batchItemFailures };
    }

    await client.insert({
      table: "analytics_events",
      values: newRows,
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
