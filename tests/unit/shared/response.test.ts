import type { APIGatewayProxyEvent } from "aws-lambda";
import { decode } from "@toon-format/toon";
import { error, noContent, success } from "../../../src/shared/response.js";

function makeEvent(
  headers: Record<string, string> = {},
  authorizer: Record<string, unknown> = {},
): APIGatewayProxyEvent {
  return {
    body: null,
    headers,
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: "/",
    stageVariables: null,
    requestContext: {
      authorizer,
    } as APIGatewayProxyEvent["requestContext"],
  };
}

describe("shared response helpers", () => {
  it("defaults to JSON serialization", () => {
    const result = success(200, { ok: true });

    expect(result.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(result.body)).toEqual({ ok: true });
  });

  it("uses account TOON preference when no Accept override is present", () => {
    const event = makeEvent({}, { response_format: "toon" });
    const result = success(200, { ok: true, items: [1, 2] }, event);

    expect(result.headers?.["Content-Type"]).toBe("text/toon; charset=utf-8");
    expect(decode(result.body)).toEqual({ ok: true, items: [1, 2] });
  });

  it("lets Accept application/json override an account TOON preference", () => {
    const event = makeEvent(
      { Accept: "application/json" },
      { response_format: "toon" },
    );
    const result = success(200, { ok: true }, event);

    expect(result.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(result.body)).toEqual({ ok: true });
  });

  it("prefers the higher-q Accept media type when both JSON and TOON are present", () => {
    const event = makeEvent({
      Accept: "application/json;q=0.9, text/toon;q=0.4",
    });
    const result = success(200, { ok: true }, event);

    expect(result.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(result.body)).toEqual({ ok: true });
  });

  it("uses the first media type when q values tie", () => {
    const event = makeEvent({
      Accept: "text/toon, application/json",
    });
    const result = success(200, { ok: true }, event);

    expect(result.headers?.["Content-Type"]).toBe("text/toon; charset=utf-8");
    expect(decode(result.body)).toEqual({ ok: true });
  });

  it("serializes errors in TOON when requested", () => {
    const event = makeEvent({ Accept: "text/toon" });
    const result = error(400, "VALIDATION_ERROR", "Bad input", { field: "name" }, event);

    expect(result.headers?.["Content-Type"]).toBe("text/toon; charset=utf-8");
    expect(decode(result.body)).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Bad input",
        details: { field: "name" },
      },
    });
  });

  it("returns 204 without a content-type header", () => {
    const result = noContent(204, makeEvent({ Accept: "text/toon" }));

    expect(result.statusCode).toBe(204);
    expect(result.headers?.["Content-Type"]).toBeUndefined();
    expect(result.body).toBe("");
  });
});
