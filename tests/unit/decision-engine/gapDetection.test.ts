/**
 * Unit tests for Rule 3: Gap Detection → GapQueue
 *
 * Tests cover:
 * 1. Eligible items (last_seen_at within 24h, no last_evolve_queued_at) → SQS send + DynamoDB update
 * 2. Items with last_evolve_queued_at within 24h → skipped (dedup window)
 * 3. Items sorted by min_confidence ASC before processing
 * 4. More than 10 eligible items → only 10 processed (enforced at query Limit level)
 * 5. SQS send fails for one item → DynamoDB update not called for that item; others still processed
 * 6. MessageDeduplicationId format is {intent_hash}_{YYYYMMDD}
 * 7. Zero eligible items → no SQS sends, no errors
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockDynamoSend = jest.fn();
const mockSqsSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockDynamoSend }),
  },
  ScanCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
}));

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { evaluateGapDetection } from "../../../src/decision-engine/rules/gapDetection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a gap-log item. last_seen_at defaults to 1 hour ago (within the 24h window).
 * last_evolve_queued_at defaults to undefined (never queued).
 */
function makeGapItem(overrides: {
  intent_hash?: string;
  intent?: string;
  min_confidence?: number;
  last_seen_at?: string;
  last_evolve_queued_at?: string;
} = {}) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return {
    intent_hash: overrides.intent_hash ?? "abc123",
    intent: overrides.intent ?? "sort an array",
    first_seen_at: oneHourAgo,
    last_seen_at: overrides.last_seen_at ?? oneHourAgo,
    miss_count: 3,
    min_confidence: overrides.min_confidence ?? 0.45,
    ...(overrides.last_evolve_queued_at !== undefined
      ? { last_evolve_queued_at: overrides.last_evolve_queued_at }
      : {}),
  };
}

/** Create the mock clients that are passed into evaluateGapDetection. */
function makeClients() {
  const dynamoClient = DynamoDBDocumentClient.from({} as never);
  const sqsClient = new SQSClient({});
  return { dynamoClient, sqsClient };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Default: SQS succeeds, DynamoDB update succeeds
  mockSqsSend.mockResolvedValue({});
  mockDynamoSend.mockResolvedValue({ Items: [] });

  // Set required env vars
  process.env.GAP_LOG_TABLE = "codevolve-gap-log";
  process.env.GAP_QUEUE_URL =
    "https://sqs.us-east-2.amazonaws.com/123456789012/codevolve-gap-queue.fifo";
});

// ---------------------------------------------------------------------------
// Test 1: Eligible items trigger SQS send and DynamoDB update
// ---------------------------------------------------------------------------

describe("eligible items", () => {
  it("sends an SQS message and updates DynamoDB for each eligible item", async () => {
    const item = makeGapItem({ intent_hash: "hash1", intent: "find max subarray" });

    mockDynamoSend.mockResolvedValueOnce({ Items: [item] }); // Scan
    mockSqsSend.mockResolvedValueOnce({});                    // SendMessage
    mockDynamoSend.mockResolvedValueOnce({});                 // UpdateItem

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    // SQS was called once
    expect(mockSqsSend).toHaveBeenCalledTimes(1);

    // Check message body fields
    const sqsCall = mockSqsSend.mock.calls[0][0];
    const body = JSON.parse(sqsCall.input.MessageBody);
    expect(body.intent).toBe(item.intent);
    expect(body.resolve_confidence).toBe(item.min_confidence);
    expect(body.original_event_id).toBe(item.intent_hash);
    expect(body.timestamp).toBe(item.last_seen_at);

    // DynamoDB update was called (second call — first was Scan)
    expect(mockDynamoSend).toHaveBeenCalledTimes(2);
    const updateCall = mockDynamoSend.mock.calls[1][0];
    expect(updateCall.input.Key).toEqual({ intent_hash: item.intent_hash });
    expect(updateCall.input.UpdateExpression).toContain("last_evolve_queued_at");
  });
});

// ---------------------------------------------------------------------------
// Test 2: Items queued within 24h are filtered out at scan level
// ---------------------------------------------------------------------------

describe("24-hour deduplication", () => {
  it("does not process items whose last_evolve_queued_at is within 24h", async () => {
    // The filter expression on the Scan excludes these items — simulate by returning empty Items
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    // No SQS sends, no DynamoDB updates
    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(mockDynamoSend).toHaveBeenCalledTimes(1); // only the Scan
  });

  it("verifies that the Scan filter expression checks last_evolve_queued_at < cutoff", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    const scanCall = mockDynamoSend.mock.calls[0][0];
    expect(scanCall.input.FilterExpression).toContain("last_evolve_queued_at");
    // Filter should require the attribute to not exist OR be older than cutoff
    expect(scanCall.input.FilterExpression).toContain("attribute_not_exists");
  });
});

// ---------------------------------------------------------------------------
// Test 3: Items sorted by min_confidence ASC
// ---------------------------------------------------------------------------

