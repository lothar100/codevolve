/**
 * Unit tests for the analytics consumer handler (IMPL-08-D).
 *
 * Tests cover both Phase 1 (Kinesis record parsing) and Phase 2 (ClickHouse
 * batch insert), including partial failure propagation and transient vs
 * permanent error classification.
 *
 * W-02 fix tests: pre-insert dedup SELECT is called before INSERT, and
 * duplicate event_ids are silently skipped rather than re-inserted.
 *
 * The ClickHouse client singleton is injected via _setClickHouseClientForTesting
 * to avoid any real network calls.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { KinesisStreamEvent, KinesisStreamRecord } from "aws-lambda";
import { ClickHouseError } from "@clickhouse/client";
import { handler } from "../../../src/analytics/consumer";
import { _setClickHouseClientForTesting } from "../../../src/analytics/clickhouseClient";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_SKILL_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const validAnalyticsEvent = {
  event_type: "execute",
  timestamp: "2026-03-21T04:05:00.123Z",
  skill_id: VALID_SKILL_ID,
  intent: null,
  latency_ms: 42,
  confidence: 0.95,
  cache_hit: false,
  input_hash: "abc123",
  success: true,
};

/**
 * Build a minimal KinesisStreamRecord with the given data payload.
 * The data field is base64-encoded JSON.
 */
function makeRecord(
  data: unknown,
  sequenceNumber: string,
): KinesisStreamRecord {
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64");
  return {
    kinesis: {
      kinesisSchemaVersion: "1.0",
      partitionKey: "test",
      sequenceNumber,
      data: encoded,
      approximateArrivalTimestamp: Date.now() / 1000,
    },
    eventSource: "aws:kinesis",
    eventVersion: "1.0",
    eventID: `shardId-000000000000:${sequenceNumber}`,
    eventName: "aws:kinesis:record",
    invokeIdentityArn: "arn:aws:iam::123456789012:role/test",
    awsRegion: "us-east-2",
    eventSourceARN:
      "arn:aws:kinesis:us-east-2:123456789012:stream/codevolve-events",
  };
}

/**
 * Build a KinesisStreamRecord whose data is raw (not valid JSON).
 */
function makeRawRecord(
  rawData: string,
  sequenceNumber: string,
): KinesisStreamRecord {
  const encoded = Buffer.from(rawData).toString("base64");
  return {
    kinesis: {
      kinesisSchemaVersion: "1.0",
      partitionKey: "test",
      sequenceNumber,
      data: encoded,
      approximateArrivalTimestamp: Date.now() / 1000,
    },
    eventSource: "aws:kinesis",
    eventVersion: "1.0",
    eventID: `shardId-000000000000:${sequenceNumber}`,
    eventName: "aws:kinesis:record",
    invokeIdentityArn: "arn:aws:iam::123456789012:role/test",
    awsRegion: "us-east-2",
    eventSourceARN:
      "arn:aws:kinesis:us-east-2:123456789012:stream/codevolve-events",
  };
}

function makeEvent(records: KinesisStreamRecord[]): KinesisStreamEvent {
  return { Records: records };
}

// ---------------------------------------------------------------------------
// Helpers to build mock ClickHouse clients
// ---------------------------------------------------------------------------

/**
 * Build a mock ClickHouse client.
 * - query: used by the pre-insert dedup SELECT (W-02). Defaults to returning
 *   an empty result (no duplicates found).
 * - insert: used by the batch INSERT. Defaults to resolving successfully.
 */
