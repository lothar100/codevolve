import type { CodevolveClient } from "./client.js";

// ---------------------------------------------------------------------------
// Resource handlers for codeVolve MCP server
//
// Three resources:
//   codevolve://skills/{skill_id}        → GET /skills/:id
//   codevolve://problems/{problem_id}    → GET /problems/:id
//   codevolve://skills                   → GET /skills (with query params)
// ---------------------------------------------------------------------------

export type ResourceContent = {
  uri: string;
  mimeType: string;
  text: string;
};

export class McpResourceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, opts: { code: string; status: number; details?: unknown }) {
    super(message);
    this.name = "McpResourceError";
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

function parseUri(uri: string): URL {
  try {
    return new URL(uri);
  } catch {
    throw new McpResourceError(`Invalid resource URI: ${uri}`, {
      code: "INVALID_RESOURCE_URI",
      status: 400,
      details: { uri },
    });
  }
}

function wrapResourceError(uri: string, err: unknown): never {
  if (err instanceof McpResourceError) {
    throw err;
  }

  const apiErr = err as { statusCode?: number; body?: unknown; message?: string };
  throw new McpResourceError(`Failed to read resource: ${uri}`, {
    code: "RESOURCE_READ_FAILED",
    status: apiErr.statusCode ?? 500,
    details: apiErr.body ?? apiErr.message ?? String(err),
  });
}

export async function readSkillResource(
  client: CodevolveClient,
  uri: string
): Promise<ResourceContent> {
  try {
    const url = parseUri(uri);
    const skillId = url.pathname.replace(/^\//, "");
    const result = await client.request("GET", `/skills/${skillId}`);
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(result, null, 2),
    };
  } catch (err) {
    wrapResourceError(uri, err);
  }
}

export async function readProblemResource(
  client: CodevolveClient,
  uri: string
): Promise<ResourceContent> {
  try {
    const url = parseUri(uri);
    const problemId = url.pathname.replace(/^\//, "");
    const result = await client.request("GET", `/problems/${problemId}`);
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(result, null, 2),
    };
  } catch (err) {
    wrapResourceError(uri, err);
  }
}

export async function readSkillsListResource(
  client: CodevolveClient,
  uri: string
): Promise<ResourceContent> {
  try {
    const url = parseUri(uri);
    const qs = url.search;
    const result = await client.request("GET", `/skills${qs}`);
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(result, null, 2),
    };
  } catch (err) {
    wrapResourceError(uri, err);
  }
}
