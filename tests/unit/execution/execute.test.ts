/**
 * Unit tests for src/execution/execute.ts (POST /execute handler)
 */

import { handler } from "../../../src/execution/execute.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDynamoSend = jest.fn();
const mockInvokeRunner = jest.fn();
const mockGetCachedOutput = jest.fn();
const mockWriteCachedOutput = jest.fn();
const mockIncrementCacheHit = jest.fn();
const mockEmitEvent = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: (...args: unknown[]) => mockDynamoSend(...args),
    }),
  },
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: "QueryCommand", input })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: "UpdateCommand", input })),
}));

jest.mock("../../../src/execution/runners.js", () => ({
  getRunnerFunctionName: jest.fn().mockReturnValue("codevolve-runner-python312"),
  invokeRunner: (...args: unknown[]) => mockInvokeRunner(...args),
}));

jest.mock("../../../src/cache/cache.js", () => ({
  getCachedOutput: (...args: unknown[]) => mockGetCachedOutput(...args),
  writeCachedOutput: (...args: unknown[]) => mockWriteCachedOutput(...args),
  incrementCacheHit: (...args: unknown[]) => mockIncrementCacheHit(...args),
}));

jest.mock("../../../src/shared/emitEvent.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

jest.mock("@aws-sdk/client-kinesis", () => ({
  KinesisClient: jest.fn().mockImplementation(() => ({})),
  PutRecordCommand: jest.fn(),
}));

jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("exec-uuid-0000-0000-0000-000000000001"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/execute",
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

function makeSkillItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    skill_id: SKILL_ID,
    version_number: 1,
    status: "verified",
    language: "python",
    implementation: "def solve(nums, target): return [0, 1]",
    confidence: 0.9,
    auto_cache: false,
    latency_p50_ms: null,
    latency_p95_ms: null,
    inputs: [{ name: "nums", type: "number[]" }, { name: "target", type: "number" }],
    outputs: [{ name: "indices", type: "number[]" }],
    ...overrides,
  };
}

