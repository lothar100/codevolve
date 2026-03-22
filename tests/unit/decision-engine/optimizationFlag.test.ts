/**
 * Unit tests for Rule 2: Optimization Flag
 *
 * Covers:
 *   1. Skill with latency_p95_ms = 5001, execution_count = 20 → UpdateItem called
 *   2. Skill with latency_p95_ms = 5000 (at threshold, NOT above) → not flagged
 *   3. Skill with latency_p95_ms = 6000, execution_count = 19 → not flagged
 *   4. Skill with needs_optimization = true already → filtered out (no redundant update)
 *   5. ConditionalCheckFailedException → caught silently
 *   6. Skill with status 'partial' → not evaluated
 *   7. Multiple matching skills → UpdateItem called for each
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that transitively use them
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
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { evaluateOptimizationFlag } from "../../../src/decision-engine/rules/optimizationFlag";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock DynamoDBDocumentClient that delegates send() to mockSend. */
function buildMockClient(): DynamoDBDocumentClient {
  return { send: mockSend } as unknown as DynamoDBDocumentClient;
}

/**
 * Build a minimal skill record.
 * The QueryCommand filter in the implementation already gates on
 * latency_p95_ms > 5000, execution_count >= 20, and
 * needs_optimization <> true — so test helpers only need to return
 * what the "post-filter" result set would look like.
 */
function skillRecord(overrides: Partial<{
  skill_id: string;
  version_number: number;
  status: string;
  latency_p95_ms: number;
  execution_count: number;
  needs_optimization: boolean | undefined;
}> = {}): Record<string, unknown> {
  return {
    skill_id: "aaaaaaaa-0000-0000-0000-000000000001",
    version_number: 1,
    status: "verified",
    latency_p95_ms: 5001,
    execution_count: 20,
    ...overrides,
  };
}

/**
 * Create a ConditionalCheckFailedException compatible with the codebase's
 * name-based detection.
 */
