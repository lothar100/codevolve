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

function parseUri(uri: string): URL {
  try {
    return new URL(uri);
  } catch {
    throw new Error(`Invalid resource URI: ${uri}`);
  }
}

export async function readSkillResource(
  client: CodevolveClient,
  uri: string
): Promise<ResourceContent> {
  const url = parseUri(uri);
  const skillId = url.pathname.replace(/^\//, "");
  const result = await client.request("GET", `/skills/${skillId}`);
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(result, null, 2),
  };
}

export async function readProblemResource(
  client: CodevolveClient,
  uri: string
): Promise<ResourceContent> {
  const url = parseUri(uri);
  const problemId = url.pathname.replace(/^\//, "");
  const result = await client.request("GET", `/problems/${problemId}`);
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(result, null, 2),
  };
}

export async function readSkillsListResource(
  client: CodevolveClient,
  uri: string
): Promise<ResourceContent> {
  const url = parseUri(uri);
  const qs = url.search;
  const result = await client.request("GET", `/skills${qs}`);
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(result, null, 2),
  };
}
