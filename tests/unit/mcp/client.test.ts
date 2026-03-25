/**
 * Unit tests for src/mcp/client.ts
 *
 * Tests verify:
 *   - createClientFromEnv fails fast when CODEVOLVE_API_URL is missing
 *   - CodevolveClient constructs correct HTTP requests
 *   - ApiError is thrown on non-2xx responses
 *   - NetworkError is thrown on fetch failures
 *   - Authorization header is set only when CODEVOLVE_API_KEY is present
 *   - X-Agent-Id header uses CODEVOLVE_AGENT_ID or default "mcp-server"
 *   - Timeout aborts the request
 */

import { CodevolveClient, ApiError, NetworkError, createClientFromEnv } from "../../../src/mcp/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Response object */
function mockResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
    text: async () => text,
  } as Response;
}

/** Capture the fetch mock calls */
let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  delete (global as Record<string, unknown>)["fetch"];
  // Clean up any env vars set during tests
  delete process.env["CODEVOLVE_API_URL"];
  delete process.env["CODEVOLVE_API_KEY"];
  delete process.env["CODEVOLVE_AGENT_ID"];
  delete process.env["CODEVOLVE_TIMEOUT_MS"];
});

function makeClient(overrides?: {
  apiUrl?: string;
  apiKey?: string;
  agentId?: string;
  timeoutMs?: number;
}): CodevolveClient {
  return new CodevolveClient({
    apiUrl: overrides?.apiUrl ?? "https://api.codevolve.example.com",
    apiKey: overrides?.apiKey,
    agentId: overrides?.agentId ?? "mcp-server",
    timeoutMs: overrides?.timeoutMs ?? 35000,
  });
}

// ---------------------------------------------------------------------------
// createClientFromEnv
// ---------------------------------------------------------------------------

describe("createClientFromEnv", () => {
  it("throws when CODEVOLVE_API_URL is not set", () => {
    delete process.env["CODEVOLVE_API_URL"];

    expect(() => createClientFromEnv()).toThrow("CODEVOLVE_API_URL is required");
  });

  it("succeeds when CODEVOLVE_API_URL is set", () => {
    process.env["CODEVOLVE_API_URL"] = "https://api.example.com";

    expect(() => createClientFromEnv()).not.toThrow();
  });

  it("uses CODEVOLVE_AGENT_ID when set", () => {
    process.env["CODEVOLVE_API_URL"] = "https://api.example.com";
    process.env["CODEVOLVE_AGENT_ID"] = "my-agent";

    const client = createClientFromEnv();
    // Verify by making a request and checking the header
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));
    return client.request("GET", "/test").then(() => {
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Agent-Id"]).toBe("my-agent");
    });
  });

  it("defaults agentId to 'mcp-server' when CODEVOLVE_AGENT_ID is not set", () => {
    process.env["CODEVOLVE_API_URL"] = "https://api.example.com";
    delete process.env["CODEVOLVE_AGENT_ID"];

    const client = createClientFromEnv();
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));
    return client.request("GET", "/test").then(() => {
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Agent-Id"]).toBe("mcp-server");
    });
  });
});

// ---------------------------------------------------------------------------
// CodevolveClient.request — URL construction
// ---------------------------------------------------------------------------

describe("CodevolveClient.request — URL construction", () => {
  it("concatenates baseUrl and path correctly", async () => {
    const client = makeClient({ apiUrl: "https://api.example.com" });
    mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));

    await client.request("GET", "/skills/abc");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/skills/abc");
  });

  it("uses the provided HTTP method", async () => {
    const client = makeClient();
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await client.request("POST", "/resolve", { intent: "test" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("serializes body as JSON for POST requests", async () => {
    const client = makeClient();
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await client.request("POST", "/execute", { skill_id: "abc", inputs: { n: 5 } });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ skill_id: "abc", inputs: { n: 5 } }));
  });

  it("sends no body for GET requests", async () => {
    const client = makeClient();
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await client.request("GET", "/skills");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CodevolveClient.request — headers
// ---------------------------------------------------------------------------

describe("CodevolveClient.request — headers", () => {
  it("sets Content-Type: application/json", async () => {
    const client = makeClient();
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await client.request("GET", "/skills");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sets X-Agent-Id header from config", async () => {
    const client = makeClient({ agentId: "claude-code-v1" });
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await client.request("GET", "/skills");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Agent-Id"]).toBe("claude-code-v1");
  });

  it("sets Authorization: Bearer when apiKey is provided", async () => {
    const client = makeClient({ apiKey: "sk-test-key" });
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await client.request("GET", "/skills");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-key");
  });

  it("does NOT set Authorization header when apiKey is undefined", async () => {
    const client = makeClient({ apiKey: undefined });
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await client.request("GET", "/skills");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect("Authorization" in headers).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CodevolveClient.request — response handling
// ---------------------------------------------------------------------------

describe("CodevolveClient.request — response handling", () => {
  it("returns parsed JSON on 200 response", async () => {
    const client = makeClient();
    mockFetch.mockResolvedValueOnce(mockResponse(200, { skill_id: "abc", name: "Two Sum" }));

    const result = await client.request("GET", "/skills/abc");

    expect(result).toEqual({ skill_id: "abc", name: "Two Sum" });
  });

  it("throws ApiError on 404 response", async () => {
    const client = makeClient();
    mockFetch.mockResolvedValueOnce(
      mockResponse(404, { error: { code: "NOT_FOUND", message: "Skill not found" } })
    );

    await expect(client.request("GET", "/skills/bad")).rejects.toThrow(ApiError);
  });

  it("ApiError contains statusCode and body from 4xx response", async () => {
    const client = makeClient();
    const errorBody = { error: { code: "NOT_FOUND", message: "Skill not found" } };
    mockFetch.mockResolvedValueOnce(mockResponse(404, errorBody));

    try {
      await client.request("GET", "/skills/bad");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(404);
      expect(apiErr.body).toEqual(errorBody);
    }
  });

  it("throws ApiError on 500 response", async () => {
    const client = makeClient();
    mockFetch.mockResolvedValueOnce(mockResponse(500, { error: "Internal server error" }));

    await expect(client.request("GET", "/skills")).rejects.toThrow(ApiError);
  });

  it("throws NetworkError when fetch throws", async () => {
    const client = makeClient();
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(client.request("GET", "/skills")).rejects.toThrow(NetworkError);
  });

  it("handles non-JSON response body gracefully", async () => {
    const client = makeClient();
    const rawTextResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "plain text response",
    } as Response;
    mockFetch.mockResolvedValueOnce(rawTextResponse);

    const result = await client.request("GET", "/health");

    expect(result).toBe("plain text response");
  });
});

// ---------------------------------------------------------------------------
// Timeout behavior
// ---------------------------------------------------------------------------

describe("CodevolveClient timeout", () => {
  it("passes an AbortSignal to fetch", async () => {
    const client = makeClient({ timeoutMs: 5000 });
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await client.request("GET", "/test");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws NetworkError when fetch is aborted", async () => {
    const client = makeClient({ timeoutMs: 5000 });

    // Simulate fetch throwing an abort error (as the browser/Node does)
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortError);

    await expect(client.request("GET", "/slow")).rejects.toThrow(NetworkError);
  });
});
