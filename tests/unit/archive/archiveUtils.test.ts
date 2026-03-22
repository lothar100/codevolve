/**
 * Unit tests for archive utility functions.
 */

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

import {
  invalidateCacheForSkill,
  archiveProblemIfAllSkillsArchived,
  writeArchiveAuditRecord,
  generateEmbedding,
  unarchiveProblemIfArchived,
} from "../../../src/archive/archiveUtils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SKILL_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROBLEM_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ---------------------------------------------------------------------------
// Tests: invalidateCacheForSkill
// ---------------------------------------------------------------------------

describe("invalidateCacheForSkill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 0 when no cache entries exist", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const count = await invalidateCacheForSkill(SKILL_ID);
    expect(count).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("deletes all cache entries in a single batch", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      skill_id: SKILL_ID,
      input_hash: `hash-${i}`,
    }));

    // Query returns 5 items
    mockSend.mockResolvedValueOnce({ Items: items });
    // BatchWrite succeeds
    mockSend.mockResolvedValueOnce({});

    const count = await invalidateCacheForSkill(SKILL_ID);
    expect(count).toBe(5);
  });

  it("handles multiple batches when more than 25 items", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      skill_id: SKILL_ID,
      input_hash: `hash-${i}`,
    }));

    // Query returns 30 items, no pagination
    mockSend.mockResolvedValueOnce({ Items: items });
    // First BatchWrite (25 items)
    mockSend.mockResolvedValueOnce({});
    // Second BatchWrite (5 items)
    mockSend.mockResolvedValueOnce({});

    const count = await invalidateCacheForSkill(SKILL_ID);
    expect(count).toBe(30);
    // 1 query + 2 batch writes
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("handles paginated query results", async () => {
    const page1Items = Array.from({ length: 3 }, (_, i) => ({
      skill_id: SKILL_ID,
      input_hash: `hash-p1-${i}`,
    }));
    const page2Items = Array.from({ length: 2 }, (_, i) => ({
      skill_id: SKILL_ID,
      input_hash: `hash-p2-${i}`,
    }));

    // First page with LastEvaluatedKey
    mockSend.mockResolvedValueOnce({
      Items: page1Items,
      LastEvaluatedKey: { skill_id: SKILL_ID, input_hash: "hash-p1-2" },
    });
    // BatchWrite for first page
    mockSend.mockResolvedValueOnce({});
    // Second page with no LastEvaluatedKey
    mockSend.mockResolvedValueOnce({ Items: page2Items });
    // BatchWrite for second page
    mockSend.mockResolvedValueOnce({});

    const count = await invalidateCacheForSkill(SKILL_ID);
    expect(count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Tests: archiveProblemIfAllSkillsArchived
// ---------------------------------------------------------------------------

describe("archiveProblemIfAllSkillsArchived", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns false when no skills exist for the problem", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await archiveProblemIfAllSkillsArchived(PROBLEM_ID);
    expect(result).toBe(false);
  });

  it("returns false when not all skills are archived", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }, { status: "verified" }],
    });

    const result = await archiveProblemIfAllSkillsArchived(PROBLEM_ID);
    expect(result).toBe(false);
    // Only 1 call (the query); no update attempted
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("archives problem when all skills are archived", async () => {
    // Query all skills for problem
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }, { status: "archived" }],
    });
    // Update problem to archived
    mockSend.mockResolvedValueOnce({});
    // Audit record
    mockSend.mockResolvedValueOnce({});

    const result = await archiveProblemIfAllSkillsArchived(PROBLEM_ID);
    expect(result).toBe(true);

    // Emits archive event for the problem
    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "archive",
        intent: `problem_archived:${PROBLEM_ID}`,
        success: true,
      }),
    );
  });

  it("returns false when problem is already archived (idempotent)", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }],
    });
    // Update fails with ConditionalCheckFailedException (already archived)
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);

    const result = await archiveProblemIfAllSkillsArchived(PROBLEM_ID);
    expect(result).toBe(false);
  });

  it("paginates through multiple query pages before evaluating all-archived", async () => {
    // Page 1: all archived, but there are more pages
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }, { status: "archived" }],
      LastEvaluatedKey: { problem_id: PROBLEM_ID, status: "archived#v2" },
    });
    // Page 2: one non-archived skill — should prevent problem archival
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "verified" }],
    });

    const result = await archiveProblemIfAllSkillsArchived(PROBLEM_ID);
    expect(result).toBe(false);
    // 2 query calls (two pages), no update attempted
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("archives problem when all skills across multiple pages are archived", async () => {
    // Page 1: archived skills with more pages
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }],
      LastEvaluatedKey: { problem_id: PROBLEM_ID, status: "archived#v1" },
    });
    // Page 2: also all archived, no more pages
    mockSend.mockResolvedValueOnce({
      Items: [{ status: "archived" }, { status: "archived" }],
    });
    // Update problem to archived
    mockSend.mockResolvedValueOnce({});
    // Audit record
    mockSend.mockResolvedValueOnce({});

    const result = await archiveProblemIfAllSkillsArchived(PROBLEM_ID);
    expect(result).toBe(true);
    // 2 query pages + 1 update + 1 audit = 4 calls
    expect(mockSend).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// Tests: writeArchiveAuditRecord