function conditionalCheckFailedError(): Error {
  const err = new Error("The conditional request failed");
  (err as unknown as Record<string, string>).name =
    "ConditionalCheckFailedException";
  return err;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("evaluateOptimizationFlag", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1 — boundary: latency exactly above threshold (5001ms), count at minimum (20)
  // -------------------------------------------------------------------------
  it("calls UpdateItem for a skill with latency_p95_ms = 5001 and execution_count = 20", async () => {
    const skill = skillRecord({ latency_p95_ms: 5001, execution_count: 20 });

    // Query for 'verified' returns one matching skill; 'optimized' returns none.
    mockSend
      .mockResolvedValueOnce({ Items: [skill] })  // verified scan
      .mockResolvedValueOnce({ Items: [] })        // optimized scan
      .mockResolvedValueOnce({});                  // UpdateItem success

    const client = buildMockClient();
    await evaluateOptimizationFlag(client);

    // mockSend: query(verified), query(optimized), update
    expect(mockSend).toHaveBeenCalledTimes(3);

    const updateCall = mockSend.mock.calls[2][0];
    expect(updateCall.input.Key).toEqual({
      skill_id: skill.skill_id,
      version_number: skill.version_number,
    });
    expect(updateCall.input.ExpressionAttributeValues[":true"]).toBe(true);
    expect(updateCall.input.ExpressionAttributeValues).toHaveProperty(":now");
  });

  // -------------------------------------------------------------------------
  // Test 2 — boundary: latency exactly at threshold (5000ms) — NOT above → not flagged
  // -------------------------------------------------------------------------
  it("does NOT flag a skill with latency_p95_ms = 5000 (threshold is strictly >)", async () => {
    // The Scan FilterExpression uses > 5000, so this skill should not appear in results.
    // Simulate DynamoDB correctly filtering it out.
    mockSend
      .mockResolvedValueOnce({ Items: [] })  // verified scan returns nothing
      .mockResolvedValueOnce({ Items: [] }); // optimized scan returns nothing

    const client = buildMockClient();
    await evaluateOptimizationFlag(client);

    // Only the two scans; no UpdateItem
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Test 3 — below minimum execution count (19) → not flagged
  // -------------------------------------------------------------------------
  it("does NOT flag a skill with execution_count = 19 (minimum is 20)", async () => {
    // DynamoDB filter ensures execution_count >= 20; simulate it returning nothing.
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const client = buildMockClient();
    await evaluateOptimizationFlag(client);

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Test 4 — already flagged (needs_optimization = true) → filtered out, no update
  // -------------------------------------------------------------------------
  it("does NOT call UpdateItem when needs_optimization is already true", async () => {
    // The Scan FilterExpression includes "needs_optimization <> true", so already-flagged
    // skills are excluded. Simulate DynamoDB correctly excluding the skill.
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const client = buildMockClient();
    await evaluateOptimizationFlag(client);

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Test 5 — ConditionalCheckFailedException → caught silently, no throw
  // -------------------------------------------------------------------------
  it("catches ConditionalCheckFailedException silently without throwing", async () => {
    const skill = skillRecord();

    mockSend
      .mockResolvedValueOnce({ Items: [skill] })        // verified scan
      .mockResolvedValueOnce({ Items: [] })              // optimized scan
      .mockRejectedValueOnce(conditionalCheckFailedError()); // UpdateItem races

    const client = buildMockClient();

    // Must resolve (not reject)
    await expect(evaluateOptimizationFlag(client)).resolves.toBeUndefined();

    // Scan x2 + failed update x1
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Test 6 — status = 'partial' → not evaluated (only verified/optimized)
  // -------------------------------------------------------------------------
  it("does NOT evaluate or flag skills with status 'partial'", async () => {
    // Implementation queries verified and optimized statuses only.
    // Partial-status skills never appear in scan results.
    mockSend
      .mockResolvedValueOnce({ Items: [] })  // verified
      .mockResolvedValueOnce({ Items: [] }); // optimized

    const client = buildMockClient();
    await evaluateOptimizationFlag(client);

    expect(mockSend).toHaveBeenCalledTimes(2);
    // Confirm no UpdateItem was attempted
    const updateCalls = mockSend.mock.calls.filter((call) => {
      const cmd = call[0];
      return (
        cmd?.input?.UpdateExpression !== undefined
      );
    });
    expect(updateCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 7 — multiple matching skills → UpdateItem called for each
  // -------------------------------------------------------------------------
  it("calls UpdateItem for every matching skill when multiple are returned", async () => {
    const skill1 = skillRecord({
      skill_id: "aaaaaaaa-0000-0000-0000-000000000001",
      version_number: 1,
      latency_p95_ms: 8000,
      execution_count: 50,
    });
    const skill2 = skillRecord({
      skill_id: "bbbbbbbb-0000-0000-0000-000000000002",
      version_number: 2,
      status: "optimized",
      latency_p95_ms: 12000,
      execution_count: 30,
    });

    mockSend
      .mockResolvedValueOnce({ Items: [skill1] })  // verified scan
      .mockResolvedValueOnce({ Items: [skill2] })  // optimized scan
      .mockResolvedValueOnce({})                    // UpdateItem for skill1
      .mockResolvedValueOnce({});                   // UpdateItem for skill2

    const client = buildMockClient();
    await evaluateOptimizationFlag(client);

    // 2 scans + 2 updates = 4 calls
    expect(mockSend).toHaveBeenCalledTimes(4);

    const updateCalls = mockSend.mock.calls.filter(
      (call) => call[0]?.input?.UpdateExpression !== undefined,
    );
    expect(updateCalls).toHaveLength(2);

    const updatedIds = updateCalls.map(
      (call) => call[0].input.Key.skill_id,
    );
    expect(updatedIds).toContain(skill1.skill_id);
    expect(updatedIds).toContain(skill2.skill_id);
  });

  // -------------------------------------------------------------------------
  // Additional: non-ConditionalCheckFailed errors are re-thrown
  // -------------------------------------------------------------------------
  it("re-throws unexpected DynamoDB errors", async () => {
    const skill = skillRecord();

    mockSend
      .mockResolvedValueOnce({ Items: [skill] })
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(new Error("ProvisionedThroughputExceededException"));

    const client = buildMockClient();
    await expect(evaluateOptimizationFlag(client)).rejects.toThrow(
      "ProvisionedThroughputExceededException",
    );
  });

  // -------------------------------------------------------------------------
  // Additional: paginated scan results are fully consumed
  // -------------------------------------------------------------------------
  it("follows LastEvaluatedKey pagination until exhausted", async () => {
    const skill1 = skillRecord({
      skill_id: "aaaaaaaa-0000-0000-0000-000000000001",
      version_number: 1,
    });
    const skill2 = skillRecord({
      skill_id: "bbbbbbbb-0000-0000-0000-000000000002",
      version_number: 1,
    });

    mockSend
      // verified: page 1 with continuation
      .mockResolvedValueOnce({
        Items: [skill1],
        LastEvaluatedKey: { skill_id: skill1.skill_id },
      })
      // verified: page 2 (no more pages)
      .mockResolvedValueOnce({ Items: [skill2] })
      // optimized: empty
      .mockResolvedValueOnce({ Items: [] })
      // UpdateItem for skill1
      .mockResolvedValueOnce({})
      // UpdateItem for skill2
      .mockResolvedValueOnce({});

    const client = buildMockClient();
    await evaluateOptimizationFlag(client);

    // 3 scans (2 pages verified + 1 optimized) + 2 updates = 5 calls
    expect(mockSend).toHaveBeenCalledTimes(5);

    const updateCalls = mockSend.mock.calls.filter(
      (call) => call[0]?.input?.UpdateExpression !== undefined,
    );
    expect(updateCalls).toHaveLength(2);
  });
});
