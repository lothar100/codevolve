/**
 * Unit tests for src/validation/validateSkill.ts (POST /validate/:skill_id)
 */

import { handler } from "../../../src/validation/validateSkill.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that trigger module evaluation
// ---------------------------------------------------------------------------

const mockDynamoSend = jest.fn();
const mockRunTests = jest.fn();
const mockEmitEvent = jest.fn();
const mockSqsSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: (...args: unknown[]) => mockDynamoSend(...args),
    }),
  },
  QueryCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "QueryCommand", input })),
  UpdateCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "UpdateCommand", input })),
}));

jest.mock("../../../src/validation/testRunner.js", () => ({
  runTests: (...args: unknown[]) => mockRunTests(...args),
}));

jest.mock("../../../src/shared/emitEvent.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockSqsSend(...args),
  })),
  SendMessageCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "SendMessageCommand", input })),
}));

jest.mock("@aws-sdk/client-kinesis", () => ({
  KinesisClient: jest.fn().mockImplementation(() => ({})),
  PutRecordCommand: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SKILL_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeEvent(
  body: unknown,
  skillId: string | null = SKILL_ID,
): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    pathParameters: skillId ? { skill_id: skillId } : null,
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

function makeSkillItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    skill_id: SKILL_ID,
    version_number: 1,
    status: "partial",
    language: "python",
    implementation: "def solve(n): return n * 2",
    confidence: 0.5,
    latency_p50_ms: null,
    latency_p95_ms: null,
    inputs: [{ name: "n", type: "number" }],
    outputs: [{ name: "result", type: "number" }],
    tests: [
      { input: { n: 2 }, expected: { result: 4 } },
      { input: { n: 3 }, expected: { result: 6 } },
    ],
    ...overrides,
  };
}

function makeRunTestsResult(overrides: Partial<{
  passCount: number;
  failCount: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  results: unknown[];
}> = {}) {
  return {
    results: [
      {
        test_index: 0,
        input: { n: 2 },
        expected: { result: 4 },
        actual: { result: 4 },
        passed: true,
        latency_ms: 100,
        error: null,
      },
      {
        test_index: 1,
        input: { n: 3 },
        expected: { result: 6 },
        actual: { result: 6 },
        passed: true,
        latency_ms: 110,
        error: null,
      },
    ],
    passCount: 2,
    failCount: 0,
    latencyP50Ms: 105,
    latencyP95Ms: 110,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitEvent.mockResolvedValue(undefined);
  mockSqsSend.mockResolvedValue({ MessageId: "msg-001" });
  // Default DynamoDB: UpdateCommand succeeds silently (fire-and-forget)
  mockDynamoSend.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// 1. Happy path — all tests pass, confidence → verified
// ---------------------------------------------------------------------------

describe("POST /validate/:skill_id", () => {
  it("returns 200 with correct summary when all tests pass", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(makeRunTestsResult());

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.skill_id).toBe(SKILL_ID);
    expect(body.version).toBe(1);
    expect(body.pass_count).toBe(2);
    expect(body.fail_count).toBe(0);
    expect(body.total_tests).toBe(2);
    expect(body.new_confidence).toBeCloseTo(1.0);
    expect(body.new_status).toBe("verified");
    expect(body.previous_confidence).toBe(0.5);
    expect(body.latency_p50_ms).toBe(105);
    expect(body.latency_p95_ms).toBe(110);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 2. Status transition: confidence === 0 → unsolved
  // -------------------------------------------------------------------------
  it("confidence=0 sets status to unsolved", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ status: "partial", confidence: 0.5 })],
    });
    mockRunTests.mockResolvedValueOnce(
      makeRunTestsResult({ passCount: 0, failCount: 2 }),
    );

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.new_confidence).toBe(0);
    expect(body.new_status).toBe("unsolved");
  });

  // -------------------------------------------------------------------------
  // 3. Status transition: 0 < confidence < 0.85 → partial
  // -------------------------------------------------------------------------
  it("confidence=0.5 sets status to partial", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkillItem({
          status: "unsolved",
          confidence: 0,
          tests: [
            { input: { n: 2 }, expected: { result: 4 } },
            { input: { n: 3 }, expected: { result: 6 } },
          ],
        }),
      ],
    });
    // 1 of 2 tests pass → confidence 0.5
    mockRunTests.mockResolvedValueOnce(
      makeRunTestsResult({ passCount: 1, failCount: 1 }),
    );

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.new_confidence).toBeCloseTo(0.5);
    expect(body.new_status).toBe("partial");
  });

  // -------------------------------------------------------------------------
  // 4. Status transition: confidence >= 0.85 → verified (exact 0.85)
  // -------------------------------------------------------------------------
  it("confidence=0.85 (17/20 passing) sets status to verified", async () => {
    const twentyTests = Array.from({ length: 20 }, (_, i) => ({
      input: { n: i },
      expected: { result: i * 2 },
    }));
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ status: "partial", confidence: 0.5, tests: twentyTests })],
    });
    // 17 of 20 pass → 0.85
    const results = twentyTests.map((t, i) => ({
      test_index: i,
      input: t.input,
      expected: t.expected,
      actual: i < 17 ? t.expected : null,
      passed: i < 17,
      latency_ms: 50,
      error: i < 17 ? null : "mismatch",
    }));
    mockRunTests.mockResolvedValueOnce({
      results,
      passCount: 17,
      failCount: 3,
      latencyP50Ms: 50,
      latencyP95Ms: 50,
    });

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.new_confidence).toBeCloseTo(0.85);
    expect(body.new_status).toBe("verified");
  });

  // -------------------------------------------------------------------------
  // 5. confidence=1.0 (all pass) → verified (not optimized — only promote-canonical sets that)
  // -------------------------------------------------------------------------
  it("confidence=1.0 sets status to verified, not optimized", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(makeRunTestsResult());

    const result = await handler(makeEvent({}));
    const body = JSON.parse(result.body);
    expect(body.new_status).toBe("verified");
  });

  // -------------------------------------------------------------------------
  // 6. Timeout budget: runTests returns timeout-failed tests → handled gracefully
  // -------------------------------------------------------------------------
  it("handles timeout-failed tests returned by runTests gracefully", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    // Simulate: only 1 of 2 tests ran; second was marked failed with validation_timeout
    mockRunTests.mockResolvedValueOnce({
      results: [
        {
          test_index: 0,
          input: { n: 2 },
          expected: { result: 4 },
          actual: { result: 4 },
          passed: true,
          latency_ms: 100,
          error: null,
        },
        {
          test_index: 1,
          input: { n: 3 },
          expected: { result: 6 },
          actual: null,
          passed: false,
          latency_ms: 0,
          error: "validation_timeout",
        },
      ],
      passCount: 1,
      failCount: 1,
      latencyP50Ms: 50,
      latencyP95Ms: 100,
    });

    const result = await handler(makeEvent({ timeout_ms: 5000 }));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.pass_count).toBe(1);
    expect(body.fail_count).toBe(1);
    // 1/2 = 0.5 → partial
    expect(body.new_confidence).toBeCloseTo(0.5);
    expect(body.new_status).toBe("partial");
  });

  // -------------------------------------------------------------------------
  // 7. Evolve trigger fires when confidence < 0.7
  // -------------------------------------------------------------------------
  it("sends message to evolve gap queue when confidence < 0.7", async () => {
    process.env.EVOLVE_GAP_QUEUE_URL = "https://sqs.us-east-2.amazonaws.com/123/evolve-gap";

    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    // 1 of 2 pass → confidence 0.5 < 0.7
    mockRunTests.mockResolvedValueOnce(
      makeRunTestsResult({ passCount: 1, failCount: 1 }),
    );

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(200);

    // Allow fire-and-forget to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    const sentCommand = mockSqsSend.mock.calls[0][0];
    const messageBody = JSON.parse(sentCommand.input.MessageBody as string);
    expect(messageBody.skill_id).toBe(SKILL_ID);
    expect(messageBody.reason).toBe("confidence_below_threshold");

    delete process.env.EVOLVE_GAP_QUEUE_URL;
  });

  // -------------------------------------------------------------------------
  // 8. Evolve trigger does NOT fire when confidence >= 0.7
  // -------------------------------------------------------------------------
  it("does NOT send to evolve gap queue when confidence >= 0.7", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    // All pass → confidence 1.0
    mockRunTests.mockResolvedValueOnce(makeRunTestsResult());

    await handler(makeEvent({}));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. optimization_flagged REMOVE — included in UpdateExpression when p95 <= 5000
  // -------------------------------------------------------------------------
  it("includes REMOVE optimization_flagged in update when latencyP95Ms <= 5000", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(
      makeRunTestsResult({ latencyP95Ms: 4999 }),
    );

    await handler(makeEvent({}));
    await Promise.resolve();

    const updateCall = mockDynamoSend.mock.calls.find(
      (call) => call[0]._type === "UpdateCommand",
    );
    expect(updateCall).toBeDefined();
    const updateExpression: string = updateCall![0].input.UpdateExpression;
    expect(updateExpression).toContain("REMOVE optimization_flagged");
  });

  // -------------------------------------------------------------------------
  // 10. optimization_flagged REMOVE — omitted when p95 > 5000
  // -------------------------------------------------------------------------
  it("omits REMOVE optimization_flagged when latencyP95Ms > 5000", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(
      makeRunTestsResult({ latencyP95Ms: 5001 }),
    );

    await handler(makeEvent({}));
    await Promise.resolve();

    const updateCall = mockDynamoSend.mock.calls.find(
      (call) => call[0]._type === "UpdateCommand",
    );
    expect(updateCall).toBeDefined();
    const updateExpression: string = updateCall![0].input.UpdateExpression;
    expect(updateExpression).not.toContain("REMOVE optimization_flagged");
  });

  // -------------------------------------------------------------------------
  // 11. Exactly at boundary p95 === 5000 → REMOVE is included
  // -------------------------------------------------------------------------
  it("includes REMOVE optimization_flagged when latencyP95Ms is exactly 5000", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(
      makeRunTestsResult({ latencyP95Ms: 5000 }),
    );

    await handler(makeEvent({}));
    await Promise.resolve();

    const updateCall = mockDynamoSend.mock.calls.find(
      (call) => call[0]._type === "UpdateCommand",
    );
    const updateExpression: string = updateCall![0].input.UpdateExpression;
    expect(updateExpression).toContain("REMOVE optimization_flagged");
  });

  // -------------------------------------------------------------------------
  // 12. additional_tests merged into run (body param)
  // -------------------------------------------------------------------------
  it("merges additional_tests from request body into the test run", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(makeRunTestsResult());

    const additionalTests = [{ input: { n: 10 }, expected: { result: 20 } }];
    await handler(makeEvent({ additional_tests: additionalTests }));

    // runTests should have been called with a skill whose tests include the extra one
    expect(mockRunTests).toHaveBeenCalledTimes(1);
    const calledSkill = mockRunTests.mock.calls[0][0];
    expect(calledSkill.tests).toHaveLength(3); // 2 original + 1 additional
    expect(calledSkill.tests[2]).toEqual(additionalTests[0]);
  });

  // -------------------------------------------------------------------------
  // 13. timeout_ms passed through to runTests
  // -------------------------------------------------------------------------
  it("passes timeout_ms from request body to runTests", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(makeRunTestsResult());

    await handler(makeEvent({ timeout_ms: 60000 }));

    expect(mockRunTests).toHaveBeenCalledWith(expect.anything(), 60000);
  });

  // -------------------------------------------------------------------------
  // 14. Skill not found → 404
  // -------------------------------------------------------------------------
  it("returns 404 when skill does not exist", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // 15. Archived skill → 404
  // -------------------------------------------------------------------------
  it("returns 404 for archived skill", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ status: "archived" })],
    });

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
    expect(JSON.parse(result.body).error.message).toContain("archived");
  });

  // -------------------------------------------------------------------------
  // 16. Missing skill_id path parameter → 400
  // -------------------------------------------------------------------------
  it("returns 400 when skill_id path parameter is missing", async () => {
    const result = await handler(makeEvent({}, null));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  // -------------------------------------------------------------------------
  // 17. Invalid JSON body → 400
  // -------------------------------------------------------------------------
  it("returns 400 for invalid JSON body", async () => {
    const event = makeEvent({});
    event.body = "not-json{{";
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  // -------------------------------------------------------------------------
  // 18. Unsupported language → runTests throws → 400
  // -------------------------------------------------------------------------
  it("returns 400 when runTests throws for unsupported language", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ language: "cobol" })],
    });
    mockRunTests.mockRejectedValueOnce(
      new Error("Unsupported language for validation: cobol"),
    );

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("UNSUPPORTED_LANGUAGE");
  });

  // -------------------------------------------------------------------------
  // 19. runTests throws for non-language reason → 500
  // -------------------------------------------------------------------------
  it("returns 500 when runTests throws for an unexpected reason", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockRejectedValueOnce(new Error("Lambda service error"));

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe("INTERNAL_ERROR");
  });

  // -------------------------------------------------------------------------
  // 20. Zero tests → confidence 0, status unsolved
  // -------------------------------------------------------------------------
  it("returns confidence=0 and status=unsolved when skill has no tests", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ tests: [] })],
    });
    mockRunTests.mockResolvedValueOnce({
      results: [],
      passCount: 0,
      failCount: 0,
      latencyP50Ms: 0,
      latencyP95Ms: 0,
    });

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.new_confidence).toBe(0);
    expect(body.new_status).toBe("unsolved");
    expect(body.total_tests).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 21. DynamoDB fetch throws → 500
  // -------------------------------------------------------------------------
  it("returns 500 when DynamoDB fetch throws", async () => {
    mockDynamoSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe("INTERNAL_ERROR");
  });

  // -------------------------------------------------------------------------
  // 22. Analytics event emitted on success
  // -------------------------------------------------------------------------
  it("emits validate analytics event after successful run", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(makeRunTestsResult());

    await handler(makeEvent({}));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "validate",
        skill_id: SKILL_ID,
        success: true,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 23. previous_confidence reflected in response
  // -------------------------------------------------------------------------
  it("reflects previous_confidence from the fetched skill record", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ confidence: 0.42 })],
    });
    mockRunTests.mockResolvedValueOnce(makeRunTestsResult());

    const result = await handler(makeEvent({}));
    const body = JSON.parse(result.body);
    expect(body.previous_confidence).toBe(0.42);
  });

  // -------------------------------------------------------------------------
  // 24. UpdateCommand includes test_pass_count and test_fail_count
  // -------------------------------------------------------------------------
  it("writes test_pass_count and test_fail_count to DynamoDB", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockRunTests.mockResolvedValueOnce(
      makeRunTestsResult({ passCount: 2, failCount: 0 }),
    );

    await handler(makeEvent({}));
    await Promise.resolve();

    const updateCall = mockDynamoSend.mock.calls.find(
      (call) => call[0]._type === "UpdateCommand",
    );
    expect(updateCall).toBeDefined();
    const exprValues = updateCall![0].input.ExpressionAttributeValues;
    expect(exprValues[":passCount"]).toBe(2);
    expect(exprValues[":failCount"]).toBe(0);
  });
});
