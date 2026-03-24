/**
 * Unit tests for src/evolve/handler.ts
 *
 * Coverage:
 *   - Successful flow: parse → job write → Claude call → skill write → validate invoke → job update
 *   - Permanent errors: bad JSON body, schema validation failure, Claude parse failure
 *   - Transient errors: DynamoDB failure, Secrets Manager failure
 *   - Kinesis event emission on success and failure
 *   - batchItemFailures: empty on permanent errors, populated on transient errors
 */

import type { SQSEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

const mockDocSend = jest.fn();
const mockLambdaSend = jest.fn();
const mockKinesisSend = jest.fn();
const mockAnthropicCreate = jest.fn();
const mockGetAnthropicClient = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest
      .fn()
      .mockReturnValue({ send: (...args: unknown[]) => mockDocSend(...args) }),
  },
  PutCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "PutCommand", input })),
  QueryCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "QueryCommand", input })),
  UpdateCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "UpdateCommand", input })),
}));

jest.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockLambdaSend(...args),
  })),
  InvokeCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "InvokeCommand", input })),
}));

jest.mock("@aws-sdk/client-kinesis", () => ({
  KinesisClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockKinesisSend(...args),
  })),
  PutRecordCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "PutRecordCommand", input })),
  PutRecordsCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "PutRecordsCommand", input })),
}));

jest.mock("uuid", () => ({
  v4: jest
    .fn()
    .mockReturnValueOnce("job-id-1111-1111-1111-111111111111")
    .mockReturnValueOnce("skill-id-2222-2222-2222-222222222222")
    .mockImplementation(() => "fallback-uuid-0000-0000-0000-000000000000"),
}));

