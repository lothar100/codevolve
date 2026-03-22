// HTTP client that calls the codeVolve REST API.
// All methods return the parsed JSON response body or throw on non-2xx.

const API_URL = process.env["CODEVOLVE_API_URL"];
const API_KEY = process.env["CODEVOLVE_API_KEY"];
const AGENT_ID = process.env["CODEVOLVE_AGENT_ID"] ?? "mcp-server";
const TIMEOUT_MS = parseInt(process.env["CODEVOLVE_TIMEOUT_MS"] ?? "35000", 10);

if (!API_URL) {
  console.error("CODEVOLVE_API_URL is required but not set.");
  process.exit(1);
}

export class CodevolveClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly agentId: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = API_URL!;
    this.apiKey = API_KEY;
    this.agentId = AGENT_ID;
    this.timeoutMs = TIMEOUT_MS;
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

export const client = new CodevolveClient();
