/**
 * Tool handlers for the codeVolve MCP server.
 *
 * Each exported function corresponds to one MCP tool. They accept a raw (unknown)
 * input, parse+validate it with Zod, call the codeVolve HTTP API, and return
 * a ToolResult. Errors from the API are captured as isError:true content blocks
 * so agents can read and act on them without throwing.
 *
 * No LLM calls are made here. No side effects beyond HTTP calls to the API.
 */

import { z } from "zod";
import { CodevolveClient, ApiError, NetworkError } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: TextContent[];
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Wrap an API call: on success return JSON text content; on error return an
 * isError block. Never throws — agents decide what to do with error content.
 */
async function callApi(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const result = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      const body = err.body ?? { error: err.message };
      return {
        content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
        isError: true,
      };
    }
    if (err instanceof NetworkError) {
      const body = { error: err.message };
      return {
        content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
        isError: true,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool 1: resolve
// ---------------------------------------------------------------------------

export const resolveInputSchema = z.object({
  intent: z.string().min(1).max(1024),
  tags: z.array(z.string()).optional(),
  language: z
    .enum(["python", "javascript", "typescript", "go", "rust", "java", "cpp", "c"])
    .optional(),
});

export type ResolveInput = z.infer<typeof resolveInputSchema>;

export async function resolve(client: CodevolveClient, raw: unknown): Promise<ToolResult> {
  const input = resolveInputSchema.parse(raw);
  const body: Record<string, unknown> = { intent: input.intent };
  if (input.tags !== undefined) body["tags"] = input.tags;
  if (input.language !== undefined) body["language"] = input.language;
  return callApi(() => client.request("POST", "/resolve", body));
}

// ---------------------------------------------------------------------------
// Tool 2: execute
// ---------------------------------------------------------------------------

export const executeInputSchema = z.object({
  skill_id: z.string().uuid(),
  inputs: z.record(z.unknown()),
  timeout_ms: z.number().int().min(100).max(300000).optional(),
});

export type ExecuteInput = z.infer<typeof executeInputSchema>;

export async function execute(client: CodevolveClient, raw: unknown): Promise<ToolResult> {
  const input = executeInputSchema.parse(raw);
  const body: Record<string, unknown> = {
    skill_id: input.skill_id,
    inputs: input.inputs,
  };
  if (input.timeout_ms !== undefined) body["timeout_ms"] = input.timeout_ms;
  return callApi(() => client.request("POST", "/execute", body));
}

// ---------------------------------------------------------------------------
// Tool 3: chain
// ---------------------------------------------------------------------------

const chainStepSchema = z.object({
  skill_id: z.string().uuid(),
  input_mapping: z.record(z.string()).optional(),
});

export const chainInputSchema = z.object({
  steps: z.array(chainStepSchema).min(1).max(10),
  inputs: z.record(z.unknown()),
  timeout_ms: z.number().int().min(100).max(600000).optional(),
});

export type ChainInput = z.infer<typeof chainInputSchema>;

export async function chain(client: CodevolveClient, raw: unknown): Promise<ToolResult> {
  const input = chainInputSchema.parse(raw);
  const body: Record<string, unknown> = {
    steps: input.steps,
    inputs: input.inputs,
  };
  if (input.timeout_ms !== undefined) body["timeout_ms"] = input.timeout_ms;
  return callApi(() => client.request("POST", "/execute/chain", body));
}

// ---------------------------------------------------------------------------
// Tool 4: validate
// ---------------------------------------------------------------------------

export const validateInputSchema = z.object({
  skill_id: z.string().uuid(),
});

export type ValidateInput = z.infer<typeof validateInputSchema>;

export async function validate(client: CodevolveClient, raw: unknown): Promise<ToolResult> {
  const input = validateInputSchema.parse(raw);
  return callApi(() => client.request("POST", `/validate/${input.skill_id}`));
}

// ---------------------------------------------------------------------------
// Tool 5: list_skills
// ---------------------------------------------------------------------------

export const listSkillsInputSchema = z.object({
  tag: z.string().optional(),
  language: z.string().optional(),
  domain: z.string().optional(),
  status: z.enum(["unsolved", "partial", "verified", "optimized"]).optional(),
  is_canonical: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  next_token: z.string().optional(),
});

export type ListSkillsInput = z.infer<typeof listSkillsInputSchema>;

export async function listSkills(client: CodevolveClient, raw: unknown): Promise<ToolResult> {
  const input = listSkillsInputSchema.parse(raw);
  const params = new URLSearchParams();
  if (input.tag !== undefined) params.set("tag", input.tag);
  if (input.language !== undefined) params.set("language", input.language);
  if (input.domain !== undefined) params.set("domain", input.domain);
  if (input.status !== undefined) params.set("status", input.status);
  if (input.is_canonical !== undefined) params.set("is_canonical", String(input.is_canonical));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.next_token !== undefined) params.set("next_token", input.next_token);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return callApi(() => client.request("GET", `/skills${qs}`));
}

// ---------------------------------------------------------------------------
// Tool 6: get_skill
// ---------------------------------------------------------------------------

export const getSkillInputSchema = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().min(1).optional(),
});

