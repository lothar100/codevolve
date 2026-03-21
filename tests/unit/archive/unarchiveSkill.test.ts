/**
 * Unit tests for POST /skills/:id/unarchive handler.
 */

import type { APIGatewayProxyEvent } from "aws-lambda";

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

const mockBedrockSend = jest.fn();
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: mockBedrockSend,
  })),
  InvokeModelCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

import { handler } from "../../../src/archive/unarchiveSkill";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SKILL_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROBLEM_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

const makeArchivedSkill = (overrides: Record<string, unknown> = {}) => ({
  skill_id: SKILL_ID,
  problem_id: PROBLEM_ID,
  name: "Two Sum",
  description: "Find two numbers",
  version_number: 1,
  version_label: "0.1.0",
  is_canonical: false,
  status: "archived",
  previous_status: "verified",
  language: "python",
  domain: ["arrays"],
  tags: ["easy"],
  inputs: [{ name: "nums", type: "number[]" }],
  outputs: [{ name: "indices", type: "number[]" }],
  examples: [],
  tests: [],
  implementation: "def solve(): pass",
  confidence: 0.9,
  latency_p50_ms: 10,
  latency_p95_ms: 50,
  archived_at: "2026-03-15T00:00:00.000Z",
  archive_reason: "manual",
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-15T00:00:00.000Z",
  ...overrides,
});

const fakeEmbedding = new Array(1024).fill(0.1);

const makeEvent = (skillId: string): APIGatewayProxyEvent =>
  ({
    pathParameters: { id: skillId },
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: `/skills/${skillId}/unarchive`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  }) as APIGatewayProxyEvent;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("unarchiveSkill handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: Bedrock returns a valid embedding
    mockBedrockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({ embedding: fakeEmbedding })),
    });
  });

  it("returns 400 for invalid skill ID", async () => {
    const result = await handler(makeEvent("not-a-uuid"));
    expect(result.statusCode).toBe(400);
  });

  it("returns 404 when skill does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(404);
  });

  it("returns 409 when skill is not archived", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeArchivedSkill({ status: "verified" })],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe("CONFLICT");
  });

  it("successfully unarchives a skill and returns 200", async () => {
    const skill = makeArchivedSkill();

    // 1. Query skill
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. Update skill (restore status, set embedding)
    mockSend.mockResolvedValueOnce({});
    // 3. Increment skill_count
    mockSend.mockResolvedValueOnce({});
    // 4. Audit record
    mockSend.mockResolvedValueOnce({});
    // 5. Check if problem is archived -> ConditionalCheckFailed (not archived)
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.skill.status).toBe("verified");
    expect(body.skill.skill_id).toBe(SKILL_ID);
  });

  it("regenerates embedding via Bedrock on unarchive", async () => {
    const skill = makeArchivedSkill();

    mockSend.mockResolvedValueOnce({ Items: [skill] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);

    await handler(makeEvent(SKILL_ID));

    // Bedrock was called for embedding generation
    expect(mockBedrockSend).toHaveBeenCalledTimes(1);
  });

  it("restores to previous_status stored on the skill", async () => {
    const skill = makeArchivedSkill({ previous_status: "partial" });

    mockSend.mockResolvedValueOnce({ Items: [skill] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);
    expect(body.skill.status).toBe("partial");
  });

  it("auto-unarchives parent problem if it was archived", async () => {
    const skill = makeArchivedSkill();

    // 1. Query skill
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. Update skill
    mockSend.mockResolvedValueOnce({});
    // 3. Increment skill_count
    mockSend.mockResolvedValueOnce({});
    // 4. Audit record for skill
    mockSend.mockResolvedValueOnce({});
    // 5. Update problem (unarchive) - succeeds (problem was archived)
    mockSend.mockResolvedValueOnce({});
    // 6. Audit record for problem unarchive
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);

    // 6 DynamoDB calls: query skill, update skill, increment count, skill audit, problem update, problem audit
    expect(mockSend).toHaveBeenCalledTimes(6);
  });

  it("emits a Kinesis event on successful unarchive", async () => {
    const skill = makeArchivedSkill();

    mockSend.mockResolvedValueOnce({ Items: [skill] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);

    await handler(makeEvent(SKILL_ID));

    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "unarchive",
        skill_id: SKILL_ID,
        success: true,
      }),
    );
  });
});
