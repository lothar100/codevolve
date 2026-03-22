import { client } from "./client.js";

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

export async function readSkillResource(uri: string): Promise<ResourceContent> {
  // uri: codevolve://skills/{skill_id}
  const url = new URL(uri);
  const skillId = url.pathname.replace(/^\//, "");
  const result = await client.request("GET", `/skills/${skillId}`);
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(result, null, 2),
  };
}

export async function readProblemResource(
  uri: string
): Promise<ResourceContent> {
  // uri: codevolve://problems/{problem_id}
  const url = new URL(uri);
  const problemId = url.pathname.replace(/^\//, "");
  const result = await client.request("GET", `/problems/${problemId}`);
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(result, null, 2),
  };
}

export async function readSkillsListResource(
  uri: string
): Promise<ResourceContent> {
  // uri: codevolve://skills?tag=...&language=...
  const url = new URL(uri);
  const qs = url.search; // includes leading "?" or empty string
  const result = await client.request("GET", `/skills${qs}`);
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(result, null, 2),
  };
}

// ---------------------------------------------------------------------------
// Resource definitions (MCP metadata)
// ---------------------------------------------------------------------------

export const RESOURCE_DEFINITIONS = [
  {
    uriTemplate: "codevolve://skills/{skill_id}",
    name: "Skill",
    description:
      "Full details of a codeVolve skill including implementation, tests, examples, and confidence metrics.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "codevolve://problems/{problem_id}",
    name: "Problem",
    description:
      "A codeVolve problem with all associated skill implementations.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "codevolve://skills",
    name: "Skills list",
    description:
      "Paginated list of codeVolve skills. Supports query parameters: tag, language, domain, status, is_canonical, limit, next_token.",
    mimeType: "application/json",
  },
] as const;
