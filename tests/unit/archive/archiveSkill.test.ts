/**
 * Unit tests for POST /skills/:id/archive handler.
 */

import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
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

import { handler } from "../../../src/archive/archiveSkill";

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
  version_label: "0.1.0",
  is_canonical: false,
  status: "verified",
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
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-01T00:00:00.000Z",
  ...overrides,
});

const makeEvent = (skillId: string): APIGatewayProxyEvent =>
  ({
    pathParameters: { id: skillId },
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: `/skills/${skillId}/archive`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  }) as APIGatewayProxyEvent;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("archiveSkill handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 for invalid skill ID", async () => {
    const result = await handler(makeEvent("not-a-uuid"));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when skill does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
  });

  it("returns 409 when skill is already archived", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeSkill({ status: "archived" })],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe("CONFLICT");
  });

  it("returns 422 when skill is canonical", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeSkill({ is_canonical: true })],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("PRECONDITION_FAILED");
  });

  it("returns 409 when skill has active execution lock", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeSkill({ active_execution_lock: "lock-id" })],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe("CONFLICT");
  });

  it("successfully archives a skill and returns 200", async () => {
    const skill = makeSkill();

    // 1. Query skill (latest version)
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. UpdateCommand (archive skill + nullify embedding)
    mockSend.mockResolvedValueOnce({ Attributes: { ...skill, status: "archived" } });
    // 3. QueryCommand (cache invalidation - no entries)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // 4. UpdateCommand (decrement skill_count)
    mockSend.mockResolvedValueOnce({});
    // 5. PutCommand (audit record)
    mockSend.mockResolvedValueOnce({});
    // 6. QueryCommand (check all skills for problem - GSI-problem-status)
    mockSend.mockResolvedValueOnce({
      Items: [
        { status: "archived" },
        { status: "verified" }, // Not all archived
      ],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.skill.status).toBe("archived");
    expect(body.skill.skill_id).toBe(SKILL_ID);
  });

  it("invalidates cache entries for the skill", async () => {
    const skill = makeSkill();

    // 1. Query skill
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. Update skill
    mockSend.mockResolvedValueOnce({});
    // 3. Query cache - returns entries
    mockSend.mockResolvedValueOnce({
      Items: [
        { skill_id: SKILL_ID, input_hash: "hash1" },
        { skill_id: SKILL_ID, input_hash: "hash2" },
      ],
    });
    // 4. BatchWrite to delete cache entries
    mockSend.mockResolvedValueOnce({});
    // 5. Decrement skill_count
    mockSend.mockResolvedValueOnce({});
    // 6. Audit record
    mockSend.mockResolvedValueOnce({});
    // 7. Check all skills for problem
    mockSend.mockResolvedValueOnce({ Items: [{ status: "archived" }, { status: "partial" }] });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);

    // Verify BatchWriteCommand was called (4th call)
    expect(mockSend).toHaveBeenCalledTimes(7);
  });

  it("auto-archives problem when all skills are archived", async () => {
    const skill = makeSkill();

    // 1. Query skill
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. Update skill
    mockSend.mockResolvedValueOnce({});
    // 3. Query cache - no entries
    mockSend.mockResolvedValueOnce({ Items: [] });
    // 4. Decrement skill_count
    mockSend.mockResolvedValueOnce({});
    // 5. Audit record for skill
    mockSend.mockResolvedValueOnce({});
    // 6. Query all skills for problem - all archived
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }, { status: "archived" }],
    });
    // 7. Update problem to archived
    mockSend.mockResolvedValueOnce({});
    // 8. Audit record for problem
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);

    // Verify problem archive update was called
    expect(mockSend).toHaveBeenCalledTimes(8);
  });

  it("succeeds when skill_count is already 0 (floor guard)", async () => {
    const skill = makeSkill();

    // 1. Query skill
    mockSend.mockResolvedValueOnce({ Items: [skill] });
    // 2. Update skill
    mockSend.mockResolvedValueOnce({});
    // 3. Query cache - no entries
    mockSend.mockResolvedValueOnce({ Items: [] });
    // 4. Decrement skill_count fails with ConditionalCheckFailedException
    //    (skill_count is already 0 — floor guard condition "#skill_count > :zero" fails)
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);
    // 5. Audit record
    mockSend.mockResolvedValueOnce({});
    // 6. Check all skills for problem
    mockSend.mockResolvedValueOnce({ Items: [{ status: "archived" }, { status: "partial" }] });

    const result = await handler(makeEvent(SKILL_ID));
    // Archive should succeed — the floor guard silently ignores the 0-count condition failure
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).skill.status).toBe("archived");
  });

  it("emits a Kinesis event on successful archive", async () => {
    const skill = makeSkill();

    mockSend.mockResolvedValueOnce({ Items: [skill] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Items: [{ status: "archived" }, { status: "partial" }] });

    await handler(makeEvent(SKILL_ID));

    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "archive",
        skill_id: SKILL_ID,
        success: true,
      }),
    );
  });
});
