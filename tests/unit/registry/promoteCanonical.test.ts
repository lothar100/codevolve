/**
 * Unit tests for POST /skills/:id/promote-canonical handler.
 *
 * Covers IMPL-13-C spec:
 *   - 200 success with demotion
 *   - 200 success no previous canonical
 *   - 409 ALREADY_CANONICAL
 *   - 422 CONFIDENCE_TOO_LOW
 *   - 422 NEVER_VALIDATED
 *   - 422 TESTS_FAILING
 *   - 422 WRONG_STATUS
 *   - 409 SKILL_ARCHIVED
 *   - 422 TransactionCanceledException → ConditionalCheckFailed
 *   - 404 skill not found
 *   - 400 invalid UUID
 *   - 500 unexpected error
 */

import { handler } from "../../../src/registry/promoteCanonical.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest
      .fn()
      .mockReturnValue({ send: (...args: unknown[]) => mockSend(...args) }),
  },
  QueryCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "QueryCommand", input })),
  GetCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "GetCommand", input })),
  TransactWriteCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "TransactWriteCommand", input })),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SKILL_ID = "22222222-2222-2222-2222-222222222222";
const PROBLEM_ID = "11111111-1111-1111-1111-111111111111";
const PREV_SKILL_ID = "33333333-3333-3333-3333-333333333333";

