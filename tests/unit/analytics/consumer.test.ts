/* eslint-disable @typescript-eslint/no-explicit-any */

import type { KinesisStreamEvent, KinesisStreamRecord } from "aws-lambda";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { handler } from "../../../src/analytics/consumer";
import { _setAnalyticsDocClientForTesting } from "../../../src/analytics/projectorClient";

const VALID_SKILL_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const validAnalyticsEvent = {
  event_type: "execute",
  timestamp: "2026-03-21T04:05:00.123Z",
  skill_id: VALID_SKILL_ID,
  intent: "arrays:sort ascending",
  latency_ms: 42,
  confidence: 0.95,
  cache_hit: false,
  input_hash: "abc123",
  success: true,
} as const;

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

function makeMockClient(sendImpl?: jest.Mock): any {
  return {
    send: sendImpl ?? jest.fn().mockResolvedValue({}),
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  _setAnalyticsDocClientForTesting(null);
  jest.restoreAllMocks();
});

describe("analytics consumer handler", () => {
  it("projects valid records into DynamoDB transactions", async () => {
    const send = jest.fn().mockResolvedValue({});
    _setAnalyticsDocClientForTesting(makeMockClient(send));

    const result = await handler(
      makeEvent([
        makeRecord(validAnalyticsEvent, "seq-001"),
        makeRecord(
          { ...validAnalyticsEvent, event_type: "validate", confidence: 0.88 },
          "seq-002",
        ),
      ]),
    );

    expect(result.batchItemFailures).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);

    const transactCall = send.mock.calls[0][0];
    expect(transactCall).toBeInstanceOf(TransactWriteCommand);
    expect(transactCall.input.TransactItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Put: expect.objectContaining({
            TableName: expect.stringContaining("analytics-dedup"),
          }),
        }),
        expect.objectContaining({
          Update: expect.objectContaining({
            TableName: expect.stringContaining("analytics-buckets"),
          }),
        }),
      ]),
    );
  });

  it("keeps parse failures out of the projection path", async () => {
    const send = jest.fn().mockResolvedValue({});
    _setAnalyticsDocClientForTesting(makeMockClient(send));

    const result = await handler(
      makeEvent([
        makeRecord(validAnalyticsEvent, "seq-001"),
        makeRawRecord("not valid json{{", "seq-002"),
      ]),
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "seq-002" }]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("returns only projection failures for records that fail to materialize", async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("dynamo down"));
    _setAnalyticsDocClientForTesting(makeMockClient(send));

    const result = await handler(
      makeEvent([
        makeRecord(validAnalyticsEvent, "seq-001"),
        makeRecord({ ...validAnalyticsEvent, event_type: "resolve" }, "seq-002"),
      ]),
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "seq-002" }]);
  });

  it("treats duplicate events as successful no-ops", async () => {
    const duplicateError = {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
    };
    const send = jest.fn().mockRejectedValue(duplicateError);
    _setAnalyticsDocClientForTesting(makeMockClient(send));

    const result = await handler(makeEvent([makeRecord(validAnalyticsEvent, "seq-001")]));

    expect(result.batchItemFailures).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("loads input repeat state before projecting tracked resolve events", async () => {
    const send = jest.fn().mockImplementation(async (command: any) => {
      if (command instanceof GetCommand) {
        return {
          Item: {
            pk: `skill#${VALID_SKILL_ID}`,
            sk: "input#abc123",
            last_seen_at: "2026-03-21T03:55:00.000Z",
          },
        };
      }

      return {};
    });
    _setAnalyticsDocClientForTesting(makeMockClient(send));

    const result = await handler(
      makeEvent([
        makeRecord(
          {
            ...validAnalyticsEvent,
            event_type: "resolve",
            success: true,
            input_hash: "abc123",
          },
          "seq-001",
        ),
      ]),
    );

    expect(result.batchItemFailures).toEqual([]);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(TransactWriteCommand);

    const transactItems = send.mock.calls[1][0].input.TransactItems as Array<any>;
    const repeatUpdate = transactItems.find(
      (item) => item.Update?.TableName === "codevolve-analytics-input-state",
    );
    expect(repeatUpdate.Update.ExpressionAttributeValues[":repeatedIncrement"]).toBe(1);

    const minuteBucket = transactItems.find(
      (item) =>
        item.Update?.TableName === "codevolve-analytics-buckets" &&
        item.Update?.Key?.pk === "minute#2026-03-21T04:05:00.000Z",
    );
    expect(
      minuteBucket.Update.ExpressionAttributeValues[":repeatedInputCount"],
    ).toBe(1);
  });

  it("does not call DynamoDB for an empty batch", async () => {
    const send = jest.fn();
    _setAnalyticsDocClientForTesting(makeMockClient(send));

    const result = await handler(makeEvent([]));

    expect(result.batchItemFailures).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
