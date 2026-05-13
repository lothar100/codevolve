/**
 * Analytics consumer Lambda handler.
 *
 * Reads AnalyticsEvent records from the codevolve-events Kinesis stream and
 * projects them into DynamoDB materialized analytics tables.
 *
 * Phase 1 parses and validates each Kinesis record. Phase 2 projects each
 * valid event behind an event-id dedup guard, so replayed records become
 * successful no-ops instead of duplicate analytics writes.
 */

import type {
  KinesisStreamBatchResponse,
  KinesisStreamEvent,
} from "aws-lambda";
import type { AnalyticsEvent } from "../shared/types.js";
import { AnalyticsEventSchema } from "../shared/validation.js";
import { projectAnalyticsEvent } from "./materializedAnalytics.js";

/**
 * Kinesis stream handler. Returns a KinesisStreamBatchResponse so that
 * partial failures are reported back to Kinesis for bisect-on-failure retry.
 */
export async function handler(
  event: KinesisStreamEvent,
): Promise<KinesisStreamBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  const validEvents: Array<{ sequenceNumber: string; event: AnalyticsEvent }> = [];

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

    validEvents.push({
      sequenceNumber,
      event: validation.data as AnalyticsEvent,
    });
  }

  for (const candidate of validEvents) {
    try {
      const result = await projectAnalyticsEvent(candidate.event);
      if (result.duplicate) {
        console.warn(
          `[consumer] Skipping duplicate analytics event ${result.eventId} (seq ${candidate.sequenceNumber})`,
        );
      }
    } catch (err) {
      console.error(
        `[consumer] Failed to project analytics event for Kinesis record ${candidate.sequenceNumber}:`,
        err,
      );
      batchItemFailures.push({ itemIdentifier: candidate.sequenceNumber });
    }
  }

  return { batchItemFailures };
}
