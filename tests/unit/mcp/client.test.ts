/**
 * Unit tests for src/mcp/client.ts
 */

import { CodevolveClient, createClientFromEnv } from "../../../src/mcp/client.js";

// ---------------------------------------------------------------------------
// CodevolveClient constructor
// ---------------------------------------------------------------------------

describe("CodevolveClient", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("constructs with required options", () => {
    const client = new CodevolveClient({
      baseUrl: "https://example.com",
      agentId: "test-agent",
      timeoutMs: 5000,
    });
    expect(client).toBeDefined();
  });

  it("constructs with optional apiKey", () => {
    const client = new CodevolveClient({
      baseUrl: "https://example.com",
      apiKey: "secret",
      agentId: "test-agent",
      timeoutMs: 5000,
    });
    expect(client).toBeDefined();
  });

  it("sends X-Api-Key instead of Authorization when apiKey is configured", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodevolveClient({
      baseUrl: "https://example.com",
      apiKey: "cvk_test",
      agentId: "test-agent",
      timeoutMs: 5000,
    });

    await client.request("GET", "/skills");

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Agent-Id": "test-agent",
      "X-Api-Key": "cvk_test",
    });
    expect((options.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createClientFromEnv
// ---------------------------------------------------------------------------

describe("createClientFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates a client when CODEVOLVE_API_URL is set", () => {
    process.env["CODEVOLVE_API_URL"] = "https://api.example.com";
    const client = createClientFromEnv();
    expect(client).toBeInstanceOf(CodevolveClient);
  });

  it("uses default timeout when CODEVOLVE_TIMEOUT_MS is not set", () => {
    process.env["CODEVOLVE_API_URL"] = "https://api.example.com";
    delete process.env["CODEVOLVE_TIMEOUT_MS"];
    // Should not throw — default 35000 is used
    const client = createClientFromEnv();
    expect(client).toBeInstanceOf(CodevolveClient);
  });

  it("uses default timeout when CODEVOLVE_TIMEOUT_MS is NaN (guard against NaN)", () => {
    process.env["CODEVOLVE_API_URL"] = "https://api.example.com";
    process.env["CODEVOLVE_TIMEOUT_MS"] = "not-a-number";
    // Should not throw — falls back to 35000
    const client = createClientFromEnv();
    expect(client).toBeInstanceOf(CodevolveClient);
  });

  it("exits when CODEVOLVE_API_URL is not set", () => {
    delete process.env["CODEVOLVE_API_URL"];
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    expect(() => createClientFromEnv()).toThrow("process.exit called");
    mockExit.mockRestore();
  });
});