function makeEvent(pathId: string): APIGatewayProxyEvent {
  return {
    body: null,
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

/** A skill item that passes all gate checks. */
const validSkillItem = {
  skill_id: SKILL_ID,
  version_number: 1,
  problem_id: PROBLEM_ID,
  name: "Two Sum Hash Map",
  description: "O(n) solution",
  is_canonical: false,
  status: "verified",
  language: "python",
  domain: ["arrays"],
  tags: ["hash-map"],
  inputs: [{ name: "nums", type: "number[]" }],
  outputs: [{ name: "indices", type: "number[]" }],
  examples: [],
  tests: [{ input: { nums: [1, 2], target: 3 }, expected: { indices: [0, 1] } }],
  implementation: "def two_sum(): ...",
  confidence: 0.9,
  test_pass_count: 5,
  test_fail_count: 0,
  archived: false,
  latency_p50_ms: 10,
  latency_p95_ms: 25,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

/** Set up mocks for the happy path with no previous canonical. */
function setupSuccessNoPrevious() {
  // Query #1: fetch skill (latest version)
  mockSend.mockResolvedValueOnce({ Items: [validSkillItem] });
  // Query #2: GSI-canonical verified — no previous canonical
  mockSend.mockResolvedValueOnce({ Items: [] });
  // Query #3: GSI-canonical optimized — no previous canonical
  mockSend.mockResolvedValueOnce({ Items: [] });
  // TransactWriteCommand — success
  mockSend.mockResolvedValueOnce({});
  // Query #4: re-fetch promoted skill
  mockSend.mockResolvedValueOnce({
    Items: [{ ...validSkillItem, is_canonical: true, status: "optimized" }],
  });
}

/** Set up mocks for the happy path with one previous canonical to demote. */
function setupSuccessWithDemotion() {
  const prevCanonicalItem = {
    ...validSkillItem,
    skill_id: PREV_SKILL_ID,
    version_number: 2,
    is_canonical: true,
    is_canonical_status: "true#verified",
  };

  // Query #1: fetch skill
  mockSend.mockResolvedValueOnce({ Items: [validSkillItem] });
  // Query #2: GSI-canonical verified — found one previous canonical
  mockSend.mockResolvedValueOnce({ Items: [prevCanonicalItem] });
  // Query #3: GSI-canonical optimized — none
  mockSend.mockResolvedValueOnce({ Items: [] });
  // TransactWriteCommand — success
  mockSend.mockResolvedValueOnce({});
  // Query #4: re-fetch promoted skill
  mockSend.mockResolvedValueOnce({
    Items: [{ ...validSkillItem, is_canonical: true, status: "optimized" }],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /skills/:id/promote-canonical", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 200 — success paths
  // -------------------------------------------------------------------------

  it("200: promotes skill with no previous canonical", async () => {
    setupSuccessNoPrevious();

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.is_canonical).toBe(true);
    expect(body.skill.status).toBe("optimized");
    expect(body.demoted_skill_id).toBeNull();
  });

  it("200: promotes skill and demotes previous canonical", async () => {
    setupSuccessWithDemotion();

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill.is_canonical).toBe(true);
    expect(body.demoted_skill_id).toBe(PREV_SKILL_ID);
  });

  it("200: accepts optimized status for promotion", async () => {
    const optimizedSkill = { ...validSkillItem, status: "optimized" };
    // Query #1: fetch skill
    mockSend.mockResolvedValueOnce({ Items: [optimizedSkill] });
    // Query #2 + #3: no previous canonical
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    // TransactWrite
    mockSend.mockResolvedValueOnce({});
    // Re-fetch
    mockSend.mockResolvedValueOnce({
      Items: [{ ...optimizedSkill, is_canonical: true }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 404 — not found
  // -------------------------------------------------------------------------

  it("404: skill not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error.code).toBe("NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // 409 — gate failures (conflict)
  // -------------------------------------------------------------------------

  it("409 ALREADY_CANONICAL: skill is already canonical", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, is_canonical: true }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe("ALREADY_CANONICAL");
  });

  it("409 SKILL_ARCHIVED: skill has archived flag", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, archived: true }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe("SKILL_ARCHIVED");
  });

  // -------------------------------------------------------------------------
  // 422 — gate failures (precondition)
  // -------------------------------------------------------------------------

  it("422 CONFIDENCE_TOO_LOW: confidence < 0.85", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, confidence: 0.5 }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("CONFIDENCE_TOO_LOW");
  });

  it("422 TESTS_FAILING: skill has failing tests", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, test_fail_count: 2 }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("TESTS_FAILING");
  });

  it("422 NEVER_VALIDATED: test_pass_count is 0", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, test_pass_count: 0 }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("NEVER_VALIDATED");
  });

  it("422 NEVER_VALIDATED: test_pass_count is missing", async () => {
    const { test_pass_count: _omit, ...skillWithoutPasses } = validSkillItem;
    mockSend.mockResolvedValueOnce({ Items: [skillWithoutPasses] });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("NEVER_VALIDATED");
  });

  it("422 WRONG_STATUS: skill status is unsolved", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, status: "unsolved" }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("WRONG_STATUS");
  });

  it("422 WRONG_STATUS: skill status is partial", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...validSkillItem, status: "partial" }],
    });

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("WRONG_STATUS");
  });

  it("422 TransactionCanceledException with ConditionalCheckFailed", async () => {
    // Query #1: fetch skill
    mockSend.mockResolvedValueOnce({ Items: [validSkillItem] });
    // Query #2 + #3: no previous canonical
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    // TransactWriteCommand — fails with ConditionalCheckFailed
    const txError = Object.assign(
      new Error("Transaction cancelled, please refer cancellation reasons for specific reasons"),
      {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
      },
    );
    mockSend.mockRejectedValueOnce(txError);

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error.code).toBe("PRECONDITION_FAILED");
  });

  // -------------------------------------------------------------------------
  // 400 — validation
  // -------------------------------------------------------------------------

  it("400 VALIDATION_ERROR: invalid UUID in path", async () => {
    const result = await handler(makeEvent("not-a-uuid"));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe("VALIDATION_ERROR");
  });

  // -------------------------------------------------------------------------
  // 500 — unexpected error
  // -------------------------------------------------------------------------

  it("500 INTERNAL_ERROR: DynamoDB unavailable", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler(makeEvent(SKILL_ID));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe("INTERNAL_ERROR");
  });
});
