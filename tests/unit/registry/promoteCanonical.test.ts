/**
 * Unit tests for POST /skills/:skill_id/promote-canonical handler.
 *
 * Test cases per IMPL-13 spec:
 *  1. Happy path: confidence=0.85, test_fail_count=0, previous canonical exists
 *     → TransactWriteItems called with both demote + promote, Kinesis event emitted, 200
 *  2. Happy path: no previous canonical → TransactWriteItems with only promote, 200
 *  3. confidence=0.84 → 422 with confidence in details
 *  4. test_fail_count=1 → 422 with test_fail_count in details
 *  5. Skill not found → 404
 *  6. Skill archived → 422
 *  7. Already canonical → 200 (idempotent, no-op)
 *  8. Kinesis emit failure does not fail the request (fire-and-forget)
 */

import { handler } from "../../../src/registry/promoteCanonical.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDocSend = jest.fn();
const mockEmitEvent = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest
      .fn()
      .mockReturnValue({ send: (...args: unknown[]) => mockDocSend(...args) }),
  },
  QueryCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "QueryCommand", input })),
  TransactWriteCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "TransactWriteCommand", input })),
}));

jest.mock("../../../src/shared/emitEvent.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
  EVENTS_STREAM: "codevolve-events",
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SKILL_ID = "22222222-2222-2222-2222-222222222222";
const PROBLEM_ID = "11111111-1111-1111-1111-111111111111";
const PREV_CANONICAL_ID = "33333333-3333-3333-3333-333333333333";

function makeEvent(pathId: string): APIGatewayProxyEvent {
  return {
    body: null,
    // CDK registers the route with {id} path param
    pathParameters: { id: pathId },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: `/skills/${pathId}/promote-canonical`,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

/** Minimal valid skill item stored in DynamoDB */
const validSkillItem = {
  skill_id: SKILL_ID,
  version_number: 1,
  problem_id: PROBLEM_ID,
  name: "Two Sum Hash Map",
  description: "O(n) solution using hash map",
  is_canonical: false,
  status: "verified",
  language: "python",
  domain: ["arrays"],
  tags: ["hash-map"],
  inputs: [{ name: "nums", type: "number[]" }, { name: "target", type: "number" }],
  outputs: [{ name: "indices", type: "number[]" }],
  examples: [],
  tests: [{ input: { nums: [2, 7], target: 9 }, expected: { indices: [0, 1] } }],
  test_fail_count: 0,
  implementation: "def two_sum(nums, target): ...",
  confidence: 0.9,
  latency_p50_ms: 10,
  latency_p95_ms: 25,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const prevCanonicalItem = {
  ...validSkillItem,
  skill_id: PREV_CANONICAL_ID,
  version_number: 2,
  is_canonical: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /skills/:skill_id/promote-canonical", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitEvent.mockResolvedValue(undefined);
  });

  // ---------- Test 1: Happy path — previous canonical exists ----------

  it("promotes skill and demotes previous canonical when one exists", async () => {
    // call 1: fetch latest skill version
    mockDocSend.mockResolvedValueOnce({ Items: [validSkillItem] });
    // call 2: query GSI-problem-status for existing canonical
    mockDocSend.mockResolvedValueOnce({ Items: [prevCanonicalItem] });
    // call 3: TransactWriteCommand
    mockDocSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.is_canonical).toBe(true);
    expect(body.skill.skill_id).toBe(SKILL_ID);
    expect(body.demoted_skill_id).toBe(PREV_CANONICAL_ID);

    // TransactWriteCommand was called
    const { TransactWriteCommand } = jest.requireMock("@aws-sdk/lib-dynamodb");
    expect(TransactWriteCommand).toHaveBeenCalledTimes(1);
    const callArg = TransactWriteCommand.mock.calls[0][0];
    // Should have 3 items: promote + problem update + demote
    expect(callArg.TransactItems).toHaveLength(3);

    // Kinesis event emitted
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "promote_canonical",
        skill_id: SKILL_ID,
        success: true,
      }),
    );
  });

  // ---------- Test 2: Happy path — no previous canonical ----------

  it("promotes skill when no previous canonical exists for the problem", async () => {
    // call 1: fetch latest skill version
    mockDocSend.mockResolvedValueOnce({ Items: [validSkillItem] });
    // call 2: query GSI-problem-status — no canonical found
    mockDocSend.mockResolvedValueOnce({ Items: [] });
    // call 3: TransactWriteCommand
    mockDocSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.is_canonical).toBe(true);
    expect(body.demoted_skill_id).toBeNull();

    // TransactWriteCommand should have only 2 items: promote + problem update
    const { TransactWriteCommand } = jest.requireMock("@aws-sdk/lib-dynamodb");
    expect(TransactWriteCommand).toHaveBeenCalledTimes(1);
    const callArg = TransactWriteCommand.mock.calls[0][0];
    expect(callArg.TransactItems).toHaveLength(2);
  });

  // ---------- Test 3: Confidence too low ----------

  it("returns 422 with confidence in details when confidence < 0.85", async () => {
    mockDocSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, confidence: 0.84 }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(422);
    expect(body.error.code).toBe("PRECONDITION_FAILED");
    expect(body.error.details).toHaveProperty("confidence", 0.84);
  });

  // ---------- Test 4: Failing tests ----------

  it("returns 422 with test_fail_count in details when test_fail_count > 0", async () => {
    mockDocSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, test_fail_count: 1 }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(422);
    expect(body.error.code).toBe("PRECONDITION_FAILED");
    expect(body.error.details).toHaveProperty("test_fail_count", 1);
  });

  // ---------- Test 5: Skill not found ----------

  it("returns 404 when the skill does not exist", async () => {
    mockDocSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  // ---------- Test 6: Skill archived ----------

  it("returns 422 when the skill is archived", async () => {
    mockDocSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, status: "archived" }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(422);
    expect(body.error.code).toBe("PRECONDITION_FAILED");
  });

  // ---------- Test 7: Already canonical — idempotent 200 ----------

  it("returns 200 idempotently when skill is already canonical", async () => {
    mockDocSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, is_canonical: true }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.is_canonical).toBe(true);
    expect(body.demoted_skill_id).toBeNull();

    // No TransactWrite should be called for an idempotent no-op
    const { TransactWriteCommand } = jest.requireMock("@aws-sdk/lib-dynamodb");
    expect(TransactWriteCommand).not.toHaveBeenCalled();

    // No Kinesis event for no-op
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  // ---------- Test 8: Kinesis failure does not crash the handler ----------

  it("returns 200 even when Kinesis emit throws", async () => {
    mockDocSend.mockResolvedValueOnce({ Items: [validSkillItem] });
    mockDocSend.mockResolvedValueOnce({ Items: [] });
    mockDocSend.mockResolvedValueOnce({});

    // Make emitEvent throw
    mockEmitEvent.mockRejectedValueOnce(new Error("Kinesis unavailable"));

    const result = await handler(makeEvent(SKILL_ID));

    expect(result.statusCode).toBe(200);
  });

  // ---------- Additional edge cases ----------

  it("returns 400 for an invalid UUID path parameter", async () => {
    const result = await handler(makeEvent("not-a-uuid"));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 on unexpected DynamoDB error", async () => {
    mockDocSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("uses exactly confidence=0.85 as the passing threshold", async () => {
    mockDocSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, confidence: 0.85 }],
    });
    mockDocSend.mockResolvedValueOnce({ Items: [] });
    mockDocSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);
  });
});