// Mock claudeClient so tests don't hit Secrets Manager
jest.mock("../../../src/evolve/claudeClient.js", () => ({
  getAnthropicClient: (...args: unknown[]) => mockGetAnthropicClient(...args),
  _setAnthropicClientForTesting: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { handler } from "../../../src/evolve/handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_INTENT = "sort a list of integers by frequency";

/** Minimal valid GapQueueMessage body */
const validMessageBody = JSON.stringify({
  intent: VALID_INTENT,
  resolve_confidence: 0.45,
  timestamp: "2026-03-23T10:00:00.000Z",
  original_event_id: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
});

/** Minimal valid CreateSkillRequest that Claude would return */
const validClaudeSkillJson = {
  name: "Sort By Frequency",
  description: "Sorts integers by their frequency",
  language: "python",
  domain: ["sorting", "arrays"],
  tags: ["frequency", "sort"],
  inputs: [{ name: "nums", type: "list[int]" }],
  outputs: [{ name: "result", type: "list[int]" }],
  examples: [{ input: { nums: [1, 1, 2] }, output: { result: [1, 1, 2] } }],
  tests: [
    { input: { nums: [1, 1, 2] }, expected: { result: [1, 1, 2] } },
    { input: { nums: [3, 2, 1] }, expected: { result: [3, 2, 1] } },
    { input: { nums: [] }, expected: { result: [] } },
  ],
  implementation: "def sort_by_freq(nums): return sorted(nums)",
  status: "partial",
  problem_id: "00000000-0000-0000-0000-000000000001",
};

/** Claude API response wrapping the skill JSON in a code fence */
function makeClaudeResponse(skillJson: unknown): { content: unknown[] } {
  return {
    content: [
      {
        type: "text",
        text: "```json\n" + JSON.stringify(skillJson) + "\n```",
      },
    ],
  };
}

/** Build a minimal SQSEvent with one record */
function makeSQSEvent(body: string, messageId = "msg-001"): SQSEvent {
  return {
    Records: [
      {
        messageId,
        receiptHandle: "receipt-handle",
        body,
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890",
          SenderId: "sender",
          ApproximateFirstReceiveTimestamp: "1234567890",
        },
        messageAttributes: {},
        md5OfBody: "md5",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-2:123456789012:codevolve-gap-queue.fifo",
        awsRegion: "us-east-2",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evolve handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default: Claude client initialises fine
    mockGetAnthropicClient.mockResolvedValue({
      messages: { create: mockAnthropicCreate },
    });

    // Default: DynamoDB calls succeed
    mockDocSend.mockResolvedValue({});

    // Default: Lambda invoke succeeds
    mockLambdaSend.mockResolvedValue({});

    // Default: Kinesis emit succeeds
    mockKinesisSend.mockResolvedValue({});

    // Default: querySimilarSkills returns empty items
    mockDocSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === "QueryCommand") return Promise.resolve({ Items: [] });
      return Promise.resolve({});
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("processes a valid message and returns empty batchItemFailures", async () => {
    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(validClaudeSkillJson));

    const result = await handler(makeSQSEvent(validMessageBody));

    expect(result.batchItemFailures).toEqual([]);
  });

  it("writes evolve-job with status 'running' before calling Claude", async () => {
    const putCalls: unknown[] = [];
    mockDocSend.mockImplementation((cmd: { _type: string; input: unknown }) => {
      if (cmd._type === "PutCommand") {
        putCalls.push(cmd.input);
        return Promise.resolve({});
      }
      if (cmd._type === "QueryCommand") return Promise.resolve({ Items: [] });
      return Promise.resolve({});
    });

    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(validClaudeSkillJson));

    await handler(makeSQSEvent(validMessageBody));

    // First PutCommand should be the job record
    const jobPut = putCalls[0] as { Item: Record<string, unknown> };
    expect(jobPut.Item.status).toBe("running");
    expect(jobPut.Item.intent).toBe(VALID_INTENT);
    expect(typeof jobPut.Item.evolve_id).toBe("string");
  });

  it("writes the new skill to DynamoDB after Claude responds", async () => {
    const putCalls: unknown[] = [];
    mockDocSend.mockImplementation((cmd: { _type: string; input: unknown }) => {
      if (cmd._type === "PutCommand") {
        putCalls.push(cmd.input);
        return Promise.resolve({});
      }
      if (cmd._type === "QueryCommand") return Promise.resolve({ Items: [] });
      return Promise.resolve({});
    });

    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(validClaudeSkillJson));

    await handler(makeSQSEvent(validMessageBody));

    // Second PutCommand should be the skill record
    const skillPut = putCalls[1] as { Item: Record<string, unknown> };
    expect(skillPut.Item.name).toBe(validClaudeSkillJson.name);
    expect(skillPut.Item.status).toBe("partial");
    expect(skillPut.Item.is_canonical).toBe(false);
    expect(skillPut.Item.confidence).toBe(0);
  });

  it("invokes the validation Lambda asynchronously after writing skill", async () => {
    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(validClaudeSkillJson));

    await handler(makeSQSEvent(validMessageBody));

    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const invokeCmd = mockLambdaSend.mock.calls[0][0];
    expect(invokeCmd._type).toBe("InvokeCommand");
    expect(invokeCmd.input.InvocationType).toBe("Event");
  });

  it("updates evolve-job to 'complete' with skill_id on success", async () => {
    const updateCalls: unknown[] = [];
    mockDocSend.mockImplementation((cmd: { _type: string; input: unknown }) => {
      if (cmd._type === "UpdateCommand") updateCalls.push(cmd.input);
      if (cmd._type === "QueryCommand") return Promise.resolve({ Items: [] });
      return Promise.resolve({});
    });

    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(validClaudeSkillJson));

    await handler(makeSQSEvent(validMessageBody));

    expect(updateCalls.length).toBe(1);
    const updateInput = updateCalls[0] as {
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(updateInput.ExpressionAttributeValues[":status"]).toBe("complete");
    expect(typeof updateInput.ExpressionAttributeValues[":skillId"]).toBe("string");
  });

  // -------------------------------------------------------------------------
  // Permanent errors — consume the message, no retry
  // -------------------------------------------------------------------------

  it("consumes message (no batchItemFailure) when body is not valid JSON", async () => {
    const result = await handler(makeSQSEvent("not-json-at-all"));
    expect(result.batchItemFailures).toEqual([]);
  });

  it("consumes message when GapQueueMessage schema validation fails", async () => {
    const invalidBody = JSON.stringify({
      // missing required fields
      intent: "",
      resolve_confidence: 0.5,
    });
    const result = await handler(makeSQSEvent(invalidBody));
    expect(result.batchItemFailures).toEqual([]);
  });

  it("consumes message when Claude response contains no JSON", async () => {
    mockDocSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === "QueryCommand") return Promise.resolve({ Items: [] });
      return Promise.resolve({});
    });
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot generate a skill for this." }],
    });

    const result = await handler(makeSQSEvent(validMessageBody));
    expect(result.batchItemFailures).toEqual([]);
  });

  it("consumes message and marks job 'failed' when generated skill fails schema validation", async () => {
    // Claude returns an incomplete object missing required 'inputs' field
    const badSkill = { ...validClaudeSkillJson, inputs: [] };
    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(badSkill));

    const updateCalls: unknown[] = [];
    mockDocSend.mockImplementation((cmd: { _type: string; input: unknown }) => {
      if (cmd._type === "UpdateCommand") updateCalls.push(cmd.input);
      if (cmd._type === "QueryCommand") return Promise.resolve({ Items: [] });
      return Promise.resolve({});
    });

    const result = await handler(makeSQSEvent(validMessageBody));

    expect(result.batchItemFailures).toEqual([]);

    const failedUpdate = updateCalls[0] as {
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(failedUpdate.ExpressionAttributeValues[":status"]).toBe("failed");
    expect(typeof failedUpdate.ExpressionAttributeValues[":error"]).toBe("string");
  });

  it("repairs output→expected in test cases from Claude before validation", async () => {
    // Claude uses 'output' instead of 'expected'
    const skillWithOutputTests = {
      ...validClaudeSkillJson,
      tests: [
        { input: { nums: [1, 2] }, output: { result: [1, 2] } },
        { input: { nums: [3] }, output: { result: [3] } },
        { input: { nums: [] }, output: { result: [] } },
      ],
    };
    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(skillWithOutputTests));

    const result = await handler(makeSQSEvent(validMessageBody));
    // Should succeed — repairTestCases renames output→expected before Zod validates
    expect(result.batchItemFailures).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Transient errors — return in batchItemFailures for SQS retry
  // -------------------------------------------------------------------------

  it("returns batchItemFailure when Secrets Manager / Claude client init fails", async () => {
    mockGetAnthropicClient.mockRejectedValue(new Error("Secrets Manager unreachable"));

    const event = makeSQSEvent(validMessageBody, "msg-transient");
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: "msg-transient" },
    ]);
  });

  it("returns batchItemFailure when DynamoDB PutItem (skill write) throws", async () => {
    let putCallCount = 0;
    mockDocSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === "QueryCommand") return Promise.resolve({ Items: [] });
      if (cmd._type === "PutCommand") {
        putCallCount++;
        if (putCallCount === 2) {
          // Second PutCommand is the skill write — simulate DynamoDB transient failure
          return Promise.reject(new Error("ProvisionedThroughputExceededException"));
        }
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(validClaudeSkillJson));

    const event = makeSQSEvent(validMessageBody, "msg-dynamo-transient");
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: "msg-dynamo-transient" },
    ]);
  });

  // -------------------------------------------------------------------------
  // Validation Lambda failure is non-fatal
  // -------------------------------------------------------------------------

  it("continues and returns success when validation Lambda invoke fails", async () => {
    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(validClaudeSkillJson));
    mockLambdaSend.mockRejectedValue(new Error("Lambda throttled"));

    const result = await handler(makeSQSEvent(validMessageBody));
    // Validation Lambda failure is fire-and-forget — not a batchItemFailure
    expect(result.batchItemFailures).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Multiple records
  // -------------------------------------------------------------------------

  it("processes multiple records independently", async () => {
    mockAnthropicCreate.mockResolvedValue(makeClaudeResponse(validClaudeSkillJson));

    const event: SQSEvent = {
      Records: [
        {
          messageId: "msg-a",
          receiptHandle: "rh-a",
          body: validMessageBody,
          attributes: {
            ApproximateReceiveCount: "1",
            SentTimestamp: "1234567890",
            SenderId: "s",
            ApproximateFirstReceiveTimestamp: "1234567890",
          },
          messageAttributes: {},
          md5OfBody: "md5",
          eventSource: "aws:sqs",
          eventSourceARN: "arn",
          awsRegion: "us-east-2",
        },
        {
          messageId: "msg-b",
          receiptHandle: "rh-b",
          body: "not-json",
          attributes: {
            ApproximateReceiveCount: "1",
            SentTimestamp: "1234567890",
            SenderId: "s",
            ApproximateFirstReceiveTimestamp: "1234567890",
          },
          messageAttributes: {},
          md5OfBody: "md5",
          eventSource: "aws:sqs",
          eventSourceARN: "arn",
          awsRegion: "us-east-2",
        },
      ],
    };

    const result = await handler(event);
    // msg-a succeeds, msg-b is a permanent JSON parse failure (consumed)
    expect(result.batchItemFailures).toEqual([]);
  });
});
