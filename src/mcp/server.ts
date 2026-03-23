/**
 * codeVolve MCP Server
 *
 * Exposes the codeVolve HTTP API as a stdio MCP server, allowing MCP-compatible
 * agents (Claude Code, etc.) to resolve, execute, and manage skills without
 * knowing the underlying HTTP API shape.
 *
 * Transport: stdio (JSON-RPC 2.0 over stdin/stdout)
 * Auth: optional x-api-key header via CODEVOLVE_API_KEY env var
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_URL =
  process.env["CODEVOLVE_API_URL"] ??
  "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1";

const API_KEY = process.env["CODEVOLVE_API_KEY"];

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface FetchOptions {
  method: string;
  path: string;
  body?: unknown;
  queryParams?: Record<string, string | number | boolean | undefined>;
}

interface ApiErrorShape {
  error?: {
    code: string;
    message: string;
  };
}

async function callApi(opts: FetchOptions): Promise<unknown> {
  let url = `${API_URL}${opts.path}`;

  if (opts.queryParams) {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(opts.queryParams)) {
      if (val !== undefined && val !== null) {
        params.set(key, String(val));
      }
    }
    const qs = params.toString();
    if (qs) url = `${url}?${qs}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }

  const fetchOpts: RequestInit = {
    method: opts.method,
    headers,
  };
  if (opts.body !== undefined) {
    fetchOpts.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, fetchOpts);
  const json = (await res.json()) as unknown;

  if (!res.ok) {
    const errBody = json as ApiErrorShape;
    const code = errBody?.error?.code ?? "API_ERROR";
    const message =
      errBody?.error?.message ?? `HTTP ${res.status} from ${opts.path}`;
    return { error: { code, message } };
  }

  return json;
}

// ---------------------------------------------------------------------------
// Tool result helper — wraps response as MCP text content
// ---------------------------------------------------------------------------

function textContent(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Server construction
// ---------------------------------------------------------------------------

export function createServer(): Server {
  const server = new Server(
    { name: "codevolve", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // -------------------------------------------------------------------------
  // Tool: list_tools
  // -------------------------------------------------------------------------

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "resolve_skill",
          description:
            "Map a natural-language intent to the best matching skill in the codeVolve registry. Returns the top match with its confidence score. Check `similarity_score` — if below 0.7 the match is unreliable.",
          inputSchema: {
            type: "object",
            properties: {
              intent: {
                type: "string",
                minLength: 1,
                maxLength: 1024,
                description:
                  "Natural language description of what you need. Example: 'find the shortest path between two nodes in a weighted graph'.",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional. Narrow results to skills with all of these tags.",
              },
              language: {
                type: "string",
                enum: [
                  "python",
                  "javascript",
                  "typescript",
                  "go",
                  "rust",
                  "java",
                  "cpp",
                  "c",
                ],
                description: "Optional. Prefer skills in this language.",
              },
            },
            required: ["intent"],
          },
        },
        {
          name: "execute_skill",
          description:
            "Run a skill with the provided inputs. Returns the skill's typed outputs. Automatically uses the cache when available.",
          inputSchema: {
            type: "object",
            properties: {
              skill_id: {
                type: "string",
                description:
                  "UUID of the skill to execute. Obtain from resolve_skill.",
              },
              inputs: {
                type: "object",
                description:
                  "Key-value pairs matching the skill's declared input schema.",
              },
              timeout_ms: {
                type: "integer",
                minimum: 100,
                maximum: 300000,
                description:
                  "Optional. Execution timeout in milliseconds. Defaults to 30000.",
              },
            },
            required: ["skill_id", "inputs"],
          },
        },
        {
          name: "chain_skills",
          description:
            "Execute a sequence of skills in order, piping outputs from one step to the inputs of the next. If any step fails, execution halts and partial results are returned.",
          inputSchema: {
            type: "object",
            properties: {
              steps: {
                type: "array",
                minItems: 1,
                maxItems: 10,
                items: {
                  type: "object",
                  properties: {
                    skill_id: {
                      type: "string",
                      description: "UUID of the skill to run at this step.",
                    },
                    input_mapping: {
                      type: "object",
                      additionalProperties: { type: "string" },
                      description:
                        "Optional. Maps input field names to values from chain inputs ('$input.<field>') or prior step outputs ('$steps[0].output.<field>').",
                    },
                  },
                  required: ["skill_id"],
                },
                description:
                  "Ordered list of skills to execute. Outputs flow forward automatically.",
              },
              inputs: {
                type: "object",
                description:
                  "Initial inputs for the chain. Referenced in step input_mappings as '$input.<field>'.",
              },
              timeout_ms: {
                type: "integer",
                minimum: 100,
                maximum: 600000,
                description:
                  "Optional. Total chain timeout in milliseconds. Defaults to 60000.",
              },
            },
            required: ["steps", "inputs"],
          },
        },
        {
          name: "validate_skill",
          description:
            "Run a skill's built-in test suite and return results with an updated confidence score. Use this after submitting a new skill to establish its initial quality baseline.",
          inputSchema: {
            type: "object",
            properties: {
              skill_id: {
                type: "string",
                description: "UUID of the skill to validate.",
              },
            },
            required: ["skill_id"],
          },
        },
        {
          name: "list_skills",
          description:
            "Search and filter the skill registry. Returns a paginated list of skills matching the specified criteria.",
          inputSchema: {
            type: "object",
            properties: {
              tag: {
                type: "string",
                description: "Optional. Filter to skills with this tag.",
              },
              language: {
                type: "string",
                enum: [
                  "python",
                  "javascript",
                  "typescript",
                  "go",
                  "rust",
                  "java",
                  "cpp",
                  "c",
                ],
                description: "Optional. Filter by programming language.",
              },
              domain: {
                type: "string",
                description:
                  "Optional. Filter by domain (e.g., 'graphs', 'sorting', 'dynamic-programming').",
              },
              status: {
                type: "string",
                enum: ["unsolved", "partial", "verified", "optimized"],
                description: "Optional. Filter by skill status.",
              },
              is_canonical: {
                type: "boolean",
                description:
                  "Optional. If true, return only canonical skills for each problem+language combination.",
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                description:
                  "Optional. Number of results to return. Defaults to 20.",
              },
              next_token: {
                type: "string",
                description:
                  "Optional. Pagination cursor from a previous list_skills response.",
              },
            },
            required: [],
          },
        },
        {
          name: "get_skill",
          description:
            "Retrieve full details for a skill by ID, including its implementation, tests, examples, and confidence score.",
          inputSchema: {
            type: "object",
            properties: {
              skill_id: {
                type: "string",
                description: "UUID of the skill to retrieve.",
              },
              version: {
                type: "integer",
                minimum: 1,
                description:
                  "Optional. Retrieve a specific version number. Omit to get the latest version.",
              },
            },
            required: ["skill_id"],
          },
        },
      ],
    };
  });

  // -------------------------------------------------------------------------
  // Tool handlers
  // -------------------------------------------------------------------------

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case "resolve_skill": {
          const intent = args["intent"] as string;
          if (!intent) {
            return textContent({
              error: { code: "INVALID_INPUT", message: "intent is required" },
            });
          }
          const body: Record<string, unknown> = { intent };
          if (args["tags"] !== undefined) body["tags"] = args["tags"];
          if (args["language"] !== undefined)
            body["language"] = args["language"];

          const result = await callApi({
            method: "POST",
            path: "/resolve",
            body,
          });
          return textContent(result);
        }

        case "execute_skill": {
          const skill_id = args["skill_id"] as string;
          const inputs = args["inputs"];
          if (!skill_id) {
            return textContent({
              error: {
                code: "INVALID_INPUT",
                message: "skill_id is required",
              },
            });
          }
          if (inputs === undefined || inputs === null) {
            return textContent({
              error: { code: "INVALID_INPUT", message: "inputs is required" },
            });
          }
          const body: Record<string, unknown> = { skill_id, inputs };
          if (args["timeout_ms"] !== undefined)
            body["timeout_ms"] = args["timeout_ms"];

          const result = await callApi({
            method: "POST",
            path: "/execute",
            body,
          });
          return textContent(result);
        }

        case "chain_skills": {
          const steps = args["steps"];
          const inputs = args["inputs"];
          if (!steps) {
            return textContent({
              error: { code: "INVALID_INPUT", message: "steps is required" },
            });
          }
          if (inputs === undefined || inputs === null) {
            return textContent({
              error: { code: "INVALID_INPUT", message: "inputs is required" },
            });
          }
          const body: Record<string, unknown> = { steps, inputs };
          if (args["timeout_ms"] !== undefined)
            body["timeout_ms"] = args["timeout_ms"];

          const result = await callApi({
            method: "POST",
            path: "/execute/chain",
            body,
          });
          return textContent(result);
        }

        case "validate_skill": {
          const skill_id = args["skill_id"] as string;
          if (!skill_id) {
            return textContent({
              error: {
                code: "INVALID_INPUT",
                message: "skill_id is required",
              },
            });
          }
          const result = await callApi({
            method: "POST",
            path: `/validate/${encodeURIComponent(skill_id)}`,
          });
          return textContent(result);
        }

        case "list_skills": {
          const queryParams: Record<
            string,
            string | number | boolean | undefined
          > = {};
          if (args["tag"] !== undefined) queryParams["tag"] = args["tag"] as string;
          if (args["language"] !== undefined)
            queryParams["language"] = args["language"] as string;
          if (args["domain"] !== undefined)
            queryParams["domain"] = args["domain"] as string;
          if (args["status"] !== undefined)
            queryParams["status"] = args["status"] as string;
          if (args["is_canonical"] !== undefined)
            queryParams["is_canonical"] = args["is_canonical"] as boolean;
          if (args["limit"] !== undefined)
            queryParams["limit"] = args["limit"] as number;
          if (args["next_token"] !== undefined)
            queryParams["next_token"] = args["next_token"] as string;

          const result = await callApi({
            method: "GET",
            path: "/skills",
            queryParams,
          });
          return textContent(result);
        }

        case "get_skill": {
          const skill_id = args["skill_id"] as string;
          if (!skill_id) {
            return textContent({
              error: {
                code: "INVALID_INPUT",
                message: "skill_id is required",
              },
            });
          }
          const queryParams: Record<string, number | undefined> = {};
          if (args["version"] !== undefined)
            queryParams["version"] = args["version"] as number;

          const result = await callApi({
            method: "GET",
            path: `/skills/${encodeURIComponent(skill_id)}`,
            queryParams,
          });
          return textContent(result);
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (err) {
      if (err instanceof McpError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return textContent({ error: { code: "INTERNAL_ERROR", message } });
    }
  });

  // -------------------------------------------------------------------------
  // Resource: list
  // -------------------------------------------------------------------------

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "codevolve://skills",
          name: "Skills catalog",
          description:
            "Paginated list of all non-archived skills. Filterable via URI query parameters.",
          mimeType: "application/json",
        },
      ],
    };
  });

  // -------------------------------------------------------------------------
  // Resource: read
  // -------------------------------------------------------------------------

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      // codevolve://skills/{skill_id}
      const skillMatch = uri.match(/^codevolve:\/\/skills\/([^?]+)$/);
      if (skillMatch) {
        const skill_id = decodeURIComponent(skillMatch[1]);
        const result = await callApi({
          method: "GET",
          path: `/skills/${encodeURIComponent(skill_id)}`,
        });
        const body = result as ApiErrorShape;
        if (body?.error) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            body.error.message ?? "Skill not found",
          );
        }
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // codevolve://problems/{problem_id}
      const problemMatch = uri.match(/^codevolve:\/\/problems\/([^?]+)$/);
      if (problemMatch) {
        const problem_id = decodeURIComponent(problemMatch[1]);
        const result = await callApi({
          method: "GET",
          path: `/problems/${encodeURIComponent(problem_id)}`,
        });
        const body = result as ApiErrorShape;
        if (body?.error) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            body.error.message ?? "Problem not found",
          );
        }
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // codevolve://skills (with optional query params)
      const skillsListMatch = uri.match(/^codevolve:\/\/skills(\?.*)?$/);
      if (skillsListMatch) {
        const queryString = skillsListMatch[1] ?? "";
        const urlParams = new URLSearchParams(queryString);
        const queryParams: Record<
          string,
          string | number | boolean | undefined
        > = {};
        for (const [key, val] of urlParams.entries()) {
          if (key === "limit") {
            queryParams[key] = parseInt(val, 10);
          } else if (key === "is_canonical") {
            queryParams[key] = val === "true";
          } else {
            queryParams[key] = val;
          }
        }

        const result = await callApi({
          method: "GET",
          path: "/skills",
          queryParams,
        });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown resource URI: ${uri}`,
      );
    } catch (err) {
      if (err instanceof McpError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new McpError(ErrorCode.InternalError, message);
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Start function
// ---------------------------------------------------------------------------

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
