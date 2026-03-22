/**
 * Unit tests for src/validation/validateSkill.ts (POST /validate/:skill_id)
 */

import type { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "../../../src/validation/validateSkill.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDynamoSend = jest.fn();
const mockEmitEvent = jest.fn();
const mockRunTests = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: (...args: unknown[]) => mockDynamoSend(...args),
    }),
  },
  GetCommand: jest.fn().mockImplementation((input) => ({
    _type: "GetCommand",
    input,
  })),
  QueryCommand: jest.fn().mockImplementation((input) => ({
    _type: "QueryCommand",
    input,
  })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({
    _type: "UpdateCommand",
    input,
  })),
}));

jest.mock("@aws-sdk/client-kinesis", () => ({
  KinesisClient: jest.fn().mockImplementation(() => ({})),
  PutRecordCommand: jest.fn(),
}));

jest.mock("../../../src/shared/emitEvent.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

jest.mock("../../../src/validation/testRunner.js", () => ({
  runTests: (...args: unknown[]) => mockRunTests(...args),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SKILL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeEvent(
  skillId: string | null,
  body?: unknown,
): APIGatewayProxyEvent {
  return {
    body: body !== undefined ? JSON.stringify(body) : null,
    pathParameters: skillId !== null ? { skill_id: skillId } : null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: `/validate/${skillId ?? ""}`,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

function makeSkillItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    skill_id: SKILL_ID,
    version_number: 1,
    problem_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    name: "Two Sum",
    description: "Find two numbers that add to target",
    status: "verified",
    language: "python",
    implementation: "def solve(nums, target): return [0, 1]",
    confidence: 0.5,
    is_canonical: false,
    domain: ["arrays"],
    tags: ["easy"],
    inputs: [{ name: "nums", type: "number[]" }],
    outputs: [{ name: "indices", type: "number[]" }],
    examples: [],
    tests: [
      { input: { nums: [2, 7], target: 9 }, expected: { indices: [0, 1] } },
      { input: { nums: [3, 3], target: 6 }, expected: { indices: [0, 1] } },
      { input: { nums: [1, 2], target: 3 }, expected: { indices: [0, 1] } },
    ],
    latency_p50_ms: null,
    latency_p95_ms: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /validate/:skill_id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitEvent.mockResolvedValue(undefined);
    mockDynamoSend.mockResolvedValue({});
    // Default: stub throws (per ARCH-08 pending)
    mockRunTests.mockRejectedValue(
      new Error("Test runner not yet implemented — ARCH-08 pending"),
    );
  });

  // -------------------------------------------------------------------------
  // 1. Skill not found → 404
  // -------------------------------------------------------------------------
  it("returns 404 when skill is not found", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain(SKILL_ID);
  });

  // -------------------------------------------------------------------------
  // 2. Skill archived → 422
  // -------------------------------------------------------------------------
  it("returns 422 when skill is archived", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ status: "archived" })],
    });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(422);
    expect(body.error.code).toBe("SKILL_ARCHIVED");
  });

  // -------------------------------------------------------------------------
  // 3. Skill has no tests → 400
  // -------------------------------------------------------------------------
  it("returns 400 when skill has no tests (empty array)", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ tests: [] })],
    });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("NO_TESTS");
  });

  it("returns 400 when skill tests field is missing", async () => {
    const item = makeSkillItem();
    delete item.tests;
    mockDynamoSend.mockResolvedValueOnce({ Items: [item] });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("NO_TESTS");
  });

  // -------------------------------------------------------------------------
  // 4. Stub throws → propagates as 500 RUNNER_ERROR
  // -------------------------------------------------------------------------
  it("returns 500 RUNNER_ERROR when the test runner stub throws", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem()],
    });
    // mockRunTests is already set to throw in beforeEach

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.error.code).toBe("RUNNER_ERROR");
    expect(body.error.message).toContain("ARCH-08");
  });

  // -------------------------------------------------------------------------
  // 5. Success: passCount=3, failCount=0, latencyMs=100
  //    → confidence=1.0, UpdateItem called with correct values,
  //      Kinesis emitted, 200 returned
  // -------------------------------------------------------------------------
  it("all tests pass: confidence=1.0, UpdateItem correct, Kinesis emitted, 200", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem()], // Query: fetch skill
    });
    mockDynamoSend.mockResolvedValueOnce({}); // UpdateItem: persist results

    mockRunTests.mockResolvedValueOnce({
      passCount: 3,
      failCount: 0,
      latencyMs: 100,
    });

    const result = await handler(makeEvent(SKILL_ID));

    // Allow fire-and-forget promises to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.skill_id).toBe(SKILL_ID);
    expect(body.confidence).toBe(1.0);
    expect(body.pass_count).toBe(3);
    expect(body.fail_count).toBe(0);
    expect(body.latency_ms).toBe(100);

    // Verify UpdateCommand was constructed with correct expression values
    const { UpdateCommand } = jest.requireMock("@aws-sdk/lib-dynamodb");
    const updateCall = (UpdateCommand as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const exprValues = updateCall.ExpressionAttributeValues as Record<
      string,
      unknown
    >;

    expect(exprValues[":conf"]).toBe(1.0);
    expect(exprValues[":pass"]).toBe(3);
    expect(exprValues[":fail"]).toBe(0);
    expect(typeof exprValues[":now"]).toBe("string");

    // All tests passed + latency <= 5000ms → REMOVE needs_optimization
    const updateExpr = updateCall.UpdateExpression as string;
    expect(updateExpr).toContain("REMOVE needs_optimization");

    // Correct DynamoDB key
    const key = updateCall.Key as Record<string, unknown>;
    expect(key.skill_id).toBe(SKILL_ID);
    expect(key.version_number).toBe(1);

    // Kinesis event emitted
    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "validate",
        skill_id: SKILL_ID,
        confidence: 1.0,
        success: true,
        cache_hit: false,
        input_hash: null,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 6. Partial pass: passCount=2, failCount=1, total=3 → confidence≈0.666...
  // -------------------------------------------------------------------------
  it("partial pass: confidence=2/3, test_fail_count=1, no REMOVE needs_optimization", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem()],
    });
    mockDynamoSend.mockResolvedValueOnce({});

    mockRunTests.mockResolvedValueOnce({
      passCount: 2,
      failCount: 1,
      latencyMs: 200,
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.confidence).toBeCloseTo(2 / 3, 5);
    expect(body.pass_count).toBe(2);
    expect(body.fail_count).toBe(1);

    // failCount > 0 → must NOT clear needs_optimization
    const { UpdateCommand } = jest.requireMock("@aws-sdk/lib-dynamodb");
    const updateCall = (UpdateCommand as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const updateExpr = updateCall.UpdateExpression as string;
    expect(updateExpr).not.toContain("REMOVE needs_optimization");

    // Verify fail count stored correctly
    const exprValues = updateCall.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(exprValues[":fail"]).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 7. All fail: passCount=0, failCount=5, total=5 → confidence=0.0
  // -------------------------------------------------------------------------
  it("all tests fail: confidence=0.0", async () => {
    const skillWith5Tests = makeSkillItem({
      tests: [
        { input: {}, expected: {} },
        { input: {}, expected: {} },
        { input: {}, expected: {} },
        { input: {}, expected: {} },
        { input: {}, expected: {} },
      ],
    });
    mockDynamoSend.mockResolvedValueOnce({ Items: [skillWith5Tests] });
    mockDynamoSend.mockResolvedValueOnce({});

    mockRunTests.mockResolvedValueOnce({
      passCount: 0,
      failCount: 5,
      latencyMs: 50,
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.confidence).toBe(0.0);
    expect(body.pass_count).toBe(0);
    expect(body.fail_count).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 8. Kinesis emit failure does not fail the request
  // -------------------------------------------------------------------------
  it("Kinesis emit failure does not fail the request", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem()],
    });
    mockDynamoSend.mockResolvedValueOnce({});

    mockRunTests.mockResolvedValueOnce({
      passCount: 3,
      failCount: 0,
      latencyMs: 100,
    });

    mockEmitEvent.mockRejectedValue(new Error("Kinesis unavailable"));

    const result = await handler(makeEvent(SKILL_ID));

    await Promise.resolve();
    await Promise.resolve();

    // Request must still succeed despite Kinesis failure
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.confidence).toBe(1.0);
  });
});
