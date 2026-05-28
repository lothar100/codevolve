/**
 * Unit tests for GET / discovery handler.
 */

import type { APIGatewayProxyEvent } from "aws-lambda";

jest.mock("@toon-format/toon", () => ({
  encode: (value: unknown) => `TOON:${JSON.stringify(value)}`,
}));

import { handler } from "../../../src/registry/discovery.js";

const baseRequestContext = {
  accountId: "123456789012",
  apiId: "api-id",
  protocol: "HTTP/1.1",
  httpMethod: "GET",
  identity: {} as APIGatewayProxyEvent["requestContext"]["identity"],
  path: "/",
  stage: "v1",
  requestId: "request-id",
  requestTimeEpoch: 1,
  resourceId: "resource-id",
  resourcePath: "/",
} as APIGatewayProxyEvent["requestContext"];

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: "/",
    pathParameters: null,
    queryStringParameters: null,
    resource: "/",
    stageVariables: null,
    requestContext: baseRequestContext,
    ...overrides,
  };
}

async function invoke(event: APIGatewayProxyEvent) {
  const result = await handler(event, {} as never, {} as never);
  if (!result) {
    throw new Error("Discovery handler returned no response");
  }

  return result;
}

describe("GET / discovery", () => {
  it("returns the auth and onboarding routes needed for beta bootstrap", async () => {
    const result = await invoke(
      makeEvent({
        path: "/",
        headers: {
          Host: "qrxttojvni.execute-api.us-east-2.amazonaws.com",
          "X-Forwarded-Proto": "https",
        },
        requestContext: {
          ...baseRequestContext,
          domainName: "qrxttojvni.execute-api.us-east-2.amazonaws.com",
          path: "/v1/",
          stage: "v1",
        },
      }),
    );
    const body = JSON.parse(result.body) as {
      base_url: string;
      openapi_url: string;
      auth_schemes: Record<string, string>;
      response_formats: {
        default: string;
        supported: string[];
        accept_overrides: Record<string, string>;
        preference_endpoint: string;
        precedence: string[];
      };
      mcp: {
        env: Record<string, string>;
        first_steps: string[];
        tools: Array<{ name: string; description: string }>;
        resources: Array<{ uri: string; description: string }>;
      };
      endpoints: Array<{
        method: string;
        path: string;
        auth: string;
        description: string;
      }>;
    };

    expect(result.statusCode).toBe(200);
    expect(body.base_url).toBe("https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1");
    expect(body.openapi_url).toBe("https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/openapi.json");
    expect(body.auth_schemes.api_key).toContain("X-Api-Key");
    expect(body.auth_schemes.api_key).toContain("key-management");
    expect(body.response_formats.default).toBe("json");
    expect(body.response_formats.supported).toEqual(["json", "toon"]);
    expect(body.response_formats.preference_endpoint).toBe("/settings/response-format");
    expect(body.response_formats.accept_overrides.toon).toBe("text/toon");
    expect(body.mcp.env.CODEVOLVE_API_URL).toBe("https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1");
    expect(body.mcp.first_steps[1]).toContain("POST /auth/register");
    expect(body.mcp.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "resolve_skill" }),
        expect.objectContaining({ name: "get_skill" }),
        expect.objectContaining({ name: "feedback_skill" }),
      ]),
    );
    expect(body.mcp.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uri: "codevolve://skills/{skill_id}" }),
      ]),
    );

    expect(body.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/auth/register",
          auth: "none",
        }),
        expect.objectContaining({
          method: "PUT",
          path: "/settings/response-format",
          auth: "api_key",
        }),
        expect.objectContaining({
          method: "POST",
          path: "/execute",
          auth: "none",
        }),
        expect.objectContaining({
          method: "PUT",
          path: "/settings/response-format",
          auth: "api_key",
        }),
      ]),
    );
    expect(body.endpoints).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/auth/accounts/{account_id}/status" }),
        expect.objectContaining({ path: "/users/me/trusted-mountain" }),
        expect.objectContaining({ path: "/users/me/trusted-mountain/{skill_id}" }),
      ]),
    );
  });

  it("describes the local-execution beta flow instead of a hosted runner", async () => {
    const result = await invoke(
      makeEvent({
        headers: {
          host: "qrxttojvni.execute-api.us-east-2.amazonaws.com",
          "x-forwarded-proto": "https",
        },
        requestContext: {
          ...baseRequestContext,
          domainName: "qrxttojvni.execute-api.us-east-2.amazonaws.com",
          path: "/v1/",
          stage: "v1",
        },
      }),
    );
    const body = JSON.parse(result.body) as {
      docs_url: string;
      base_url: string;
      openapi_url: string;
      description: string;
      mcp: {
        first_steps: string[];
      };
      endpoints: Array<{
        path: string;
        description: string;
      }>;
    };

    expect(body.base_url).toBe("https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1");
    expect(body.openapi_url).toBe("https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/openapi.json");
    expect(body.docs_url).toBe("https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1");
    expect(body.description).toContain("run locally");
    expect(body.description).toContain("does not run skills");
    expect(body.mcp.first_steps.join(" ")).toContain("feedback_skill");
    expect(body.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/execute",
          description: expect.stringContaining("Compatibility alias"),
        }),
        expect.objectContaining({
          path: "/skills/{id}/archive",
          description: expect.stringContaining("Soft-archive"),
        }),
        expect.objectContaining({
          path: "/skills/{id}/unarchive",
          description: expect.stringContaining("Restore"),
        }),
      ]),
    );
  });

  it("falls back to the raw request path when host metadata is absent", async () => {
    const result = await invoke(
      makeEvent({
        path: "/v1",
        requestContext: {
          ...baseRequestContext,
          domainName: undefined,
          path: "/v1",
        },
      }),
    );

    const body = JSON.parse(result.body) as {
      base_url: string;
      openapi_url: string;
    };

    expect(body.base_url).toBe("/v1");
    expect(body.openapi_url).toBe("/v1/openapi.json");
  });
});
