import { z } from "zod";
import { client } from "./client.js";

// ---------------------------------------------------------------------------
// Shared helper — converts API call result to a text content block.
// HTTP errors are returned as isError text blocks (not thrown) so agents
// can read the error and decide what to do.
// ---------------------------------------------------------------------------

type TextContent = {
  type: "text";
  text: string;
};

type ToolResult = {
  content: TextContent[];
  isError?: boolean;
};

async function callApi(
  fn: () => Promise<unknown>
): Promise<ToolResult> {
  try {
    const result = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: unknown) {
    const apiErr = err as { statusCode?: number; body?: unknown; message?: string };
    const body = apiErr.body ?? { error: apiErr.message ?? String(err) };
    return {
      content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool 1: resolve_skill
// ---------------------------------------------------------------------------

export const resolveSkillSchema = z.object({
  intent: z.string().min(1),
  tags: z.array(z.string()).optional(),
  language: z.string().optional(),
});

export type ResolveSkillInput = z.infer<typeof resolveSkillSchema>;

export async function resolveSkill(raw: unknown): Promise<ToolResult> {
  const input = resolveSkillSchema.parse(raw);
  const body: Record<string, unknown> = { intent: input.intent };
  if (input.tags !== undefined) body["tags"] = input.tags;
  if (input.language !== undefined) body["language"] = input.language;
  return callApi(() => client.request("POST", "/resolve", body));
}

// ---------------------------------------------------------------------------
// Tool 2: execute_skill
// ---------------------------------------------------------------------------

export const executeSkillSchema = z.object({
  skill_id: z.string().uuid(),
  inputs: z.record(z.unknown()),
  timeout_ms: z.number().int().min(100).max(300000).optional(),
});

export async function executeSkill(raw: unknown): Promise<ToolResult> {
  const input = executeSkillSchema.parse(raw);
  const body: Record<string, unknown> = {
    skill_id: input.skill_id,
    inputs: input.inputs,
  };
  if (input.timeout_ms !== undefined) body["timeout_ms"] = input.timeout_ms;
  return callApi(() => client.request("POST", "/execute", body));
}

// ---------------------------------------------------------------------------
// Tool 3: chain_skills
// ---------------------------------------------------------------------------

const chainStepSchema = z.object({
  skill_id: z.string().uuid(),
  input_mapping: z.record(z.string()).optional(),
});

export const chainSkillsSchema = z.object({
  steps: z.array(chainStepSchema).min(1).max(10),
  inputs: z.record(z.unknown()),
  timeout_ms: z.number().int().min(100).max(600000).optional(),
});

export async function chainSkills(raw: unknown): Promise<ToolResult> {
  const input = chainSkillsSchema.parse(raw);
  const body: Record<string, unknown> = {
    steps: input.steps,
    inputs: input.inputs,
  };
  if (input.timeout_ms !== undefined) body["timeout_ms"] = input.timeout_ms;
  return callApi(() => client.request("POST", "/execute/chain", body));
}

// ---------------------------------------------------------------------------
// Tool 4: get_skill
// ---------------------------------------------------------------------------

export const getSkillSchema = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().min(1).optional(),
});

export async function getSkill(raw: unknown): Promise<ToolResult> {
  const input = getSkillSchema.parse(raw);
  const qs = input.version !== undefined ? `?version=${input.version}` : "";
  return callApi(() => client.request("GET", `/skills/${input.skill_id}${qs}`));
}

// ---------------------------------------------------------------------------
// Tool 5: list_skills
// ---------------------------------------------------------------------------

export const listSkillsSchema = z.object({
  tag: z.string().optional(),
  language: z.string().optional(),
  domain: z.string().optional(),
  status: z.string().optional(),
  is_canonical: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  next_token: z.string().optional(),
});

export async function listSkills(raw: unknown): Promise<ToolResult> {
  const input = listSkillsSchema.parse(raw);
  const params = new URLSearchParams();
  if (input.tag !== undefined) params.set("tag", input.tag);
  if (input.language !== undefined) params.set("language", input.language);
  if (input.domain !== undefined) params.set("domain", input.domain);
  if (input.status !== undefined) params.set("status", input.status);
  if (input.is_canonical !== undefined)
    params.set("is_canonical", String(input.is_canonical));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.next_token !== undefined) params.set("next_token", input.next_token);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return callApi(() => client.request("GET", `/skills${qs}`));
}

// ---------------------------------------------------------------------------
// Tool 6: validate_skill
// ---------------------------------------------------------------------------

export const validateSkillSchema = z.object({
  skill_id: z.string().uuid(),
});

export async function validateSkill(raw: unknown): Promise<ToolResult> {
  const input = validateSkillSchema.parse(raw);
  return callApi(() =>
    client.request("POST", `/validate/${input.skill_id}`)
  );
}

// ---------------------------------------------------------------------------
// Tool 7: submit_skill
// ---------------------------------------------------------------------------

const ioFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
});

const exampleSchema = z.object({
  input: z.record(z.unknown()),
  output: z.record(z.unknown()),
});

const testCaseSchema = z.object({
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()),
});

export const submitSkillSchema = z.object({
  problem_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  language: z.string().min(1),
  domain: z.array(z.string()).min(1),
  inputs: z.array(ioFieldSchema).min(1),
  outputs: z.array(ioFieldSchema).min(1),
  examples: z.array(exampleSchema).min(1),
  tests: z.array(testCaseSchema).min(2),
  implementation: z.string().min(1),
  tags: z.array(z.string()).optional(),
  status: z.string().optional(),
});

