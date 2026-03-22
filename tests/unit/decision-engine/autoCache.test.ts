/**
 * Unit tests for Decision Engine Rule 1: Auto-Cache Trigger.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before module imports
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

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { evaluateAutoCache } from "../../../src/decision-engine/rules/autoCache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock DynamoDBDocumentClient that delegates send() to mockSend.
 */
const makeMockClient = (): DynamoDBDocumentClient =>
  ({ send: mockSend }) as unknown as DynamoDBDocumentClient;

/**
 * Build a minimal skill record as DynamoDB would return it.
 */
const makeSkill = (overrides: Record<string, unknown> = {}) => ({
  skill_id: "skill-uuid-0001",
  version_number: 1,
  status: "verified",
  execution_count: 75,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("evaluateAutoCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Case 1: Skills with execution_count >= 50 and auto_cache unset → UpdateItem called
  // -------------------------------------------------------------------------
  it("calls UpdateItem for each skill with execution_count >= 50 and auto_cache unset", async () => {
    const client = makeMockClient();

    // The implementation queries all three statuses first, then updates.
    // Return one skill on the "verified" query, empty on the others.
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // query: partial
      .mockResolvedValueOnce({ Items: [makeSkill({ status: "verified", execution_count: 50 })] }) // query: verified
      .mockResolvedValueOnce({ Items: [] }) // query: optimized
      .mockResolvedValueOnce({}); // UpdateItem for the verified skill

    await evaluateAutoCache(client);

    // 3 Query calls + 1 UpdateItem = 4 total
    expect(mockSend).toHaveBeenCalledTimes(4);

    // The 4th call should be the UpdateItem
    const updateCall = mockSend.mock.calls[3][0] as { input: Record<string, unknown> };
    expect(updateCall.input["UpdateExpression"]).toContain("auto_cache = :true");
    expect(updateCall.input["Key"]).toEqual({ skill_id: "skill-uuid-0001", version_number: 1 });
  });

  // -------------------------------------------------------------------------
  // Case 2: Skills with execution_count < 50 → UpdateItem not called
  // -------------------------------------------------------------------------
  it("does not call UpdateItem for skills with execution_count < 50", async () => {
    const client = makeMockClient();

    // The FilterExpression on the Query excludes these; DynamoDB returns no items.
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // query: partial
      .mockResolvedValueOnce({ Items: [] }) // query: verified
      .mockResolvedValueOnce({ Items: [] }); // query: optimized

    await evaluateAutoCache(client);

    // Only 3 Query calls, no UpdateItem
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Case 3: Skills with auto_cache = true already → filtered out before UpdateItem
  // -------------------------------------------------------------------------
  it("does not call UpdateItem for skills already flagged with auto_cache = true", async () => {
    const client = makeMockClient();

    // The filter `auto_cache <> true` is applied on the Query side; DynamoDB
    // returns no items because the skill is already flagged.
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // query: partial (auto_cache skill excluded by filter)
      .mockResolvedValueOnce({ Items: [] }) // query: verified (same)
      .mockResolvedValueOnce({ Items: [] }); // query: optimized

    await evaluateAutoCache(client);

    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Case 4: ConditionalCheckFailedException during UpdateItem → caught silently
  // -------------------------------------------------------------------------
  it("catches ConditionalCheckFailedException silently and does not throw", async () => {
    const client = makeMockClient();

    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";

    mockSend
      .mockResolvedValueOnce({ Items: [] }) // query: partial
      .mockResolvedValueOnce({ Items: [makeSkill()] }) // query: verified — one matching skill
      .mockResolvedValueOnce({ Items: [] }) // query: optimized
      .mockRejectedValueOnce(condErr); // UpdateItem throws ConditionalCheckFailedException

    // Must not throw
    await expect(evaluateAutoCache(client)).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // Case 5: Multiple matching skills → UpdateItem called for each
  // -------------------------------------------------------------------------
  it("calls UpdateItem once per matching skill across all statuses", async () => {
    const client = makeMockClient();

    const partialSkill = makeSkill({
      skill_id: "skill-partial-001",
      version_number: 2,
      status: "partial",
      execution_count: 100,
    });
    const verifiedSkill = makeSkill({
      skill_id: "skill-verified-001",
      version_number: 1,
      status: "verified",
      execution_count: 60,
    });
    const optimizedSkill = makeSkill({
      skill_id: "skill-optimized-001",
      version_number: 3,
      status: "optimized",
      execution_count: 200,
    });

    // All three status queries happen first, then all three updates.
    mockSend
      .mockResolvedValueOnce({ Items: [partialSkill] }) // query: partial
      .mockResolvedValueOnce({ Items: [verifiedSkill] }) // query: verified
      .mockResolvedValueOnce({ Items: [optimizedSkill] }) // query: optimized
      .mockResolvedValueOnce({}) // UpdateItem for partialSkill
      .mockResolvedValueOnce({}) // UpdateItem for verifiedSkill
      .mockResolvedValueOnce({}); // UpdateItem for optimizedSkill

    await evaluateAutoCache(client);

    // 3 Query + 3 UpdateItem = 6 total
    expect(mockSend).toHaveBeenCalledTimes(6);

    // Verify each UpdateItem targets the correct skill
    const updateCalls = [
      mockSend.mock.calls[3][0] as { input: { Key: { skill_id: string; version_number: number } } },
      mockSend.mock.calls[4][0] as { input: { Key: { skill_id: string; version_number: number } } },
      mockSend.mock.calls[5][0] as { input: { Key: { skill_id: string; version_number: number } } },
    ];

    const updatedKeys = updateCalls.map((c) => c.input.Key);
    expect(updatedKeys).toContainEqual({ skill_id: "skill-partial-001", version_number: 2 });
    expect(updatedKeys).toContainEqual({ skill_id: "skill-verified-001", version_number: 1 });
    expect(updatedKeys).toContainEqual({ skill_id: "skill-optimized-001", version_number: 3 });
  });

  // -------------------------------------------------------------------------
  // Case 6: No matching skills → no UpdateItem calls, no error
  // -------------------------------------------------------------------------
  it("makes no UpdateItem calls and does not throw when no skills qualify", async () => {
    const client = makeMockClient();

    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    await expect(evaluateAutoCache(client)).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Additional: non-conditional errors from UpdateItem are re-thrown
  // -------------------------------------------------------------------------
  it("re-throws unexpected errors from UpdateItem", async () => {
    const client = makeMockClient();

    mockSend
      .mockResolvedValueOnce({ Items: [] }) // query: partial
      .mockResolvedValueOnce({ Items: [makeSkill()] }) // query: verified
      .mockResolvedValueOnce({ Items: [] }) // query: optimized
      .mockRejectedValueOnce(new Error("DynamoDB throttle")); // UpdateItem unexpected error

    await expect(evaluateAutoCache(client)).rejects.toThrow("DynamoDB throttle");
  });

  // -------------------------------------------------------------------------
  // Additional: paginated query results are fully consumed
  // -------------------------------------------------------------------------
  it("paginates through all query pages before updating", async () => {
    const client = makeMockClient();

    const skill1 = makeSkill({ skill_id: "skill-page1", version_number: 1 });
    const skill2 = makeSkill({ skill_id: "skill-page2", version_number: 1 });

    mockSend
      .mockResolvedValueOnce({ Items: [] }) // query: partial — no results
      // query: verified — page 1 with LastEvaluatedKey
      .mockResolvedValueOnce({
        Items: [skill1],
        LastEvaluatedKey: { skill_id: "skill-page1", status: "verified" },
      })
      // query: verified — page 2, no more pages
      .mockResolvedValueOnce({ Items: [skill2] })
      .mockResolvedValueOnce({ Items: [] }) // query: optimized — no results
      .mockResolvedValueOnce({}) // UpdateItem for skill1
      .mockResolvedValueOnce({}); // UpdateItem for skill2

    await evaluateAutoCache(client);

    // 1 (partial) + 2 (verified pages) + 1 (optimized) + 2 (updates) = 6
    expect(mockSend).toHaveBeenCalledTimes(6);
  });

  // -------------------------------------------------------------------------
  // Additional: UpdateItem uses correct ConditionExpression and attribute values
  // -------------------------------------------------------------------------
  it("uses ConditionExpression that prevents overwriting auto_cache = true", async () => {
    const client = makeMockClient();

    mockSend
      .mockResolvedValueOnce({ Items: [] }) // query: partial
      .mockResolvedValueOnce({ Items: [makeSkill()] }) // query: verified
      .mockResolvedValueOnce({ Items: [] }) // query: optimized
      .mockResolvedValueOnce({}); // UpdateItem

    await evaluateAutoCache(client);

    // Index 3 is the UpdateItem call
    const updateCall = mockSend.mock.calls[3][0] as {
      input: {
        ConditionExpression: string;
        ExpressionAttributeValues: Record<string, unknown>;
      };
    };
    expect(updateCall.input.ConditionExpression).toBe(
      "attribute_not_exists(auto_cache) OR auto_cache = :false",
    );
    expect(updateCall.input.ExpressionAttributeValues[":true"]).toBe(true);
    expect(updateCall.input.ExpressionAttributeValues[":false"]).toBe(false);
    expect(updateCall.input.ExpressionAttributeValues[":now"]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  // -------------------------------------------------------------------------
  // Additional: continues updating remaining skills after a ConditionalCheckFailedException
  // -------------------------------------------------------------------------
  it("continues updating remaining skills after a ConditionalCheckFailedException", async () => {
    const client = makeMockClient();

    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";

    const skill1 = makeSkill({ skill_id: "skill-first", version_number: 1 });
    const skill2 = makeSkill({ skill_id: "skill-second", version_number: 1 });

    mockSend
      .mockResolvedValueOnce({ Items: [] }) // query: partial
      .mockResolvedValueOnce({ Items: [skill1, skill2] }) // query: verified — two skills
      .mockResolvedValueOnce({ Items: [] }) // query: optimized
      .mockRejectedValueOnce(condErr) // UpdateItem for skill1 — already flagged
      .mockResolvedValueOnce({}); // UpdateItem for skill2 — succeeds

    await expect(evaluateAutoCache(client)).resolves.toBeUndefined();
    // 3 queries + 2 updates = 5
    expect(mockSend).toHaveBeenCalledTimes(5);
  });
});
