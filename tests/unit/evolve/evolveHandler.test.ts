/**
 * Unit tests for src/evolve/handler.ts
 *
 * All external I/O is mocked:
 *   - @anthropic-ai/sdk        → mock Claude client
 *   - @aws-sdk/lib-dynamodb    → mockSend (PutCommand)
 *   - @aws-sdk/client-lambda   → mockLambdaSend (InvokeCommand)
 *   - src/shared/emitEvent     → mockEmitEvent
 *   - src/evolve/claudeClient  → _setClaudeClientForTesting
 */

import type { SQSEvent, SQSRecord } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that reference these modules
// ---------------------------------------------------------------------------

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  PutCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

const mockLambdaSend = jest.fn();

jest.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
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

// Mock Secrets Manager so claudeClient does not attempt a real AWS call in tests.
jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({})),
  GetSecretValueCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

// ---------------------------------------------------------------------------
// Import handler AFTER mocks are registered
// ---------------------------------------------------------------------------

import { handler, generateSkill, EvolveParseError } from "../../../src/evolve/handler";
import { _setClaudeClientForTesting } from "../../../src/evolve/claudeClient";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROBLEM_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

/**
 * A minimal generated skill JSON that satisfies CreateSkillRequestSchema.
 * Claude would return this (serialised) inside a ```json ``` fence.
 */
const VALID_GENERATED_SKILL = {
  problem_id: PROBLEM_ID,
  name: "Two Sum",
  description: "Find two numbers that add up to the target.",
  language: "python",
  domain: ["arrays"],
  tags: ["hash-map", "two-sum"],
  inputs: [
    { name: "nums", type: "list[int]" },
    { name: "target", type: "int" },
  ],
  outputs: [{ name: "indices", type: "list[int]" }],
  examples: [
    { input: { nums: [2, 7, 11, 15], target: 9 }, output: { indices: [0, 1] } },
  ],
  tests: [
    { input: { nums: [2, 7, 11, 15], target: 9 }, expected: { indices: [0, 1] } },
    { input: { nums: [3, 2, 4], target: 6 }, expected: { indices: [1, 2] } },
    { input: { nums: [3, 3], target: 6 }, expected: { indices: [0, 1] } },
  ],
  implementation: "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i",
  status: "partial",
};

/**
 * Build a Claude API response that wraps `obj` inside a ```json ``` fence.
 */
