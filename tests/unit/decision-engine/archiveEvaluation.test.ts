/**
 * Unit tests for Rule 4: Archive Evaluation → ArchiveQueue
 *
 * All three clients (DynamoDB, SQS, Kinesis) are mocked.
 * Tests cover the 23-hour gate, all exemptions, all triggers,
 * per-cycle limit, dry-run mode, and archive_warning emission.
 */

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

const mockDynamoSend = jest.fn();
const mockSQSSend = jest.fn();
const mockKinesisSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockDynamoSend }),
  },
  GetCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  ScanCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  QueryCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  PutCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: mockSQSSend })),
  SendMessageCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

jest.mock("@aws-sdk/client-kinesis", () => ({
  KinesisClient: jest.fn().mockImplementation(() => ({ send: mockKinesisSend })),
  PutRecordCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { KinesisClient } from "@aws-sdk/client-kinesis";
import { evaluateArchive } from "../../../src/decision-engine/rules/archiveEvaluation";

// ---------------------------------------------------------------------------
// Client instances (mocked)
// ---------------------------------------------------------------------------

const dynamoClient = DynamoDBDocumentClient.from({} as never);
const sqsClient = new SQSClient({});
const kinesisClient = new KinesisClient({});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SKILL_ID_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const SKILL_ID_2 = "aaaaaaaa-0000-0000-0000-000000000002";
const PROBLEM_ID_1 = "bbbbbbbb-0000-0000-0000-000000000001";

/** Returns a timestamp that is `daysAgo` days in the past */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Returns a timestamp that is `hoursAgo` hours in the past */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function makeSkill(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    skill_id: SKILL_ID_1,
    version_number: 1,
    status: "verified",
    is_canonical: false,
    evolve_in_progress: false,
    created_at: daysAgo(120),
    confidence: 0.80,
    execution_count: 10,
    tags: [],
    ...overrides,
  };
}

/**
 * Build the standard sequence of mockDynamoSend responses for a single-skill
 * evaluation run.
 *
 * Call order from evaluateArchive:
 *   1. GetCommand (config — last_archive_evaluation older than 23 hours or missing)
 *   2. ScanCommand (active skills, one page)
 *   3. ScanCommand (problems, one page)
 *   [N]. QueryCommand per problem (active high-confidence skills count)
 *   last. UpdateCommand (update last_archive_evaluation)
 */
function setupStaleConfig(): void {
  // Config item: last_archive_evaluation is 25 hours ago (outside gate)
  mockDynamoSend.mockResolvedValueOnce({
    Item: { last_archive_evaluation: hoursAgo(25) },
  });
}

function setupNoProblems(): void {
  // Problems scan: no items
  mockDynamoSend.mockResolvedValueOnce({ Items: [] });
}

function setupUpdateConfig(): void {
  // UpdateCommand for last_archive_evaluation
  mockDynamoSend.mockResolvedValueOnce({});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateArchive", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSQSSend.mockResolvedValue({});
    mockKinesisSend.mockResolvedValue({});
  });

  // =========================================================================
  // Test 1: 23-hour gate — skip when last_archive_evaluation is recent
  // =========================================================================
  it("returns immediately when last_archive_evaluation is within 23 hours", async () => {
    // Config: last run was 10 hours ago
    mockDynamoSend.mockResolvedValueOnce({
      Item: { last_archive_evaluation: hoursAgo(10) },
    });

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    // Only the GetCommand (config read) should have been called
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    expect(mockSQSSend).not.toHaveBeenCalled();
    expect(mockKinesisSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 2: gate passes when last_archive_evaluation is older than 23 hours
  // =========================================================================
  it("runs evaluation when last_archive_evaluation is older than 23 hours", async () => {
    setupStaleConfig();
    // Skills scan: no skills
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    // GetCommand + ScanCommand (skills) + ScanCommand (problems) + UpdateCommand
    expect(mockDynamoSend).toHaveBeenCalledTimes(4);
  });

  // =========================================================================
  // Test 3: canonical skill is skipped
  // =========================================================================
  it("skips a skill with is_canonical = true", async () => {
    setupStaleConfig();
    // Skills: one canonical skill that would otherwise be stale
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkill({ is_canonical: true, last_executed_at: daysAgo(200) })],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 4: skill within 30-day grace period is skipped
  // =========================================================================
  it("skips a skill created less than 30 days ago (grace period)", async () => {
    setupStaleConfig();
    // Skill created 15 days ago — inside grace period; execution_count = 0 would
    // normally trigger zero_usage but grace period exempts it
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkill({ created_at: daysAgo(15), execution_count: 0 })],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 5a: staleness trigger fires at 91 days
  // =========================================================================
  it("fires staleness trigger when last_executed_at is 91 days ago", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkill({ last_executed_at: daysAgo(91) })],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (mockSQSSend.mock.calls[0][0] as { input: { MessageBody: string } }).input.MessageBody,
    );
    expect(sentBody.target_id).toBe(SKILL_ID_1);
    expect(sentBody.reason).toBe("staleness_90d");
  });

  // =========================================================================
  // Test 5b: staleness trigger does NOT fire at 89 days
  // =========================================================================
  it("does NOT fire staleness trigger when last_executed_at is only 89 days ago", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkill({ last_executed_at: daysAgo(89) })],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 6: seasonal skill uses 365-day staleness threshold
  // =========================================================================
  it("uses 365-day staleness threshold for skills with 'seasonal' tag", async () => {
    setupStaleConfig();

    // 200 days stale — would trigger standard 90d but NOT the 365d seasonal threshold
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkill({ tags: ["seasonal"], last_executed_at: daysAgo(200) })],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    // 200 days < 365 days → should NOT trigger
    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  it("fires staleness_365d for seasonal skill stale for more than 365 days", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkill({ tags: ["seasonal"], last_executed_at: daysAgo(400) })],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (mockSQSSend.mock.calls[0][0] as { input: { MessageBody: string } }).input.MessageBody,
    );
    expect(sentBody.reason).toBe("staleness_365d");
  });

  // =========================================================================
  // Test 7a: low confidence trigger fires when confidence < 0.30 AND exec >= 5
  // =========================================================================
  it("fires low_confidence trigger when confidence = 0.29 and execution_count = 5", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          last_executed_at: daysAgo(10), // Not stale
          confidence: 0.29,
          execution_count: 5,
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (mockSQSSend.mock.calls[0][0] as { input: { MessageBody: string } }).input.MessageBody,
    );
    expect(sentBody.reason).toBe("low_confidence");
  });

  // =========================================================================
  // Test 7b: low confidence does NOT fire when execution_count < 5
  // =========================================================================
  it("does NOT fire low_confidence trigger when execution_count = 4 (below minimum)", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          last_executed_at: daysAgo(10), // Not stale
          confidence: 0.29,
          execution_count: 4,
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 8: high failure rate trigger skipped when use_clickhouse = false
  // =========================================================================
  it("skips high failure rate trigger when use_clickhouse is false", async () => {
    // Config: use_clickhouse not set (defaults to false)
    mockDynamoSend.mockResolvedValueOnce({
      Item: {
        last_archive_evaluation: hoursAgo(25),
        use_clickhouse: false,
      },
    });
    // Skill: no staleness, confidence = 0.80 (not low), execution_count = 15 (not zero)
    // In Phase 3 with ClickHouse, a high failure rate would trigger here.
    // In Phase 2, this trigger is skipped.
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          last_executed_at: daysAgo(10),
          confidence: 0.80,
          execution_count: 15,
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    // No trigger should fire — failure rate check is skipped
    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 9: zero usage trigger fires correctly
  // =========================================================================
  it("fires zero_usage trigger when execution_count = 0 and age > 60 days", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          created_at: daysAgo(61),
          execution_count: 0,
          // No last_executed_at — staleness falls back to created_at (61 days < 90d threshold)
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (mockSQSSend.mock.calls[0][0] as { input: { MessageBody: string } }).input.MessageBody,
    );
    expect(sentBody.reason).toBe("zero_usage");
  });

  it("does NOT fire zero_usage trigger when age is only 59 days", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          created_at: daysAgo(59),
          execution_count: 0,
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 10: per-cycle limit — 51 candidates → only 50 SQS messages sent
  // =========================================================================
  it("sends at most 50 SQS messages when there are 51 candidates", async () => {
    setupStaleConfig();

    // Build 51 stale skills
    const skills = Array.from({ length: 51 }, (_, i) =>
      makeSkill({
        skill_id: `aaaaaaaa-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
        last_executed_at: daysAgo(120),
      }),
    );
    mockDynamoSend.mockResolvedValueOnce({ Items: skills });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).toHaveBeenCalledTimes(50);
  });

  // =========================================================================
  // Test 11: execution_count > 100 → Kinesis archive_warning emitted before SQS
  // =========================================================================
  it("emits Kinesis archive_warning before SQS send when execution_count > 100", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          last_executed_at: daysAgo(200),
          execution_count: 142,
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    const callOrder: string[] = [];
    mockKinesisSend.mockImplementation(async () => {
      callOrder.push("kinesis");
    });
    mockSQSSend.mockImplementation(async () => {
      callOrder.push("sqs");
    });

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockKinesisSend).toHaveBeenCalledTimes(1);
    expect(mockSQSSend).toHaveBeenCalledTimes(1);

    // Kinesis must be called before SQS
    expect(callOrder).toEqual(["kinesis", "sqs"]);

    // Verify Kinesis payload
    const kinesisCall = mockKinesisSend.mock.calls[0][0] as {
      input: { Data: Buffer };
    };
    const payload = JSON.parse(kinesisCall.input.Data.toString());
    expect(payload.event_type).toBe("archive_warning");
    expect(payload.skill_id).toBe(SKILL_ID_1);
    expect(payload.execution_count).toBe(142);
  });

  // =========================================================================
  // Test 12: dry-run mode → writes to dry-run table, no SQS messages
  // =========================================================================
  it("in dry-run mode, writes to dry-run DynamoDB table and sends no SQS messages", async () => {
    // Config: dry_run = true
    mockDynamoSend.mockResolvedValueOnce({
      Item: {
        last_archive_evaluation: hoursAgo(25),
        dry_run: true,
      },
    });
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkill({ last_executed_at: daysAgo(120) })],
    });
    setupNoProblems();
    // PutCommand (dry-run table write)
    mockDynamoSend.mockResolvedValueOnce({});
    // UpdateCommand (last_archive_evaluation)
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();

    // Verify a PutCommand was sent (dry-run table write)
    const { PutCommand } = jest.requireMock("@aws-sdk/lib-dynamodb") as {
      PutCommand: jest.Mock;
    };
    expect(PutCommand).toHaveBeenCalled();
    const putInput = (PutCommand.mock.calls[0] as [{ Item: Record<string, unknown> }])[0];
    expect(putInput.Item.target_id).toBe(SKILL_ID_1);
    expect(putInput.Item.reason).toBe("staleness_90d");
  });

  // =========================================================================
  // Test 13: last_archive_evaluation is updated at end of successful run
  // =========================================================================
  it("updates last_archive_evaluation in config after a successful run", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({ Items: [] }); // skills scan
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    const { UpdateCommand } = jest.requireMock("@aws-sdk/lib-dynamodb") as {
      UpdateCommand: jest.Mock;
    };

    // Find the UpdateCommand call that sets last_archive_evaluation
    const updateCalls = UpdateCommand.mock.calls as Array<
      [{ Key: Record<string, unknown>; UpdateExpression: string }]
    >;
    const configUpdate = updateCalls.find(([input]) =>
      input.Key?.pk === "archive_eval" &&
      input.UpdateExpression?.includes("last_archive_evaluation"),
    );

    expect(configUpdate).toBeDefined();
  });

  // =========================================================================
  // Test 14: already-archived skill is skipped
  // =========================================================================
  it("skips a skill with status = 'archived'", async () => {
    setupStaleConfig();
    // The scan filters out archived skills at the DynamoDB level, but even if
    // one slips through, the exemption check should catch it.
    mockDynamoSend.mockResolvedValueOnce({
      Items: [makeSkill({ status: "archived", last_executed_at: daysAgo(200) })],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Additional: evolve_in_progress skill is skipped
  // =========================================================================
  it("skips a skill with evolve_in_progress = true", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          evolve_in_progress: true,
          last_executed_at: daysAgo(200),
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Additional: unarchived_at within 14 days prevents archival
  // =========================================================================
  it("skips a skill unarchived within the last 14 days (cooldown)", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          unarchived_at: daysAgo(5),
          last_executed_at: daysAgo(200),
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Additional: staleness uses created_at when last_executed_at is absent
  // =========================================================================
  it("uses created_at for staleness when last_executed_at is missing (non-zero usage case)", async () => {
    setupStaleConfig();
    // Skill has execution_count = 3 (above zero_usage threshold of 0) but no
    // last_executed_at. Staleness check falls back to created_at = 100 days ago → triggers.
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          created_at: daysAgo(100),
          execution_count: 3,
          confidence: 0.80,
          // last_executed_at intentionally absent
        }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (mockSQSSend.mock.calls[0][0] as { input: { MessageBody: string } }).input.MessageBody,
    );
    expect(sentBody.reason).toBe("staleness_90d");
  });

  // =========================================================================
  // Additional: problem archive trigger
  // =========================================================================
  it("enqueues a problem when it has no active high-confidence skills and no recent resolves", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({ Items: [] }); // no skills to evaluate

    // Problems scan: one problem with last_resolve_at = 100 days ago
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        {
          problem_id: PROBLEM_ID_1,
          last_resolve_at: daysAgo(100),
        },
      ],
    });

    // GSI-problem-status query: Count = 0 (no active high-confidence skills)
    mockDynamoSend.mockResolvedValueOnce({ Count: 0 });

    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (mockSQSSend.mock.calls[0][0] as { input: { MessageBody: string } }).input.MessageBody,
    );
    expect(sentBody.target_type).toBe("problem");
    expect(sentBody.target_id).toBe(PROBLEM_ID_1);
    expect(sentBody.reason).toBe("problem_no_active_skills");
  });

  it("does NOT enqueue a problem when last_resolve_at is within 90 days", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({ Items: [] }); // no skills

    // Problems scan: problem with recent resolve
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        {
          problem_id: PROBLEM_ID_1,
          last_resolve_at: daysAgo(30),
        },
      ],
    });

    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Additional: two stale skills — both get separate SQS messages
  // =========================================================================
  it("sends one SQS message per candidate when multiple skills qualify", async () => {
    setupStaleConfig();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        makeSkill({ skill_id: SKILL_ID_1, last_executed_at: daysAgo(120) }),
        makeSkill({ skill_id: SKILL_ID_2, last_executed_at: daysAgo(150) }),
      ],
    });
    setupNoProblems();
    setupUpdateConfig();

    await evaluateArchive(dynamoClient, sqsClient, kinesisClient);

    expect(mockSQSSend).toHaveBeenCalledTimes(2);
  });
});
