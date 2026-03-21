/**
 * POST /events Lambda handler.
 *
 * Accepts a batch of 1-100 analytics events, server-assigns timestamps,
 * validates all events with Zod, sends to Kinesis via PutRecords,
 * and returns 202 Accepted with count and Kinesis sequence number.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  KinesisClient,
  PutRecordsCommand,
  type PutRecordsRequestEntry,
} from "@aws-sdk/client-kinesis";
import { z } from "zod";
import { EventTypeSchema } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { validate } from "../shared/validation.js";

const kinesisClient = new KinesisClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

const EVENTS_STREAM = process.env.EVENTS_STREAM ?? "codevolve-events";

/**
 * Request schema matching docs/api.md POST /events contract.
 * Clients do NOT supply timestamps — they are server-assigned.
 */
export const EmitEventsRequestSchema = z.object({
  events: z
    .array(
      z.object({
        event_type: EventTypeSchema,
        skill_id: z.string().uuid().nullable().default(null),
        intent: z.string().max(1024).nullable().default(null),
        latency_ms: z.number().nonnegative(),
        confidence: z.number().min(0).max(1).nullable().default(null),
        cache_hit: z.boolean().default(false),
        input_hash: z.string().max(128).nullable().default(null),
        success: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
});

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  // Parse request body
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  // Validate request
  const validation = validate(EmitEventsRequestSchema, body);
  if (!validation.success) {
    const { code, message, details } = validation.error;
    return error(400, code, message, details);
  }

  const { events: clientEvents } = validation.data;
  const now = new Date().toISOString();

  // Build Kinesis records with server-assigned timestamps
  const records: PutRecordsRequestEntry[] = clientEvents.map((evt) => {
    const fullEvent = {
      ...evt,
      timestamp: now,
    };
    const partitionKey = evt.skill_id ?? evt.event_type;
    return {
      PartitionKey: partitionKey,
      Data: Buffer.from(JSON.stringify(fullEvent)),
    };
  });

  try {
    const result = await kinesisClient.send(
      new PutRecordsCommand({
        StreamName: EVENTS_STREAM,
        Records: records,
      }),
    );

    // Extract a sequence number from the first successful record
    const sequenceNumber =
      result.Records?.find((r) => r.SequenceNumber)?.SequenceNumber ?? "none";

    return success(202, {
      accepted: clientEvents.length,
      kinesis_sequence_number: sequenceNumber,
    });
  } catch (err) {
    console.error("[POST /events] Kinesis PutRecords failed:", err);
    return error(500, "INTERNAL_ERROR", "Failed to write events to stream");
  }
}
