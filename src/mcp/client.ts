/**
 * HTTP client that calls the codeVolve REST API.
 * All methods return the parsed JSON response body or throw on non-2xx.
 *
 * Required env var: CODEVOLVE_API_URL
 * Optional env vars: CODEVOLVE_API_KEY, CODEVOLVE_AGENT_ID, CODEVOLVE_TIMEOUT_MS
 */

export interface CodevolveClientConfig {
  apiUrl: string;
  apiKey?: string;
  agentId: string;
  timeoutMs: number;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly body: unknown;

  constructor(statusCode: number, statusText: string, body: unknown) {
    super(`HTTP ${statusCode}: ${statusText}`);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class CodevolveClient {
  private readonly config: CodevolveClientConfig;

  constructor(config: CodevolveClientConfig) {
    this.config = config;
  }

  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Agent-Id": this.config.agentId,
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.apiUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      const message = err instanceof Error ? err.message : String(err);
      throw new NetworkError(message);
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
      throw new ApiError(response.status, response.statusText, parsed);
    }

    return parsed;
  }
}

/**
 * Build a CodevolveClient from environment variables.
 * Throws if CODEVOLVE_API_URL is not set.
 */
export function createClientFromEnv(): CodevolveClient {
  const apiUrl = process.env["CODEVOLVE_API_URL"];
  if (!apiUrl) {
    throw new Error(
      "CODEVOLVE_API_URL is required but not set. " +
        "Set this environment variable to the base URL of your codeVolve API."
    );
  }

  return new CodevolveClient({
    apiUrl,
    apiKey: process.env["CODEVOLVE_API_KEY"],
    agentId: process.env["CODEVOLVE_AGENT_ID"] ?? "mcp-server",
    timeoutMs: parseInt(process.env["CODEVOLVE_TIMEOUT_MS"] ?? "35000", 10),
  });
}
