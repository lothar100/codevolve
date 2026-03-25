/**
 * Unit tests for the Trusted Mountain Lambda handler.
 *
 * Tests cover:
 * - GET: list user's saved skills
 * - POST: add skill_id to trusted mountain
 * - DELETE: remove skill_id from trusted mountain
 * - Auth rejection: missing userId in authorizer context
 * - User isolation: userId extracted from JWT context, not request body
 * - Validation: invalid skill_id UUID format
 * - 404 on DELETE of non-existent entry
 */

import { handler } from "../../../src/registry/trustedMountain.js";
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
  PutCommand: jest.fn().mockImplementation((input) => ({ _type: "PutCommand", input })),
  GetCommand: jest.fn().mockImplementation((input) => ({ _type: "GetCommand", input })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({ _type: "DeleteCommand", input })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_A = "user-aaaa-1111";
const USER_B = "user-bbbb-2222";
const SKILL_ID_1 = "11111111-1111-1111-1111-111111111111";
const SKILL_ID_2 = "22222222-2222-2222-2222-222222222222";

function makeEvent(overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: "/users/me/trusted-mountain",
    stageVariables: null,
    requestContext: {
      authorizer: { userId: USER_A },
    } as never,
    resource: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: authentication guard
// ---------------------------------------------------------------------------

describe("authentication guard", () => {
  it("returns 401 when authorizer context is missing", async () => {
    const event = makeEvent({
      requestContext: {} as never,
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when userId is empty string in context", async () => {
    const event = makeEvent({
      requestContext: { authorizer: { userId: "" } } as never,
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it("returns 401 when authorizer field is null", async () => {
    const event = makeEvent({
      requestContext: { authorizer: null } as never,
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /users/me/trusted-mountain
// ---------------------------------------------------------------------------

describe("GET /users/me/trusted-mountain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with empty items when user has no saved skills", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const event = makeEvent({ httpMethod: "GET" });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it("returns 200 with saved skill entries", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { user_id: USER_A, skill_id: SKILL_ID_1, saved_at: "2026-03-25T10:00:00.000Z" },
        { user_id: USER_A, skill_id: SKILL_ID_2, saved_at: "2026-03-25T11:00:00.000Z" },
      ],
    });
    const event = makeEvent({ httpMethod: "GET" });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { items: { skill_id: string; saved_at: string }[] };
    expect(body.items).toHaveLength(2);
    expect(body.items[0].skill_id).toBe(SKILL_ID_1);
    expect(body.items[1].skill_id).toBe(SKILL_ID_2);
  });

  it("uses userId from JWT context, not any request body field", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Body contains a different user_id — should be ignored
    const event = makeEvent({
      httpMethod: "GET",
      body: JSON.stringify({ user_id: USER_B }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    // Verify QueryCommand was called with USER_A (from context), not USER_B
    const queryCall = mockSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    expect(queryCall.input.ExpressionAttributeValues[":uid"]).toBe(USER_A);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /users/me/trusted-mountain
// ---------------------------------------------------------------------------

describe("POST /users/me/trusted-mountain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 and adds skill_id on valid request", async () => {
    mockSend.mockResolvedValueOnce({}); // PutCommand success
    const event = makeEvent({
      httpMethod: "POST",
      body: JSON.stringify({ skill_id: SKILL_ID_1 }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      skill_id: string;
      user_id: string;
      saved_at: string;
    };
    expect(body.skill_id).toBe(SKILL_ID_1);
    expect(body.user_id).toBe(USER_A);
    expect(typeof body.saved_at).toBe("string");
  });

  it("returns 400 when skill_id is not a valid UUID", async () => {
    const event = makeEvent({
      httpMethod: "POST",
      body: JSON.stringify({ skill_id: "not-a-uuid" }),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when skill_id is missing from body", async () => {
    const event = makeEvent({
      httpMethod: "POST",
      body: JSON.stringify({}),
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when request body is invalid JSON", async () => {
    const event = makeEvent({
      httpMethod: "POST",
      body: "{{invalid json}",
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("uses userId from JWT context for the PutCommand item", async () => {
    mockSend.mockResolvedValueOnce({});
    // Body attempts to inject a different user_id — must be ignored
    const event = makeEvent({
      httpMethod: "POST",
      body: JSON.stringify({ skill_id: SKILL_ID_1, user_id: USER_B }),
    });
    await handler(event);
    const putCall = mockSend.mock.calls[0][0] as {
      input: { Item: { user_id: string } };
    };
    expect(putCall.input.Item.user_id).toBe(USER_A);
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /users/me/trusted-mountain/{skill_id}
// ---------------------------------------------------------------------------

describe("DELETE /users/me/trusted-mountain/{skill_id}", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 and deletes existing entry", async () => {
    // GetCommand returns existing item, DeleteCommand succeeds
    mockSend
      .mockResolvedValueOnce({ Item: { user_id: USER_A, skill_id: SKILL_ID_1, saved_at: "2026-03-25" } })
      .mockResolvedValueOnce({});

    const event = makeEvent({
      httpMethod: "DELETE",
      pathParameters: { skill_id: SKILL_ID_1 },
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { deleted: boolean; skill_id: string };
    expect(body.deleted).toBe(true);
    expect(body.skill_id).toBe(SKILL_ID_1);
  });

  it("returns 404 when skill_id is not in user's trusted mountain", async () => {
    // GetCommand returns no item
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const event = makeEvent({
      httpMethod: "DELETE",
      pathParameters: { skill_id: SKILL_ID_1 },
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 when skill_id path parameter is missing", async () => {
    const event = makeEvent({
      httpMethod: "DELETE",
      pathParameters: null,
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it("user A cannot delete user B's entries (DELETE uses userId from context)", async () => {
    // GetCommand returns no item for user A + skill (because user B owns it)
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const event = makeEvent({
      httpMethod: "DELETE",
      pathParameters: { skill_id: SKILL_ID_1 },
      // context has USER_A — should look up (USER_A, SKILL_ID_1) not (USER_B, SKILL_ID_1)
    });
    const result = await handler(event);
    // Verifying that the GetCommand used USER_A's userId
    const getCall = mockSend.mock.calls[0][0] as {
      input: { Key: { user_id: string; skill_id: string } };
    };
    expect(getCall.input.Key.user_id).toBe(USER_A);
    // Not found → 404
    expect(result.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: unsupported methods
// ---------------------------------------------------------------------------

describe("unsupported HTTP methods", () => {
  it("returns 405 for PUT", async () => {
    const event = makeEvent({ httpMethod: "PUT" });
    const result = await handler(event);
    expect(result.statusCode).toBe(405);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("returns 405 for PATCH", async () => {
    const event = makeEvent({ httpMethod: "PATCH" });
    const result = await handler(event);
    expect(result.statusCode).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Tests: user isolation
// ---------------------------------------------------------------------------

describe("user isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET for user A does not return user B's data", async () => {
    // DynamoDB correctly scopes by PK, but we verify userId in query
    mockSend.mockResolvedValueOnce({ Items: [] });

    const eventA = makeEvent({
      httpMethod: "GET",
      requestContext: { authorizer: { userId: USER_A } } as never,
    });
    await handler(eventA);

    const queryCallA = mockSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    expect(queryCallA.input.ExpressionAttributeValues[":uid"]).toBe(USER_A);
  });

  it("GET for user B queries with user B's userId", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const eventB = makeEvent({
      httpMethod: "GET",
      requestContext: { authorizer: { userId: USER_B } } as never,
    });
    await handler(eventB);

    const queryCallB = mockSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    expect(queryCallB.input.ExpressionAttributeValues[":uid"]).toBe(USER_B);
  });
});
