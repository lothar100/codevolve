/**
 * Unit tests for the SQS archive handler.
 */

import type { SQSEvent, SQSRecord } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  QueryCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  PutCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  BatchWriteCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

const mockEmitEvent = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../src/shared/emitEvent", () => ({
  emitEvent: mockEmitEvent,
  EVENTS_STREAM: "codevolve-events",
  kinesisClient: {},
}));

jest.mock("@aws-sdk/client-kinesis", () => ({
  KinesisClient: jest.fn().mockImplementation(() => ({})),
  PutRecordCommand: jest.fn(),
}));

jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({})),
  InvokeModelCommand: jest.fn(),
}));

import { handler } from "../../../src/archive/archiveHandler";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SKILL_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROBLEM_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

const makeSkill = (overrides: Record<string, unknown> = {}) => ({
  skill_id: SKILL_ID,
  problem_id: PROBLEM_ID,
  name: "Two Sum",
  description: "Find two numbers",
  version_number: 1,
  is_canonical: false,
  status: "verified",
  language: "python",
  domain: ["arrays"],
  tags: [],
  confidence: 0.9,
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-01T00:00:00.000Z",
  ...overrides,
});

const makeMessage = (overrides: Record<string, unknown> = {}) => ({
  action: "archive",
  skill_id: SKILL_ID,
  problem_id: PROBLEM_ID,
  reason: "staleness_90d",
  triggered_by: "decision_engine",
  evaluation_timestamp: "2026-03-21T04:00:00.000Z",
  metrics_snapshot: { days_since_last_execution: 95 },
  ...overrides,
});

const makeSQSRecord = (
  messageId: string,
  body: Record<string, unknown>,
): SQSRecord =>
  ({
    messageId,
    receiptHandle: `receipt-${messageId}`,
    body: JSON.stringify(body),
    attributes: {} as never,
    messageAttributes: {},
    md5OfBody: "",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:us-east-2:123456789012:codevolve-archive-queue",
    awsRegion: "us-east-2",
  }) as SQSRecord;

const makeSQSEvent = (records: SQSRecord[]): SQSEvent => ({
  Records: records,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("archiveHandler (SQS)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("processes a single message successfully", async () => {
    const skill = makeSkill();

    // 1. Query skill
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. Update skill to archived
    mockSend.mockResolvedValueOnce({});
    // 3. Query cache - no entries
    mockSend.mockResolvedValueOnce({ Items: [] });
    // 4. Decrement skill_count
    mockSend.mockResolvedValueOnce({});
    // 5. Audit record
    mockSend.mockResolvedValueOnce({});
    // 6. Check all skills for problem
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }, { status: "partial" }],
    });

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage()),
    ]);

    const result = await handler(event);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it("skips already-archived skills (idempotent)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeSkill({ status: "archived" })],
    });

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage()),
    ]);

    const result = await handler(event);
    expect(result.batchItemFailures).toHaveLength(0);
    // Only 1 DynamoDB call (query skill), no update needed
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("skips skills not found in DynamoDB", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage()),
    ]);

    const result = await handler(event);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it("blocks archival of canonical skills", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeSkill({ is_canonical: true })],
    });

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage()),
    ]);

    const result = await handler(event);
    expect(result.batchItemFailures).toHaveLength(0);

    // Emits an archive_blocked event using "fail" event_type (this is a rejection, not an archive)
    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "fail",
        intent: "archive_blocked:canonical_skill",
        success: false,
      }),
    );
  });

  it("handles batch of multiple messages with partial failure", async () => {
    // First message: succeeds
    const skill1 = makeSkill();
    mockSend.mockResolvedValueOnce({ Items: [skill1] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    // archiveProblemIfAllSkillsArchived: problem has a non-archived skill, so no further DB calls
    mockSend.mockResolvedValueOnce({ Items: [{ status: "partial" }] });

    // Second message: fails (DynamoDB error on query)
    mockSend.mockRejectedValueOnce(new Error("DynamoDB throttle"));

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage()),
      makeSQSRecord("msg-2", makeMessage({ skill_id: "c3d4e5f6-a7b8-9012-cdef-123456789012" })),
    ]);

    const result = await handler(event);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-2");
  });

  it("retries when active execution lock blocks archival", async () => {
    const skill = makeSkill({ active_execution_lock: "lock-123" });

    // 1. Query skill - has lock
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. Update fails with ConditionalCheckFailedException
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);
    // 3. Re-query to check current state — still has lock, not archived
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "verified", active_execution_lock: "lock-123" }],
    });

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage()),
    ]);

    const result = await handler(event);
    // Should report as failure so SQS retries
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-1");
  });

  it("treats concurrent archival as idempotent no-op", async () => {
    const skill = makeSkill();

    // 1. Query skill — appears not yet archived
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. Update fails — another process archived it concurrently
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);
    // 3. Re-query reveals it is now archived
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }],
    });

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage()),
    ]);

    const result = await handler(event);
    // Idempotent no-op — no failure reported
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it("handles malformed message body gracefully", async () => {
    const event: SQSEvent = {
      Records: [
        {
          messageId: "msg-bad",
          receiptHandle: "receipt-bad",
          body: "not valid json",
          attributes: {} as never,
          messageAttributes: {},
          md5OfBody: "",
          eventSource: "aws:sqs",
          eventSourceARN: "arn:aws:sqs:us-east-2:123456789012:codevolve-archive-queue",
          awsRegion: "us-east-2",
        } as SQSRecord,
      ],
    };

    const result = await handler(event);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-bad");
  });

  it("emits archive event_type on successful archive", async () => {
    const skill = makeSkill();

    mockSend.mockResolvedValueOnce({ Items: [skill] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Items: [{ status: "partial" }] });

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage()),
    ]);

    await handler(event);

    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "archive",
        skill_id: SKILL_ID,
        success: true,
      }),
    );
  });

  it("includes metrics_snapshot in audit record metadata", async () => {
    const skill = makeSkill();
    const metricsSnapshot = { days_since_last_execution: 95, confidence: 0.22 };

    mockSend.mockResolvedValueOnce({ Items: [skill] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});
    // Audit record PutCommand — capture the call
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Items: [{ status: "partial" }] });

    const event = makeSQSEvent([
      makeSQSRecord("msg-1", makeMessage({ metrics_snapshot: metricsSnapshot })),
    ]);

    await handler(event);

    // The 5th call should be the audit record PutCommand
    const putCall = mockSend.mock.calls[4][0];
    expect(putCall.input.Item.metadata).toEqual(metricsSnapshot);
  });
});
