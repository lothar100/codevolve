/**
 * Rule 3: Gap Detection → GapQueue
 *
 * Scans codevolve-gap-log for unresolved resolve attempts that have been seen
 * in the last 24 hours and have not been queued to /evolve in the last 24 hours.
 * Sends up to 10 eligible gaps to codevolve-gap-queue.fifo, ordered by
 * min_confidence ASC (most urgent first). After each successful SQS send,
 * updates last_evolve_queued_at on the gap-log record.
 *
 * Per docs/decision-engine.md §4.3.
 */

import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSClient } from "@aws-sdk/client-sqs";

// ---------------------------------------------------------------------------
// Gap-log item shape (codevolve-gap-log)
// ---------------------------------------------------------------------------

interface GapLogItem {
  intent_hash: string;
  intent: string;
  first_seen_at: string;
  last_seen_at: string;
  miss_count: number;
  min_confidence: number;
  last_evolve_queued_at?: string;
  ttl?: number;
}

// ---------------------------------------------------------------------------
// SQS message body shape (codevolve-gap-queue.fifo)
// ---------------------------------------------------------------------------

interface GapQueueMessage {
  intent: string;
  resolve_confidence: number;
  timestamp: string;
  original_event_id: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAP_DETECTION_LIMIT = 10;

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

export async function evaluateGapDetection(
  dynamoClient: DynamoDBDocumentClient,
  sqsClient: SQSClient,
): Promise<void> {
  const gapLogTable = process.env.GAP_LOG_TABLE ?? "codevolve-gap-log";
  const gapQueueUrl = process.env.GAP_QUEUE_URL ?? "";

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const cutoffIso = twentyFourHoursAgo.toISOString();

  // -------------------------------------------------------------------------
  // 1. Scan gap-log for eligible items
  //
  //    Filter:
  //      last_seen_at >= cutoff (seen within 24h)
  //      AND (last_evolve_queued_at does not exist OR last_evolve_queued_at < cutoff)
  //
  //    Limit: 10 — hard cap at query level per spec §4.3.2
  // -------------------------------------------------------------------------

  const scanResult = await dynamoClient.send(
    new ScanCommand({
      TableName: gapLogTable,
      FilterExpression:
        "#last_seen_at >= :cutoff AND " +
        "(attribute_not_exists(#last_evolve_queued_at) OR #last_evolve_queued_at < :cutoff)",
      ExpressionAttributeNames: {
        "#last_seen_at": "last_seen_at",
        "#last_evolve_queued_at": "last_evolve_queued_at",
      },
      ExpressionAttributeValues: {
        ":cutoff": cutoffIso,
      },
      Limit: GAP_DETECTION_LIMIT,
    }),
  );

  const items = (scanResult.Items ?? []) as GapLogItem[];

  if (items.length === 0) {
    console.log("[gapDetection] No eligible gaps found");
    return;
  }

  // -------------------------------------------------------------------------
  // 2. Sort client-side by min_confidence ASC (lowest = most urgent)
  // -------------------------------------------------------------------------

  const sorted = [...items].sort((a, b) => a.min_confidence - b.min_confidence);

  // -------------------------------------------------------------------------
  // 3. Process each item: send SQS → update DynamoDB
  // -------------------------------------------------------------------------

  const nowIso = now.toISOString();
  // YYYYMMDD for MessageDeduplicationId (e.g. 20260322)
  const dateStamp = nowIso.slice(0, 10).replace(/-/g, "");

  for (const item of sorted) {
    const messageBody: GapQueueMessage = {
      intent: item.intent,
      resolve_confidence: item.min_confidence,
      timestamp: item.last_seen_at,
      original_event_id: item.intent_hash,
    };

    // Send SQS message
    let sqsSent = false;
    try {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: gapQueueUrl,
          MessageBody: JSON.stringify(messageBody),
          MessageGroupId: "gap",
          MessageDeduplicationId: `${item.intent_hash}_${dateStamp}`,
        }),
      );
      sqsSent = true;
    } catch (err) {
      console.error(
        `[gapDetection] Failed to send SQS message for intent_hash=${item.intent_hash}:`,
        err,
      );
      // Do NOT update last_evolve_queued_at — next run will retry this item
      continue;
    }

    if (!sqsSent) {
      continue;
    }

    // Update gap-log: set last_evolve_queued_at
    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: gapLogTable,
          Key: { intent_hash: item.intent_hash },
          UpdateExpression: "SET #last_evolve_queued_at = :now",
          ExpressionAttributeNames: {
            "#last_evolve_queued_at": "last_evolve_queued_at",
          },
          ExpressionAttributeValues: {
            ":now": nowIso,
          },
        }),
      );
    } catch (err) {
      // Log but do not fail — the SQS message was already sent. The item may be
      // re-queued on the next run, but FIFO deduplication (same-day MessageDeduplicationId)
      // will prevent the /evolve consumer from seeing a duplicate today.
      console.error(
        `[gapDetection] Failed to update last_evolve_queued_at for intent_hash=${item.intent_hash}:`,
        err,
      );
    }
  }

  console.log(
    `[gapDetection] Processed ${sorted.length} gap(s) out of ${items.length} eligible`,
  );
}