export type GetSkillInput = z.infer<typeof getSkillInputSchema>;

export async function getSkill(client: CodevolveClient, raw: unknown): Promise<ToolResult> {
  const input = getSkillInputSchema.parse(raw);
  const qs = input.version !== undefined ? `?version=${input.version}` : "";
  return callApi(() => client.request("GET", `/skills/${input.skill_id}${qs}`));
}

// ---------------------------------------------------------------------------
// Tool definitions (MCP metadata) — used by server.ts to register tools
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    name: "resolve",
    description:
      "Map a natural-language intent to the best matching skill in the registry. " +
      "Returns the top match with its confidence score. " +
      "Check confidence before proceeding — below 0.7 means the match is unreliable.",
    inputSchema: {
      type: "object" as const,
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
          description: "Optional. Narrow results to skills with all of these tags.",
        },
        language: {
          type: "string",
          enum: ["python", "javascript", "typescript", "go", "rust", "java", "cpp", "c"],
          description: "Optional. Prefer skills in this language.",
        },
      },
      required: ["intent"],
    },
  },
  {
    name: "execute",
    description:
      "Run a skill with the provided inputs. Returns the skill's typed outputs. " +
      "Automatically uses the cache when available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          format: "uuid",
          description: "UUID of the skill to execute. Obtain from resolve.",
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
          description: "Optional. Execution timeout in milliseconds. Defaults to 30000.",
        },
      },
      required: ["skill_id", "inputs"],
    },
  },
  {
    name: "chain",
    description:
      "Execute a sequence of skills in order, automatically piping outputs from one step " +
      "to the inputs of the next. If any step fails, execution halts and partial results are returned.",
    inputSchema: {
      type: "object" as const,
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
                format: "uuid",
                description: "UUID of the skill to run at this step.",
              },
              input_mapping: {
                type: "object",
                additionalProperties: { type: "string" },
                description:
                  "Optional. Maps this step's input field names to values from chain inputs or prior step outputs.",
              },
            },
            required: ["skill_id"],
          },
          description: "Ordered list of skills to execute.",
        },
        inputs: {
          type: "object",
          description: "Initial inputs for the chain.",
        },
        timeout_ms: {
          type: "integer",
          minimum: 100,
          maximum: 600000,
          description: "Optional. Total chain timeout in milliseconds. Defaults to 60000.",
        },
      },
      required: ["steps", "inputs"],
    },
  },
  {
    name: "validate",
    description:
      "Run the test suite for a skill and update its confidence score. " +
      "Returns pass/fail counts and updated confidence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          format: "uuid",
          description: "UUID of the skill to validate.",
        },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "list_skills",
    description:
      "List and filter codeVolve skills by tag, language, domain, status, or canonical flag. " +
      "Supports pagination.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tag: { type: "string", description: "Filter by tag." },
        language: { type: "string", description: "Filter by programming language." },
        domain: { type: "string", description: "Filter by domain." },
        status: {
          type: "string",
          enum: ["unsolved", "partial", "verified", "optimized"],
          description: "Filter by skill status.",
        },
        is_canonical: { type: "boolean", description: "Filter to canonical skills only." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of results (default: 20).",
        },
        next_token: {
          type: "string",
          description: "Pagination token from a previous list response.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_skill",
    description:
      "Retrieve full details for a skill by ID, including its implementation, tests, " +
      "examples, and confidence score.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          format: "uuid",
          description: "UUID of the skill to retrieve.",
        },
        version: {
          type: "integer",
          minimum: 1,
          description: "Optional specific version number to retrieve.",
        },
      },
      required: ["skill_id"],
    },
  },
] as const;
