// HTTP client for the codeVolve REST API.
// All methods return the parsed JSON response body or throw on non-2xx.
//
// Design note: env vars are read inside createClientFromEnv() — NOT at module
// load time — so this module is safe to import in tests without CODEVOLVE_API_URL set.

export class CodevolveClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly agentId: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    baseUrl: string;
    apiKey?: string;
    agentId: string;
    timeoutMs: number;
  }) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.agentId = opts.agentId;
    this.timeoutMs = opts.timeoutMs;
  }

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Agent-Id": this.agentId,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    const text = await response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(`HTTP ${response.status}: ${response.statusText}`),
        { statusCode: response.status, body: parsed }
      );
    }

    return parsed;
  }
}

export function createClientFromEnv(): CodevolveClient {
  const apiUrl = process.env["CODEVOLVE_API_URL"];
  if (!apiUrl) {
    console.error("CODEVOLVE_API_URL is required but not set.");
    process.exit(1);
  }

  const raw = parseInt(process.env["CODEVOLVE_TIMEOUT_MS"] ?? "35000", 10);
  const timeoutMs = isNaN(raw) ? 35000 : raw;

  return new CodevolveClient({
    baseUrl: apiUrl,
    apiKey: process.env["CODEVOLVE_API_KEY"],
    agentId: process.env["CODEVOLVE_AGENT_ID"] ?? "mcp-server",
    timeoutMs,
  });
}
