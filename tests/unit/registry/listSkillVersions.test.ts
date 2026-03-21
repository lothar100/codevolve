/**
 * Unit tests for GET /skills/:id/versions handler.
 */

import { handler } from "../../../src/registry/listSkillVersions.js";
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
    from: jest.fn().mockReturnValue({ send: (...args: unknown[]) => mockSend(...args) }),
  },
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: "QueryCommand", input })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_ID = "22222222-2222-2222-2222-222222222222";

function makeEvent(
  pathId: string,
  queryParams?: Record<string, string>,
): APIGatewayProxyEvent {
  return {
    body: null,
    pathParameters: { id: pathId },
    queryStringParameters: queryParams ?? null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: `/skills/${pathId}/versions`,
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

function makeSkillItem(version: number, overrides?: Record<string, unknown>) {
  return {
    skill_id: SKILL_ID,
    version_number: version,
    version_label: `${version}.0.0`,
    problem_id: "11111111-1111-1111-1111-111111111111",
    name: "Two Sum Hash Map",
    description: "O(n) solution",
    is_canonical: version === 3,
    status: "verified",
    language: "python",
    domain: ["arrays"],
    tags: ["hash-map"],
    confidence: 0.9,
    created_at: `2026-01-0${version}T00:00:00.000Z`,
    updated_at: `2026-01-0${version}T00:00:00.000Z`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /skills/:id/versions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return versions in descending order", async () => {
    const items = [makeSkillItem(3), makeSkillItem(2), makeSkillItem(1)];
    mockSend.mockResolvedValueOnce({ Items: items });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.skill_id).toBe(SKILL_ID);
    expect(body.versions).toHaveLength(3);
    expect(body.versions[0].version).toBe(3);
    expect(body.versions[1].version).toBe(2);
    expect(body.versions[2].version).toBe(1);

    // Verify SkillVersionSummary shape
    const v = body.versions[0];
    expect(v.skill_id).toBe(SKILL_ID);
    expect(v.version_label).toBe("3.0.0");
    expect(v.status).toBe("verified");
    expect(v.confidence).toBe(0.9);
    expect(v.is_canonical).toBe(true);
    expect(v.created_at).toBeDefined();

    // Should NOT include full skill fields
    expect(v.implementation).toBeUndefined();
    expect(v.tests).toBeUndefined();
    expect(v.inputs).toBeUndefined();
  });

  it("should support pagination with limit and next_token", async () => {
    const lastEvaluatedKey = { skill_id: SKILL_ID, version_number: 2 };
    mockSend.mockResolvedValueOnce({
      Items: [makeSkillItem(3)],
      LastEvaluatedKey: lastEvaluatedKey,
    });

    const result = await handler(makeEvent(SKILL_ID, { limit: "1" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.versions).toHaveLength(1);
    expect(body.pagination.limit).toBe(1);
    expect(body.pagination.next_token).not.toBeNull();

    // Decode next_token and verify it matches the LastEvaluatedKey
    const decoded = JSON.parse(
      Buffer.from(body.pagination.next_token, "base64").toString("utf-8"),
    );
    expect(decoded).toEqual(lastEvaluatedKey);

    // Second page using next_token
    mockSend.mockResolvedValueOnce({
      Items: [makeSkillItem(2)],
      LastEvaluatedKey: undefined,
    });

    const result2 = await handler(
      makeEvent(SKILL_ID, {
        limit: "1",
        next_token: body.pagination.next_token,
      }),
    );
    const body2 = JSON.parse(result2.body);

    expect(result2.statusCode).toBe(200);
    expect(body2.versions).toHaveLength(1);
    expect(body2.versions[0].version).toBe(2);
    expect(body2.pagination.next_token).toBeNull();
  });

  it("should return 404 when no skill found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("should return 400 when invalid UUID", async () => {
    const result = await handler(makeEvent("not-a-uuid"));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should return null next_token when no more pages", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeSkillItem(1)],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.pagination.next_token).toBeNull();
  });

  it("should use default limit of 20", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeSkillItem(1)] });

    await handler(makeEvent(SKILL_ID));

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.Limit).toBe(20);
  });

  it("should return 400 for invalid next_token", async () => {
    const result = await handler(
      makeEvent(SKILL_ID, { next_token: "not-valid-base64!!!" }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should omit version_label when not present on item", async () => {
    const itemWithoutLabel = makeSkillItem(1);
    delete (itemWithoutLabel as Record<string, unknown>).version_label;
    mockSend.mockResolvedValueOnce({ Items: [itemWithoutLabel] });

    const result = await handler(makeEvent(SKILL_ID));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.versions[0].version_label).toBeUndefined();
  });
});