const validBody = {
  skill_id: SKILL_ID,
  inputs: { nums: [2, 7, 11, 15], target: 9 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /execute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitEvent.mockResolvedValue(undefined);
    mockWriteCachedOutput.mockResolvedValue(undefined);
    mockIncrementCacheHit.mockResolvedValue(undefined);
    mockDynamoSend.mockResolvedValue({}); // default: UpdateCommand succeeds
  });

  // -------------------------------------------------------------------------
  // 1. Cache HIT — returns cached output, sets cache_hit: true, does NOT invoke runner
  // -------------------------------------------------------------------------
  it("cache hit returns cached output with cache_hit: true and does not invoke runner", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem()],
    });
    mockGetCachedOutput.mockResolvedValueOnce({
      output: { indices: [0, 1] },
      version_number: 1,
      hit_count: 0,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.cache_hit).toBe(true);
    expect(body.outputs).toEqual({ indices: [0, 1] });
    expect(body.skill_id).toBe(SKILL_ID);
    expect(body.input_hash).toEqual(expect.any(String));
    expect(body.version).toBe(1);
    expect(mockInvokeRunner).not.toHaveBeenCalled();
    expect(mockIncrementCacheHit).toHaveBeenCalledWith(SKILL_ID, expect.any(String));
  });

  // -------------------------------------------------------------------------
  // 2. Cache MISS — invokes runner Lambda, returns output with cache_hit: false
  // -------------------------------------------------------------------------
  it("cache miss invokes runner Lambda and returns output with cache_hit: false", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ indices: [0, 1] }),
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.cache_hit).toBe(false);
    expect(body.outputs).toEqual({ indices: [0, 1] });
    expect(body.input_hash).toEqual(expect.any(String));
    expect(body.version).toBe(1);
    expect(mockInvokeRunner).toHaveBeenCalledTimes(1);
    expect(mockWriteCachedOutput).not.toHaveBeenCalled(); // auto_cache: false
  });

  // -------------------------------------------------------------------------
  // 3. skip_cache: true — bypasses cache check, always invokes runner
  // -------------------------------------------------------------------------
  it("skip_cache: true bypasses cache check and invokes runner", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ indices: [0, 1] }),
    });

    const result = await handler(makeEvent({ ...validBody, skip_cache: true }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(mockGetCachedOutput).not.toHaveBeenCalled();
    expect(mockInvokeRunner).toHaveBeenCalledTimes(1);
    expect(body.cache_hit).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. Runner returns error_type: "timeout" → 408 EXECUTION_TIMEOUT
  // -------------------------------------------------------------------------
  it("runner error_type timeout → 408 EXECUTION_TIMEOUT", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ error: "execution timed out", error_type: "timeout" }),
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(408);
    expect(body.error.code).toBe("EXECUTION_TIMEOUT");
  });

  // -------------------------------------------------------------------------
  // 5. Runner returns error_type: "runtime" → 422 EXECUTION_FAILED with sanitized error_detail
  // -------------------------------------------------------------------------
  it("runner error_type runtime → 422 EXECUTION_FAILED with sanitized error", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({
        error: "NameError: name 'undefined_var' is not defined",
        error_type: "runtime",
      }),
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(422);
    expect(body.error.code).toBe("EXECUTION_FAILED");
  });

  // -------------------------------------------------------------------------
  // 6. Runner returns error_type: "oom" → 504 EXECUTION_OOM
  // -------------------------------------------------------------------------
  it("runner error_type oom → 504 EXECUTION_OOM", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ error: "Out of memory", error_type: "oom" }),
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(504);
    expect(body.error.code).toBe("EXECUTION_OOM");
  });

  // -------------------------------------------------------------------------
  // 7. Lambda FunctionError set (timeout pattern) → 408
  // -------------------------------------------------------------------------
  it("Lambda FunctionError set with timeout pattern → 408 EXECUTION_TIMEOUT", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: "Unhandled",
      payload: JSON.stringify({
        errorType: "States.Timeout",
        errorMessage: "Task timed out after 10.00 seconds",
      }),
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(408);
    expect(body.error.code).toBe("EXECUTION_TIMEOUT");
  });

  // -------------------------------------------------------------------------
  // 8. Unsupported language → 400 VALIDATION_ERROR UNSUPPORTED_LANGUAGE
  // -------------------------------------------------------------------------
  it("unsupported language returns 400 VALIDATION_ERROR", async () => {
    const { getRunnerFunctionName } = jest.requireMock("../../../src/execution/runners.js");
    (getRunnerFunctionName as jest.Mock).mockReturnValueOnce({
      type: "UNSUPPORTED_LANGUAGE",
      language: "cobol",
    });

    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem({ language: "cobol" })] });
    mockGetCachedOutput.mockResolvedValueOnce(null);

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("Unsupported language");
  });

  // -------------------------------------------------------------------------
  // 9. Skill not found → 404
  // -------------------------------------------------------------------------
  it("skill not found returns 404", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // 10. Skill archived → 404
  // -------------------------------------------------------------------------
  it("archived skill returns 404", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ status: "archived" })],
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("archived");
  });

  // -------------------------------------------------------------------------
  // 11. auto_cache: true → writeCachedOutput called after successful execution
  // -------------------------------------------------------------------------
  it("auto_cache: true causes writeCachedOutput to be called after success", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ auto_cache: true })],
    });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ indices: [0, 1] }),
    });

    const result = await handler(makeEvent(validBody));
    expect(result.statusCode).toBe(200);

    // Allow fire-and-forget promises to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(mockWriteCachedOutput).toHaveBeenCalledWith({
      skill_id: SKILL_ID,
      input_hash: expect.any(String),
      version_number: 1,
      output: { indices: [0, 1] },
      input_snapshot: { nums: [2, 7, 11, 15], target: 9 },
    });
  });

  // -------------------------------------------------------------------------
  // 12. auto_cache: false → writeCachedOutput NOT called
  // -------------------------------------------------------------------------
  it("auto_cache: false means writeCachedOutput is not called", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkillItem({ auto_cache: false })],
    });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ indices: [0, 1] }),
    });

    const result = await handler(makeEvent(validBody));
    expect(result.statusCode).toBe(200);

    await Promise.resolve();
    await Promise.resolve();

    expect(mockWriteCachedOutput).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Additional: Invalid JSON body → 400
  // -------------------------------------------------------------------------
  it("invalid JSON body returns 400", async () => {
    const event = makeEvent(validBody);
    event.body = "not-json";

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  // -------------------------------------------------------------------------
  // Additional: Missing required input field → 422
  // -------------------------------------------------------------------------
  it("missing required input field returns 422", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    // Only provide 'nums', missing 'target'
    const result = await handler(makeEvent({ skill_id: SKILL_ID, inputs: { nums: [2, 7] } }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("target");
  });

  // -------------------------------------------------------------------------
  // Additional: Kinesis event emitted on success
  // -------------------------------------------------------------------------
  it("emits execute event on successful cache miss execution", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ indices: [0, 1] }),
    });

    await handler(makeEvent(validBody));

    await Promise.resolve();
    await Promise.resolve();

    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "execute",
        skill_id: SKILL_ID,
        cache_hit: false,
        success: true,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Additional: Response shape includes execution_id
  // -------------------------------------------------------------------------
  it("successful response includes execution_id", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [makeSkillItem()] });
    mockGetCachedOutput.mockResolvedValueOnce(null);
    mockInvokeRunner.mockResolvedValueOnce({
      functionError: undefined,
      payload: JSON.stringify({ indices: [0, 1] }),
    });

    const result = await handler(makeEvent(validBody));
    const body = JSON.parse(result.body);

    expect(body.execution_id).toBe("exec-uuid-0000-0000-0000-000000000001");
  });
});