// ---------------------------------------------------------------------------

describe("writeArchiveAuditRecord", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes an audit record with required fields", async () => {
    mockSend.mockResolvedValueOnce({});

    await writeArchiveAuditRecord({
      entityId: SKILL_ID,
      entityType: "skill",
      action: "archive",
      reason: "manual",
      triggeredBy: "api_manual",
      previousStatus: "verified",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.input.Item.entity_id).toBe(SKILL_ID);
    expect(putCall.input.Item.entity_type).toBe("skill");
    expect(putCall.input.Item.action).toBe("archive");
    expect(putCall.input.Item.reason).toBe("manual");
    expect(putCall.input.Item.triggered_by).toBe("api_manual");
    expect(putCall.input.Item.previous_status).toBe("verified");
  });

  it("includes optional metadata and skill_version", async () => {
    mockSend.mockResolvedValueOnce({});

    await writeArchiveAuditRecord({
      entityId: SKILL_ID,
      entityType: "skill",
      action: "archive",
      reason: "staleness_90d",
      triggeredBy: "decision_engine",
      previousStatus: "verified",
      skillVersion: 3,
      metadata: { days_since_last_execution: 95 },
    });

    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.input.Item.skill_version).toBe("3");
    expect(putCall.input.Item.metadata).toEqual({ days_since_last_execution: 95 });
  });

  it("omits metadata and skill_version when not provided", async () => {
    mockSend.mockResolvedValueOnce({});

    await writeArchiveAuditRecord({
      entityId: PROBLEM_ID,
      entityType: "problem",
      action: "archive",
      reason: "all_skills_archived",
      triggeredBy: "system",
      previousStatus: "active",
    });

    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.input.Item.metadata).toBeUndefined();
    expect(putCall.input.Item.skill_version).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: generateEmbedding
// ---------------------------------------------------------------------------

describe("generateEmbedding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns embedding vector from Bedrock response", async () => {
    const fakeEmbedding = new Array(1024).fill(0.5);
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({ embedding: fakeEmbedding })),
    });

    const result = await generateEmbedding("test text");
    expect(result).toEqual(fakeEmbedding);
    expect(result).toHaveLength(1024);
  });

  it("passes inputText to Bedrock model", async () => {
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1] })),
    });

    await generateEmbedding("Two Sum Find two numbers arrays easy");

    expect(mockBedrockSend).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: unarchiveProblemIfArchived
// ---------------------------------------------------------------------------

describe("unarchiveProblemIfArchived", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("unarchives the problem when it is currently archived", async () => {
    // Update problem succeeds (problem was archived)
    mockSend.mockResolvedValueOnce({});
    // Audit record
    mockSend.mockResolvedValueOnce({});

    const result = await unarchiveProblemIfArchived(PROBLEM_ID);
    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("returns false when problem is not archived", async () => {
    // Update fails with ConditionalCheckFailedException
    const condErr = new Error("Condition not met");
    (condErr as unknown as Record<string, string>).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(condErr);

    const result = await unarchiveProblemIfArchived(PROBLEM_ID);
    expect(result).toBe(false);
  });

  it("propagates non-conditional errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB throttle"));

    await expect(unarchiveProblemIfArchived(PROBLEM_ID)).rejects.toThrow("DynamoDB throttle");
  });
});
