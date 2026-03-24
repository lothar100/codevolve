/**
 * Unit tests for src/validation/handler.ts (POST /validate/:skill_id)
 */

import { handler } from "../../../src/validation/handler.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDynamoSend = jest.fn();
const mockInvokeRunner = jest.fn();
const mockGetRunnerFunctionName = jest.fn();
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

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockSqsSend(...args),
  })),
  SendMessageCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "SendMessageCommand", input })),
}));

jest.mock("../../../src/execution/runners.js", () => ({
  getRunnerFunctionName: (...args: unknown[]) =>
    mockGetRunnerFunctionName(...args),
  invokeRunner: (...args: unknown[]) => mockInvokeRunner(...args),
}));

jest.mock("../../../src/shared/emitEvent.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

jest.mock("@aws-sdk/client-kinesis", () => ({
  KinesisClient: jest.fn().mockImplementation(() => ({})),
  PutRecordCommand: jest.fn(),
  PutRecordsCommand: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  skillId: string,
  body: Record<string, unknown> = {},
): APIGatewayProxyEvent {
  return {
    pathParameters: { skill_id: skillId },
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: `/validate/${skillId}`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

const SKILL_ID = "00000000-0000-0000-0000-000000000001";

const BASE_SKILL = {
  skill_id: SKILL_ID,
  version_number: 1,
  status: "partial",
  language: "python",
  implementation: "def solve(x): return x * 2",
  confidence: 0,
  latency_p50_ms: null,
  latency_p95_ms: null,
  tests: [
    { input: { x: 2 }, expected: { result: 4 } },
    { input: { x: 3 }, expected: { result: 6 } },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitEvent.mockResolvedValue(undefined);
  mockSqsSend.mockResolvedValue({});
  mockGetRunnerFunctionName.mockReturnValue("codevolve-runner-python312");
});

describe("POST /validate/:skill_id handler", () => {
  // -------------------------------------------------------------------------
  // 400 — missing skill_id
  // -------------------------------------------------------------------------

  it("returns 400 when skill_id path parameter is missing", async () => {
    const event = makeEvent(SKILL_ID);
    // Override pathParameters to be empty
    const noPathEvent = { ...event, pathParameters: null };

    const result = await handler(
      noPathEvent as unknown as APIGatewayProxyEvent,
    );

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // -------------------------------------------------------------------------
  // 404 — skill not found
  // -------------------------------------------------------------------------

  it("returns 404 when skill does not exist", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // 409 — skill archived
  // -------------------------------------------------------------------------

  it("returns 409 when skill is archived", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [{ ...BASE_SKILL, status: "archived" }],
    });

    const result = await handler(makeEvent(SKILL_ID));

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("SKILL_ARCHIVED");
  });

  // -------------------------------------------------------------------------
  // 400 — no tests defined (WARNING-03 fix: code must be NO_TESTS_DEFINED)
  // -------------------------------------------------------------------------

  it("returns 400 NO_TESTS_DEFINED when skill has no tests", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [{ ...BASE_SKILL, tests: [] }],
    });

    const result = await handler(makeEvent(SKILL_ID));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("NO_TESTS_DEFINED");
  });

  // -------------------------------------------------------------------------
  // 500 — DynamoDB fetch error
  // -------------------------------------------------------------------------

  it("returns 500 when DynamoDB fetch throws", async () => {
    mockDynamoSend.mockRejectedValueOnce(new Error("DynamoDB down"));

    const result = await handler(makeEvent(SKILL_ID));

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  // -------------------------------------------------------------------------
  // Successful validation — all tests pass
  // -------------------------------------------------------------------------

  it("returns 200 with full pass when all tests pass", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] }) // GetItem
      .mockResolvedValueOnce({}); // UpdateItem

    // Runner returns correct output for both tests
    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    const result = await handler(makeEvent(SKILL_ID));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      pass_count: number;
      fail_count: number;
      confidence: number;
      status: string;
      results: Array<{ passed: boolean }>;
    };
    expect(body.pass_count).toBe(2);
    expect(body.fail_count).toBe(0);
    expect(body.confidence).toBe(1.0);
    expect(body.status).toBe("verified");
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r) => r.passed)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Kinesis event — success field reflects actual outcome (WARNING-02 fix)
  // -------------------------------------------------------------------------

  it("emits Kinesis event with success: false when tests fail (WARNING-02 fix)", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockResolvedValueOnce({});

    // First test passes, second fails
    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 99 }), // wrong
      });

    await handler(makeEvent(SKILL_ID));

    // emitEvent must have been called with success: false
    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it("emits Kinesis event with success: true when all tests pass", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockResolvedValueOnce({});

    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    await handler(makeEvent(SKILL_ID));

    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  // -------------------------------------------------------------------------
  // Partial pass — mixed results
  // -------------------------------------------------------------------------

  it("returns partial results with correct counts when some tests fail", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockResolvedValueOnce({});

    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 999 }), // wrong
      });

    const result = await handler(makeEvent(SKILL_ID));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      pass_count: number;
      fail_count: number;
      confidence: number;
    };
    expect(body.pass_count).toBe(1);
    expect(body.fail_count).toBe(1);
    expect(body.confidence).toBe(0.5);
  });

  // -------------------------------------------------------------------------
  // Status transitions
  // -------------------------------------------------------------------------

  it("transitions partial → verified when confidence >= 0.85 and fail_count === 0", async () => {
    const skill = {
      ...BASE_SKILL,
      status: "partial",
      tests: [
        { input: { x: 1 }, expected: { r: 2 } },
        { input: { x: 2 }, expected: { r: 4 } },
        { input: { x: 3 }, expected: { r: 6 } },
        { input: { x: 4 }, expected: { r: 8 } },
        { input: { x: 5 }, expected: { r: 10 } },
        { input: { x: 6 }, expected: { r: 12 } },
        { input: { x: 7 }, expected: { r: 14 } },
      ],
    };
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [skill] })
      .mockResolvedValueOnce({});

    // All 7 tests pass — confidence = 1.0
    for (let i = 1; i <= 7; i++) {
      mockInvokeRunner.mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ r: i * 2 }),
      });
    }

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body) as { status: string; confidence: number };

    expect(result.statusCode).toBe(200);
    expect(body.confidence).toBe(1.0);
    // partial → optimized is not allowed in one step; goes to verified first
    // But since it starts at partial and hits 1.0, it goes to verified (not optimized)
    expect(body.status).toBe("verified");
  });

  it("transitions verified → optimized when confidence === 1.0", async () => {
    const skill = {
      ...BASE_SKILL,
      status: "verified",
      tests: [{ input: { x: 1 }, expected: { r: 2 } }],
    };
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [skill] })
      .mockResolvedValueOnce({});

    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ r: 2 }),
    });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body) as { status: string };

    expect(result.statusCode).toBe(200);
    expect(body.status).toBe("optimized");
  });

  it("reverts verified → partial when confidence drops below 0.85", async () => {
    const skill = {
      ...BASE_SKILL,
      status: "verified",
      tests: [
        { input: { x: 1 }, expected: { r: 2 } },
        { input: { x: 2 }, expected: { r: 4 } },
      ],
    };
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [skill] })
      .mockResolvedValueOnce({});

    // First passes, second fails → confidence = 0.5
    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ r: 2 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ r: 999 }),
      });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body) as { status: string };

    expect(result.statusCode).toBe(200);
    expect(body.status).toBe("partial");
  });

  // -------------------------------------------------------------------------
  // GapQueue trigger
  // -------------------------------------------------------------------------

  it("sends to GapQueue when confidence < 0.7", async () => {
    // Set GAP_QUEUE_URL so the send is triggered
    process.env.GAP_QUEUE_URL = "https://sqs.example.com/gap-queue";

    const skill = {
      ...BASE_SKILL,
      tests: [
        { input: { x: 1 }, expected: { r: 2 } },
        { input: { x: 2 }, expected: { r: 4 } },
      ],
    };
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [skill] })
      .mockResolvedValueOnce({});

    // Both tests fail → confidence = 0
    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ r: 999 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ r: 999 }),
      });

    await handler(makeEvent(SKILL_ID));

    // Give fire-and-forget a tick to run
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSqsSend).toHaveBeenCalled();

    delete process.env.GAP_QUEUE_URL;
  });

  it("does not send to GapQueue when confidence >= 0.7", async () => {
    process.env.GAP_QUEUE_URL = "https://sqs.example.com/gap-queue";

    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockResolvedValueOnce({});

    // Both tests pass → confidence = 1.0
    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    await handler(makeEvent(SKILL_ID));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSqsSend).not.toHaveBeenCalled();

    delete process.env.GAP_QUEUE_URL;
  });

  // -------------------------------------------------------------------------
  // Runner errors
  // -------------------------------------------------------------------------

  it("counts test as failed when runner returns functionError", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockResolvedValueOnce({});

    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: "Unhandled",
        payload: JSON.stringify({ errorMessage: "crash" }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body) as {
      pass_count: number;
      fail_count: number;
    };

    expect(result.statusCode).toBe(200);
    expect(body.pass_count).toBe(1);
    expect(body.fail_count).toBe(1);
  });

  it("counts test as failed when runner invocation throws", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockResolvedValueOnce({});

    mockInvokeRunner
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body) as {
      pass_count: number;
      fail_count: number;
    };

    expect(result.statusCode).toBe(200);
    expect(body.fail_count).toBe(1);
  });

  it("counts test as failed when runner returns invalid JSON", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockResolvedValueOnce({});

    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: "not-valid-json",
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body) as { fail_count: number };

    expect(result.statusCode).toBe(200);
    expect(body.fail_count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // optimization_flagged removal
  // -------------------------------------------------------------------------

  it("includes REMOVE optimization_flagged in UpdateExpression when latency_p95 <= 5000", async () => {
    const skill = {
      ...BASE_SKILL,
      latency_p95_ms: 3000,
      optimization_flagged: true,
    };

    mockDynamoSend
      .mockResolvedValueOnce({ Items: [skill] })
      .mockResolvedValueOnce({});

    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    await handler(makeEvent(SKILL_ID));

    // Check UpdateCommand was called with REMOVE optimization_flagged
    const updateCall = mockDynamoSend.mock.calls[1][0] as {
      input: { UpdateExpression: string };
    };
    expect(updateCall.input.UpdateExpression).toContain(
      "REMOVE optimization_flagged",
    );
  });

  it("does NOT include REMOVE optimization_flagged when latency_p95 > 5000", async () => {
    const skill = {
      ...BASE_SKILL,
      latency_p95_ms: 8000,
      optimization_flagged: true,
    };

    mockDynamoSend
      .mockResolvedValueOnce({ Items: [skill] })
      .mockResolvedValueOnce({});

    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    await handler(makeEvent(SKILL_ID));

    const updateCall = mockDynamoSend.mock.calls[1][0] as {
      input: { UpdateExpression: string };
    };
    expect(updateCall.input.UpdateExpression).not.toContain(
      "REMOVE optimization_flagged",
    );
  });

  // -------------------------------------------------------------------------
  // 500 — DynamoDB update error
  // -------------------------------------------------------------------------

  it("returns 500 when DynamoDB UpdateItem throws", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockRejectedValueOnce(new Error("DynamoDB write failed"));

    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    const result = await handler(makeEvent(SKILL_ID));

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  it("returns required fields in response body", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [BASE_SKILL] })
      .mockResolvedValueOnce({});

    mockInvokeRunner
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 4 }),
      })
      .mockResolvedValueOnce({
        functionError: undefined,
        payload: JSON.stringify({ result: 6 }),
      });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body) as Record<string, unknown>;

    expect(body).toHaveProperty("skill_id", SKILL_ID);
    expect(body).toHaveProperty("version", 1);
    expect(body).toHaveProperty("total_tests", 2);
    expect(body).toHaveProperty("pass_count");
    expect(body).toHaveProperty("fail_count");
    expect(body).toHaveProperty("confidence");
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("last_validated_at");
    expect(body).toHaveProperty("results");
  });
});