describe("sort order", () => {
  it("processes items in ascending min_confidence order (most urgent first)", async () => {
    const itemHigh = makeGapItem({ intent_hash: "high", min_confidence: 0.65 });
    const itemLow = makeGapItem({ intent_hash: "low", min_confidence: 0.20 });
    const itemMid = makeGapItem({ intent_hash: "mid", min_confidence: 0.40 });

    // Scan returns them in arbitrary order
    mockDynamoSend.mockResolvedValueOnce({ Items: [itemHigh, itemLow, itemMid] });
    // SQS + DynamoDB update for each item (3 each)
    mockSqsSend.mockResolvedValue({});
    mockDynamoSend.mockResolvedValue({});

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    expect(mockSqsSend).toHaveBeenCalledTimes(3);

    // Extract the order of MessageBody.original_event_id across all SQS calls
    const sentHashes = mockSqsSend.mock.calls.map((call) => {
      const body = JSON.parse(call[0].input.MessageBody);
      return body.original_event_id;
    });

    // Low confidence first, then mid, then high
    expect(sentHashes).toEqual(["low", "mid", "high"]);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Hard limit of 10 (enforced at Scan Limit level)
// ---------------------------------------------------------------------------

describe("10-item throttle", () => {
  it("processes at most 10 items when Scan returns exactly 10", async () => {
    // DynamoDB Limit: 10 is set in the Scan — mock returns 10 items
    const items = Array.from({ length: 10 }, (_, i) =>
      makeGapItem({ intent_hash: `hash${i}`, min_confidence: 0.1 + i * 0.05 }),
    );

    mockDynamoSend.mockResolvedValueOnce({ Items: items });
    mockSqsSend.mockResolvedValue({});
    mockDynamoSend.mockResolvedValue({});

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    expect(mockSqsSend).toHaveBeenCalledTimes(10);
  });

  it("verifies that Scan is called with Limit: 10", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    const scanCall = mockDynamoSend.mock.calls[0][0];
    expect(scanCall.input.Limit).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Test 5: SQS failure for one item — that item's DynamoDB update is skipped
// ---------------------------------------------------------------------------

describe("SQS failure isolation", () => {
  it("skips the DynamoDB update for an item whose SQS send failed, processes others", async () => {
    const item1 = makeGapItem({ intent_hash: "ok1", min_confidence: 0.30 });
    const item2 = makeGapItem({ intent_hash: "fail", min_confidence: 0.40 });
    const item3 = makeGapItem({ intent_hash: "ok2", min_confidence: 0.50 });

    // Scan returns all three
    mockDynamoSend.mockResolvedValueOnce({ Items: [item1, item2, item3] });

    // item1 SQS succeeds, item2 SQS fails, item3 SQS succeeds
    mockSqsSend
      .mockResolvedValueOnce({})            // item1: success
      .mockRejectedValueOnce(new Error("SQS throttle")) // item2: failure
      .mockResolvedValueOnce({});           // item3: success

    // item1 DynamoDB update, item3 DynamoDB update (item2 must be skipped)
    mockDynamoSend
      .mockResolvedValueOnce({})            // item1: UpdateItem
      .mockResolvedValueOnce({});           // item3: UpdateItem

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    // SQS attempted all three
    expect(mockSqsSend).toHaveBeenCalledTimes(3);

    // DynamoDB: 1 Scan + 2 UpdateItems (item1 and item3 only; item2 was skipped)
    expect(mockDynamoSend).toHaveBeenCalledTimes(3);

    // Verify the two DynamoDB updates that DID happen are for item1 and item3
    const updateCalls = mockDynamoSend.mock.calls.slice(1); // skip Scan at index 0
    const updatedHashes = updateCalls.map(
      (call) => call[0].input.Key.intent_hash,
    );
    expect(updatedHashes).toContain("ok1");
    expect(updatedHashes).toContain("ok2");
    expect(updatedHashes).not.toContain("fail");
  });
});

// ---------------------------------------------------------------------------
// Test 6: MessageDeduplicationId format
// ---------------------------------------------------------------------------

describe("MessageDeduplicationId format", () => {
  it("uses {intent_hash}_{YYYYMMDD} as MessageDeduplicationId", async () => {
    const item = makeGapItem({ intent_hash: "abc123" });
    mockDynamoSend.mockResolvedValueOnce({ Items: [item] });
    mockSqsSend.mockResolvedValueOnce({});
    mockDynamoSend.mockResolvedValueOnce({});

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    const sqsCall = mockSqsSend.mock.calls[0][0];
    const dedupId: string = sqsCall.input.MessageDeduplicationId;

    // Must start with the intent_hash
    expect(dedupId.startsWith("abc123_")).toBe(true);

    // The date portion must be 8 digits (YYYYMMDD)
    const datePart = dedupId.split("_")[1];
    expect(datePart).toMatch(/^\d{8}$/);

    // The date must represent today's date in YYYYMMDD format
    const today = new Date();
    const expectedDate = today
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "");
    expect(datePart).toBe(expectedDate);
  });

  it("uses MessageGroupId 'gap' for all messages", async () => {
    const item = makeGapItem({ intent_hash: "abc123" });
    mockDynamoSend.mockResolvedValueOnce({ Items: [item] });
    mockSqsSend.mockResolvedValueOnce({});
    mockDynamoSend.mockResolvedValueOnce({});

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    const sqsCall = mockSqsSend.mock.calls[0][0];
    expect(sqsCall.input.MessageGroupId).toBe("gap");
  });
});

// ---------------------------------------------------------------------------
// Test 7: Zero eligible items
// ---------------------------------------------------------------------------

describe("zero eligible items", () => {
  it("makes no SQS sends and no DynamoDB updates when Scan returns empty", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const { dynamoClient, sqsClient } = makeClients();
    await evaluateGapDetection(dynamoClient, sqsClient);

    expect(mockSqsSend).not.toHaveBeenCalled();
    // Only the Scan call was made
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });

  it("does not throw when Scan returns undefined Items", async () => {
    mockDynamoSend.mockResolvedValueOnce({});

    const { dynamoClient, sqsClient } = makeClients();
    await expect(evaluateGapDetection(dynamoClient, sqsClient)).resolves.toBeUndefined();
    expect(mockSqsSend).not.toHaveBeenCalled();
  });
});
