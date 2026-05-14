/**
 * Unit tests for src/auth/setAccountStatus.ts
 */

import type { APIGatewayProxyEvent } from "aws-lambda";

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: mockSend }),
  },
  GetCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  UpdateCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

import { handler } from "../../../src/auth/setAccountStatus.js";

function makeEvent(
  accountId: string | undefined,
  body: unknown,
): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    pathParameters: accountId ? { account_id: accountId } : null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    path: `/auth/accounts/${accountId ?? ""}/status`,
    httpMethod: "POST",
    resource: "/auth/accounts/{account_id}/status",
    stageVariables: null,
    requestContext: {} as unknown as APIGatewayProxyEvent["requestContext"],
  };
}

describe("setAccountStatus handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("suspends an existing account", async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { account_id: "acct-123", status: "active" } })
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent("acct-123", { status: "suspended", reason: "abuse" }),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.account_id).toBe("acct-123");
    expect(body.status).toBe("suspended");
  });

  it("returns 404 when the account does not exist", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      makeEvent("acct-404", { status: "suspended" }),
    );

    expect(result.statusCode).toBe(404);
  });

  it("returns 400 when account_id is missing", async () => {
    const result = await handler(
      makeEvent(undefined, { status: "active" }),
    );

    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for invalid request status", async () => {
    const result = await handler(
      makeEvent("acct-123", { status: "paused" }),
    );

    expect(result.statusCode).toBe(400);
  });
});
