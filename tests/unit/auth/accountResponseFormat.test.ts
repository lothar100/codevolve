import type { APIGatewayProxyEvent } from "aws-lambda";
import { decode } from "@toon-format/toon";

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

import { handler } from "../../../src/auth/accountResponseFormat.js";

function makeEvent(
  httpMethod: "GET" | "PUT",
  options?: {
    body?: unknown;
    headers?: Record<string, string>;
    authorizer?: Record<string, unknown>;
  },
): APIGatewayProxyEvent {
  return {
    body:
      options?.body === undefined ? null : JSON.stringify(options.body),
    pathParameters: null,
    queryStringParameters: null,
    headers: options?.headers ?? {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    path: "/settings/response-format",
    httpMethod,
    resource: "/settings/response-format",
    stageVariables: null,
    requestContext: {
      authorizer:
        options?.authorizer ?? { account_id: "acct-123", owner_id: "acct-123" },
    } as unknown as APIGatewayProxyEvent["requestContext"],
  };
}

describe("accountResponseFormat handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the stored format and defaults missing values to json", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        account_id: "acct-123",
        updated_at: "2026-05-18T00:00:00.000Z",
      },
    });

    const result = await handler(makeEvent("GET"));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      account_id: "acct-123",
      response_format: "json",
      updated_at: "2026-05-18T00:00:00.000Z",
    });
  });

  it("supports TOON responses via Accept override", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        account_id: "acct-123",
        response_format: "toon",
        response_format_updated_at: "2026-05-18T01:00:00.000Z",
      },
    });

    const result = await handler(
      makeEvent("GET", { headers: { Accept: "text/toon" } }),
    );

    expect(result.headers?.["Content-Type"]).toBe("text/toon; charset=utf-8");
    expect(decode(result.body)).toEqual({
      account_id: "acct-123",
      response_format: "toon",
      updated_at: "2026-05-18T01:00:00.000Z",
    });
  });

  it("updates the account preference", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler(
      makeEvent("PUT", { body: { response_format: "toon" } }),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.account_id).toBe("acct-123");
    expect(body.response_format).toBe("toon");

    const commandInput = mockSend.mock.calls[0][0].input as {
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(commandInput.ExpressionAttributeValues[":responseFormat"]).toBe("toon");
  });

  it("returns 400 for an invalid body", async () => {
    const result = await handler(
      makeEvent("PUT", { body: { response_format: "xml" } }),
    );

    expect(result.statusCode).toBe(400);
  });

  it("returns 401 when auth context is missing", async () => {
    const result = await handler(
      makeEvent("GET", { authorizer: {} }),
    );

    expect(result.statusCode).toBe(401);
  });
});