function makeClaudeResponse(obj: unknown): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: `Here is the skill:\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``,
      },
    ],
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 200 },
  } as Anthropic.Message;
}

/**
 * Build a mock Anthropic client whose messages.create resolves to a given response.
 */
function makeMockClaudeClient(
  createImpl: () => Promise<Anthropic.Message>,
): Anthropic {
  return {
    messages: {
      create: jest.fn().mockImplementation(createImpl),
    },
  } as unknown as Anthropic;
}

/**
 * Build a minimal SQS event with a single record.
 */
function makeSqsEvent(body: unknown, messageId = "msg-001"): SQSEvent {
  return {
    Records: [
      {
        messageId,
        body: JSON.stringify(body),
        receiptHandle: "receipt-001",
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "0",
          SenderId: "AIDA",
          ApproximateFirstReceiveTimestamp: "0",
        },
        messageAttributes: {},
        md5OfBody: "md5",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-2:123:GapQueue",
        awsRegion: "us-east-2",
      } as SQSRecord,
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Default: DynamoDB write succeeds
  mockSend.mockResolvedValue({});

  // Default: Lambda invoke succeeds
  mockLambdaSend.mockResolvedValue({ StatusCode: 202 });
});

afterEach(() => {
  // Reset the cached Claude client so tests are isolated
  _setClaudeClientForTesting(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handler (SQS batch)", () => {
  it("happy path: valid generated skill → DynamoDB write, evolve Kinesis event, validate Lambda invoked", async () => {
    // Arrange
    const mockClient = makeMockClaudeClient(() =>
      Promise.resolve(makeClaudeResponse(VALID_GENERATED_SKILL)),
    );
    _setClaudeClientForTesting(mockClient);

    const event = makeSqsEvent({
      intent: "find two numbers that add up to a target",
      problem_id: PROBLEM_ID,
    });

    // Act
    const result = await handler(event);

    // Assert: no failures (message consumed successfully)
    expect(result.batchItemFailures).toHaveLength(0);

    // DynamoDB PutCommand was called with a well-formed item
    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCall = mockSend.mock.calls[0][0] as { input: Record<string, unknown> };
    const item = putCall.input.Item as Record<string, unknown>;
    expect(typeof item.skill_id).toBe("string");
    expect(item.status).toBe("partial");
    expect(item.is_canonical).toBe(false);

    // Validation Lambda was invoked asynchronously
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const invocation = mockLambdaSend.mock.calls[0][0] as {
      input: { InvocationType: string };
    };
    expect(invocation.input.InvocationType).toBe("Event");

    // Kinesis success event emitted
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    const emittedEvent = mockEmitEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(emittedEvent.success).toBe(true);
    expect(emittedEvent.intent).toBe("find two numbers that add up to a target");
  });

  it("Claude rate limit error → message returned in batchItemFailures for SQS retry", async () => {
    // Anthropic SDK raises errors with status codes; simulate a 429-like error
    const rateLimitError = new Error("Rate limit exceeded");
    (rateLimitError as NodeJS.ErrnoException).code = "429";

    const mockClient = makeMockClaudeClient(() => Promise.reject(rateLimitError));
    _setClaudeClientForTesting(mockClient);

    const event = makeSqsEvent(
      { intent: "sort by frequency" },
      "msg-rate-limit",
    );

    const result = await handler(event);

    // Message must be in batchItemFailures so SQS retries it
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: "msg-rate-limit" },
    ]);

    // No DynamoDB write should have happened
    expect(mockSend).not.toHaveBeenCalled();

    // No success Kinesis event
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("Claude response with no JSON code fence → evolve_failed emitted, message consumed (not in batchItemFailures)", async () => {
    // Claude returns prose with no ```json ``` block
    const noFenceResponse: Anthropic.Message = {
      id: "msg_nofence",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I cannot generate a skill for this intent. Please try again.",
        },
      ],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 20 },
    } as Anthropic.Message;

    const mockClient = makeMockClaudeClient(() =>
      Promise.resolve(noFenceResponse),
    );
    _setClaudeClientForTesting(mockClient);

    const event = makeSqsEvent(
      { intent: "do something impossible" },
      "msg-no-fence",
    );

    const result = await handler(event);

    // Message must NOT be in batchItemFailures — it is consumed, not retried
    expect(result.batchItemFailures).toHaveLength(0);

    // DynamoDB write must not have been attempted
    expect(mockSend).not.toHaveBeenCalled();

    // evolve_failed event must be emitted
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    const emittedEvent = mockEmitEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(emittedEvent.event_type).toBe("fail");
    expect(emittedEvent.success).toBe(false);
    expect(typeof emittedEvent.intent).toBe("string");
    expect((emittedEvent.intent as string).startsWith("evolve_failed:")).toBe(true);
  });

  it("Zod validation failure on generated skill → evolve_failed emitted, message consumed", async () => {
    // Claude returns a JSON fence but the content fails schema validation
    // (missing required 'inputs' field)
    const invalidSkill = {
      name: "Broken Skill",
      description: "Missing required fields",
      language: "python",
      domain: ["arrays"],
      // inputs missing → fails CreateSkillRequestSchema
      outputs: [{ name: "result", type: "int" }],
      status: "partial",
    };

    const mockClient = makeMockClaudeClient(() =>
      Promise.resolve(makeClaudeResponse(invalidSkill)),
    );
    _setClaudeClientForTesting(mockClient);

    const event = makeSqsEvent(
      { intent: "compute something" },
      "msg-zod-fail",
    );

    const result = await handler(event);

    // Message consumed, not retried
    expect(result.batchItemFailures).toHaveLength(0);

    // No DynamoDB write
    expect(mockSend).not.toHaveBeenCalled();

    // evolve_failed emitted
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    const emittedEvent = mockEmitEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(emittedEvent.event_type).toBe("fail");
    expect(emittedEvent.success).toBe(false);
  });

  it("validation Lambda invoke failure does not fail the message", async () => {
    // Claude succeeds and DynamoDB succeeds, but Lambda invoke throws
    const mockClient = makeMockClaudeClient(() =>
      Promise.resolve(makeClaudeResponse(VALID_GENERATED_SKILL)),
    );
    _setClaudeClientForTesting(mockClient);

    mockLambdaSend.mockRejectedValueOnce(new Error("Lambda invocation failed"));

    const event = makeSqsEvent({ intent: "sum two numbers" });

    const result = await handler(event);

    // Message still consumed successfully — validation failure is non-fatal
    expect(result.batchItemFailures).toHaveLength(0);

    // DynamoDB write still happened
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Success event still emitted
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    const emittedEvent = mockEmitEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(emittedEvent.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateSkill unit tests
// ---------------------------------------------------------------------------

describe("generateSkill", () => {
  it("returns parsed JSON from a valid code-fenced Claude response", async () => {
    const mockClient = makeMockClaudeClient(() =>
      Promise.resolve(makeClaudeResponse(VALID_GENERATED_SKILL)),
    );

    const result = await generateSkill("find two numbers adding to target", mockClient);

    expect(result).toEqual(VALID_GENERATED_SKILL);
  });

  it("throws EvolveParseError when response has no JSON code fence", async () => {
    const mockClient = makeMockClaudeClient(() =>
      Promise.resolve({
        id: "msg_x",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Sorry, I cannot help." }],
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      } as Anthropic.Message),
    );

    await expect(generateSkill("some intent", mockClient)).rejects.toThrow(
      EvolveParseError,
    );
  });

  it("throws EvolveParseError when the code fence contains invalid JSON", async () => {
    const badJsonResponse: Anthropic.Message = {
      id: "msg_badjson",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "```json\n{ this is not valid json }\n```",
        },
      ],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    } as Anthropic.Message;

    const mockClient = makeMockClaudeClient(() =>
      Promise.resolve(badJsonResponse),
    );

    await expect(generateSkill("some intent", mockClient)).rejects.toThrow(
      EvolveParseError,
    );
  });

  it("re-throws non-parse errors (e.g. rate limit) so SQS retries the message", async () => {
    const rateLimitError = new Error("429 Too Many Requests");
    const mockClient = makeMockClaudeClient(() =>
      Promise.reject(rateLimitError),
    );

    await expect(generateSkill("some intent", mockClient)).rejects.toThrow(
      "429 Too Many Requests",
    );
    // Must NOT be wrapped in EvolveParseError
    await expect(generateSkill("some intent", mockClient)).rejects.not.toThrow(
      EvolveParseError,
    );
  });
});
