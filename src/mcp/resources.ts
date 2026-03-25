/**
 * Resource handlers for the codeVolve MCP server.
 *
 * Resources:
 *   codevolve://skills/{skill_id}     → GET /skills/:id
 *   codevolve://problems/{problem_id} → GET /problems/:id
 */

import { CodevolveClient } from "./client.js";

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

/**
 * Parse a codevolve:// URI and extract the entity ID.
 * URI format: codevolve://<entity>/<id>
 * e.g. codevolve://skills/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
 */
function extractIdFromUri(uri: string): string {
  const url = new URL(uri);
  // pathname after host: for codevolve://skills/123, host=skills pathname=/123
  const rawPath = url.pathname.replace(/^\/+/, "");
  return rawPath;
}

export async function readSkillResource(
  client: CodevolveClient,
  uri: string
): Promise<ResourceContent> {
  const skillId = extractIdFromUri(uri);
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
  const problemId = extractIdFromUri(uri);
  const result = await client.request("GET", `/problems/${problemId}`);
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
    description: "A codeVolve problem with all associated skill implementations.",
    mimeType: "application/json",
  },
] as const;