export async function submitSkill(raw: unknown): Promise<ToolResult> {
  const input = submitSkillSchema.parse(raw);
  return callApi(() => client.request("POST", "/skills", input));
}

// ---------------------------------------------------------------------------
// Tool definitions (MCP metadata)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    name: "resolve_skill",
    description:
      "Route an intent string to the best matching codeVolve skill using embedding search and tag filtering. Returns the matched skill with a confidence score.",
    inputSchema: {
      type: "object" as const,
      properties: {
        intent: {
          type: "string",
          description: "Natural language description of the problem to solve",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of tags to filter results",
        },
        language: {
          type: "string",
          description: "Optional target programming language",
        },
      },
      required: ["intent"],
    },
    handler: resolveSkill,
  },
  {
    name: "execute_skill",
    description:
      "Execute a codeVolve skill by ID with the given inputs. Returns the skill output or an error. Results may be served from cache.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          format: "uuid",
          description: "UUID of the skill to execute",
        },
        inputs: {
          type: "object",
          description: "Input parameters matching the skill contract",
        },
        timeout_ms: {
          type: "integer",
          minimum: 100,
          maximum: 300000,
          description: "Execution timeout in milliseconds (default: 30000)",
        },
      },
      required: ["skill_id", "inputs"],
    },
    handler: executeSkill,
  },
  {
    name: "chain_skills",
    description:
      "Execute a sequence of codeVolve skills where the output of one step feeds into the next. Supports optional field remapping between steps.",
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
              skill_id: { type: "string", format: "uuid" },
              input_mapping: {
                type: "object",
                additionalProperties: { type: "string" },
                description:
                  "Optional mapping of output field names to input field names for this step",
              },
            },
            required: ["skill_id"],
          },
          description: "Ordered list of skill execution steps",
        },
        inputs: {
          type: "object",
          description: "Initial inputs for the first step",
        },
        timeout_ms: {
          type: "integer",
          minimum: 100,
          maximum: 600000,
          description: "Total chain timeout in milliseconds",
        },
      },
      required: ["steps", "inputs"],
    },
    handler: chainSkills,
  },
  {
    name: "get_skill",
    description:
      "Retrieve full details of a codeVolve skill by its UUID, including implementation, tests, examples, and confidence metrics.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          format: "uuid",
          description: "UUID of the skill to retrieve",
        },
        version: {
          type: "integer",
          minimum: 1,
          description: "Optional specific version number to retrieve",
        },
      },
      required: ["skill_id"],
    },
    handler: getSkill,
  },
  {
    name: "list_skills",
    description:
      "List and filter codeVolve skills by tag, language, domain, status, or canonical flag. Supports pagination.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tag: { type: "string", description: "Filter by tag" },
        language: { type: "string", description: "Filter by programming language" },
        domain: { type: "string", description: "Filter by domain" },
        status: {
          type: "string",
          enum: ["unsolved", "partial", "verified", "optimized"],
          description: "Filter by skill status",
        },
        is_canonical: {
          type: "boolean",
          description: "Filter to canonical skills only",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of results (default: 20)",
        },
        next_token: {
          type: "string",
          description: "Pagination token from a previous list response",
        },
      },
      required: [],
    },
    handler: listSkills,
  },
  {
    name: "validate_skill",
    description:
      "Run the test suite for a codeVolve skill and update its confidence score. Returns pass/fail counts and updated confidence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          format: "uuid",
          description: "UUID of the skill to validate",
        },
      },
      required: ["skill_id"],
    },
    handler: validateSkill,
  },
  {
    name: "submit_skill",
    description:
      "Submit a new skill implementation to the codeVolve registry. Requires a complete skill contract including implementation and at least 2 test cases.",
    inputSchema: {
      type: "object" as const,
      properties: {
        problem_id: {
          type: "string",
          format: "uuid",
          description: "UUID of the problem this skill solves",
        },
        name: { type: "string", description: "Short name for the skill" },
        description: {
          type: "string",
          description: "Description of the algorithm and its complexity",
        },
        language: { type: "string", description: "Programming language" },
        domain: {
          type: "array",
          items: { type: "string" },
          description: "Domain tags (e.g. [\"arrays\", \"sorting\"])",
        },
        inputs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
            },
            required: ["name", "type"],
          },
          description: "Input parameter definitions",
        },
        outputs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
            },
            required: ["name", "type"],
          },
          description: "Output value definitions",
        },
        examples: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              input: { type: "object" },
              output: { type: "object" },
            },
            required: ["input", "output"],
          },
          description: "Worked examples (min 1)",
        },
        tests: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            properties: {
              input: { type: "object" },
              expected: { type: "object" },
            },
            required: ["input", "expected"],
          },
          description: "Test cases (min 2)",
        },
        implementation: {
          type: "string",
          description: "Complete implementation source code",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional searchable tags",
        },
        status: {
          type: "string",
          enum: ["unsolved", "partial", "verified", "optimized"],
          description: "Initial status (default: partial)",
        },
      },
      required: [
        "problem_id",
        "name",
        "description",
        "language",
        "domain",
        "inputs",
        "outputs",
        "examples",
        "tests",
        "implementation",
      ],
    },
    handler: submitSkill,
  },
] as const;