function makeMockClient(overrides: {
  query?: jest.Mock;
  insert?: jest.Mock;
} = {}): any {
  return {
    query: overrides.query ?? jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue([]), // no existing event_ids by default
    }),
    insert: overrides.insert ?? jest.fn().mockResolvedValue({}),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // Reset the ClickHouse client singleton between tests to avoid pollution.
  _setClickHouseClientForTesting(null);
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analytics consumer handler", () => {
  // Test 1: Valid records + successful insert → batchItemFailures is empty
  it("returns empty batchItemFailures when all records are valid and insert succeeds", async () => {
    const mockInsert = jest.fn().mockResolvedValue({});
    _setClickHouseClientForTesting(makeMockClient({ insert: mockInsert }));

    const event = makeEvent([
      makeRecord(validAnalyticsEvent, "seq-001"),
      makeRecord(
        { ...validAnalyticsEvent, event_type: "resolve", skill_id: null },
        "seq-002",
      ),
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.table).toBe("analytics_events");
    expect(insertCall.format).toBe("JSONEachRow");
    expect(insertCall.values).toHaveLength(2);
  });

  // Test 2: Valid records + one parsing failure + successful insert →
  //         batchItemFailures contains only the parsing failure
  it("includes only parse failures in batchItemFailures when insert succeeds", async () => {
    const mockInsert = jest.fn().mockResolvedValue({});
    _setClickHouseClientForTesting(makeMockClient({ insert: mockInsert }));

    const event = makeEvent([
      makeRecord(validAnalyticsEvent, "seq-001"),
      makeRawRecord("not valid json{{", "seq-002"), // parse failure
      makeRecord(
        { ...validAnalyticsEvent, event_type: "validate" },
        "seq-003",
      ),
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe("seq-002");
    // Insert should still be called with the 2 valid rows.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].values).toHaveLength(2);
  });

  // Test 3: All records fail to parse → insert not called, returns parse failures
  it("does not call insert and returns all parse failures when no rows parsed", async () => {
    const mockInsert = jest.fn();
    _setClickHouseClientForTesting(makeMockClient({ insert: mockInsert }));

    const event = makeEvent([
      makeRawRecord("{bad json", "seq-001"),
      makeRecord({ not_an_analytics_event: true }, "seq-002"), // Zod validation failure
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(2);
    expect(result.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(
      expect.arrayContaining(["seq-001", "seq-002"]),
    );
    // insert must NOT be called
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // Test 4: Insert throws a transient error → all valid rows in batchItemFailures
  it("adds all valid rows to batchItemFailures on transient insert error", async () => {
    const transientError = new Error("Connection refused");
    const mockInsert = jest.fn().mockRejectedValue(transientError);
    _setClickHouseClientForTesting(makeMockClient({ insert: mockInsert }));

    const event = makeEvent([
      makeRecord(validAnalyticsEvent, "seq-001"),
      makeRecord({ ...validAnalyticsEvent, event_type: "resolve" }, "seq-002"),
    ]);

    const result = await handler(event);

    // Both valid rows must be in batchItemFailures
    expect(result.batchItemFailures).toHaveLength(2);
    expect(result.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(
      expect.arrayContaining(["seq-001", "seq-002"]),
    );
  });

  // Test 5: Insert throws a permanent error (ClickHouseError) →
  //         all valid rows in batchItemFailures, error logged at ERROR level
  it("adds all valid rows to batchItemFailures and logs ERROR on permanent insert error", async () => {
    const permanentError = new ClickHouseError({
      message: "Cannot parse input: expected comma or end of string",
      code: "27",
      type: "CANNOT_PARSE_INPUT_EXCEPTION",
    });
    const mockInsert = jest.fn().mockRejectedValue(permanentError);
    _setClickHouseClientForTesting(makeMockClient({ insert: mockInsert }));

    const event = makeEvent([
      makeRecord(validAnalyticsEvent, "seq-001"),
      makeRecord({ ...validAnalyticsEvent, event_type: "fail" }, "seq-002"),
    ]);

    const result = await handler(event);

    // Both rows must be in batchItemFailures
    expect(result.batchItemFailures).toHaveLength(2);
    expect(result.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(
      expect.arrayContaining(["seq-001", "seq-002"]),
    );

    // console.error must have been called (permanent error path logs at ERROR)
    expect(console.error).toHaveBeenCalled();
    const errorArgs = (console.error as jest.Mock).mock.calls;
    const permanentLogCall = errorArgs.find((args) =>
      String(args[0]).includes("Permanent ClickHouse insert error"),
    );
    expect(permanentLogCall).toBeDefined();
  });

  // Test 6: Zero records → returns { batchItemFailures: [] }
  it("returns empty batchItemFailures for a batch with zero records", async () => {
    // No client needed — no records means no insert attempt.
    const mockInsert = jest.fn();
    _setClickHouseClientForTesting(makeMockClient({ insert: mockInsert }));

    const event = makeEvent([]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // Additional: Zod validation failure (valid JSON, wrong shape)
  it("adds Zod-invalid records to batchItemFailures without crashing", async () => {
    const mockInsert = jest.fn().mockResolvedValue({});
    _setClickHouseClientForTesting(makeMockClient({ insert: mockInsert }));

    const zodFailure = {
      event_type: "not_a_valid_type", // not in EventTypeSchema
      timestamp: "2026-03-21T04:05:00.123Z",
      skill_id: null,
      intent: null,
      latency_ms: 10,
      confidence: null,
      cache_hit: false,
      input_hash: null,
      success: true,
    };

    const event = makeEvent([
      makeRecord(validAnalyticsEvent, "seq-001"),
      makeRecord(zodFailure, "seq-002"),
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe("seq-002");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].values).toHaveLength(1);
  });

  // Additional: Mixed parse failures + insert transient error → all in batchItemFailures
  it("combines parse failures and row failures when insert throws transiently", async () => {
    const transientError = new Error("ClickHouse timeout");
    const mockInsert = jest.fn().mockRejectedValue(transientError);
    _setClickHouseClientForTesting(makeMockClient({ insert: mockInsert }));

    const event = makeEvent([
      makeRawRecord("not json", "seq-001"), // parse failure
      makeRecord(validAnalyticsEvent, "seq-002"), // valid, but insert fails
    ]);

    const result = await handler(event);

    // Both seq-001 (parse) and seq-002 (insert transient) must be in failures
    expect(result.batchItemFailures).toHaveLength(2);
    expect(result.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(
      expect.arrayContaining(["seq-001", "seq-002"]),
    );
  });

  // W-02 fix: pre-insert dedup SELECT is called before INSERT
  it("calls query (dedup SELECT) before insert (W-02)", async () => {
    const mockQuery = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue([]), // no duplicates
    });
    const mockInsert = jest.fn().mockResolvedValue({});
    _setClickHouseClientForTesting(makeMockClient({ query: mockQuery, insert: mockInsert }));

    const event = makeEvent([
      makeRecord(validAnalyticsEvent, "seq-001"),
    ]);

    await handler(event);

    // query (dedup SELECT) must be called before insert
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const queryCall = mockQuery.mock.calls[0][0];
    expect(queryCall.query).toContain("SELECT event_id FROM analytics_events");
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  // W-02 fix: duplicate event_ids are skipped (not re-inserted)
  it("skips rows whose event_id already exists in ClickHouse (W-02 dedup)", async () => {
    // We need to know the event_id that would be computed for validAnalyticsEvent.
    // Rather than computing it here, we mock query to return an event_id that
    // matches whatever the handler computes for our record — by capturing
    // the query call and returning a matching response.
    const mockInsert = jest.fn().mockResolvedValue({});

    let capturedEventId: string | null = null;
    const mockQuery = jest.fn().mockImplementation(async (params: { query: string }) => {
      // Extract the event_id from the IN clause on the first call
      const match = params.query.match(/'([a-f0-9]{64})'/);
      if (match) {
        capturedEventId = match[1];
      }
      return {
        json: jest.fn().mockResolvedValue(
          capturedEventId ? [{ event_id: capturedEventId }] : [],
        ),
      };
    });

    _setClickHouseClientForTesting(makeMockClient({ query: mockQuery, insert: mockInsert }));

    const event = makeEvent([
      makeRecord(validAnalyticsEvent, "seq-001"), // duplicate
    ]);

    const result = await handler(event);

    // Duplicate row must NOT produce a batchItemFailure (it was deduped, not failed)
    expect(result.batchItemFailures).toHaveLength(0);
    // INSERT must NOT be called since all rows were deduplicated
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // W-02 fix: new rows in a batch containing duplicates are still inserted
  it("inserts only new rows when a batch contains a mix of duplicates and new records (W-02)", async () => {
    const mockInsert = jest.fn().mockResolvedValue({});

    // The second record (seq-002) uses a different event so it gets a different event_id.
    // We simulate seq-001's event_id already existing in ClickHouse.
    let firstEventId: string | null = null;
    const mockQuery = jest.fn().mockImplementation(async (params: { query: string }) => {
      if (firstEventId === null) {
        // On first call, capture the first event_id and pretend it exists
        const match = params.query.match(/'([a-f0-9]{64})'/);
        if (match) {
          firstEventId = match[1];
        }
      }
      return {
        json: jest.fn().mockResolvedValue(
          firstEventId ? [{ event_id: firstEventId }] : [],
        ),
      };
    });

    _setClickHouseClientForTesting(makeMockClient({ query: mockQuery, insert: mockInsert }));

    const event = makeEvent([
      makeRecord(validAnalyticsEvent, "seq-001"), // will be treated as duplicate
      makeRecord({ ...validAnalyticsEvent, event_type: "resolve", timestamp: "2026-03-21T04:06:00.000Z" }, "seq-002"), // new
    ]);

    const result = await handler(event);

    // No batchItemFailures — both are "successful" (one inserted, one deduped)
    expect(result.batchItemFailures).toHaveLength(0);
    // Insert called with only the non-duplicate row
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].values).toHaveLength(1);
  });
});
