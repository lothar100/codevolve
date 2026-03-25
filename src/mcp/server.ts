import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";

import type { CodevolveClient } from "./client.js";
import { createClientFromEnv } from "./client.js";
import {
  resolveSkill,
  executeSkill,
  chainSkills,
  getSkill,
  listSkills,
  validateSkill,
  submitSkill,
} from "./tools.js";
import {
  readSkillResource,
  readProblemResource,
  readSkillsListResource,
} from "./resources.js";
import { PROMPT_DEFINITIONS } from "./prompts.js";

// ---------------------------------------------------------------------------
// Factory — creates and configures an McpServer but does NOT call connect().
// This makes the module safe to import in tests.
// ---------------------------------------------------------------------------

export function createServer(client: CodevolveClient): McpServer {
  const server = new McpServer(
    { name: "codevolve", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  server.registerTool(
    "resolve_skill",
    {
      description:
        "Route an intent string to the best matching codeVolve skill using embedding search and tag filtering. Returns the matched skill with a confidence score.",
      inputSchema: {
        intent: z.string().min(1).describe("Natural language description of the problem to solve"),
        tags: z.array(z.string()).optional().describe("Optional list of tags to filter results"),
        language: z.string().optional().describe("Optional target programming language"),
      },
    },
    (args: { intent: string; tags?: string[]; language?: string }) =>
      resolveSkill(client, args)
  );

  server.registerTool(
    "execute_skill",
    {
      description:
        "Execute a codeVolve skill by ID with the given inputs. Returns the skill output or an error. Results may be served from cache.",
      inputSchema: {
        skill_id: z.string().uuid().describe("UUID of the skill to execute"),
        inputs: z.record(z.unknown()).describe("Input parameters matching the skill contract"),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(300000)
          .optional()
          .describe("Execution timeout in milliseconds (default: 30000)"),
      },
    },
    (args: { skill_id: string; inputs: Record<string, unknown>; timeout_ms?: number }) =>
      executeSkill(client, args)
  );

  server.registerTool(
    "chain_skills",
    {
      description:
        "Execute a sequence of codeVolve skills where the output of one step feeds into the next. Supports optional field remapping between steps.",
      inputSchema: {
        steps: z
          .array(
            z.object({
              skill_id: z.string().uuid(),
              input_mapping: z.record(z.string()).optional(),
            })
          )
          .min(1)
          .max(10)
          .describe("Ordered list of skill execution steps"),
        inputs: z.record(z.unknown()).describe("Initial inputs for the first step"),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(600000)
          .optional()
          .describe("Total chain timeout in milliseconds"),
      },
    },
    (args: {
      steps: Array<{ skill_id: string; input_mapping?: Record<string, string> }>;
      inputs: Record<string, unknown>;
      timeout_ms?: number;
    }) => chainSkills(client, args)
  );

  server.registerTool(
    "get_skill",
    {
      description:
        "Retrieve full details of a codeVolve skill by its UUID, including implementation, tests, examples, and confidence metrics.",
      inputSchema: {
        skill_id: z.string().uuid().describe("UUID of the skill to retrieve"),
        version: z.number().int().min(1).optional().describe("Optional specific version number to retrieve"),
      },
    },
    (args: { skill_id: string; version?: number }) => getSkill(client, args)
  );

  server.registerTool(
    "list_skills",
    {
      description:
        "List and filter codeVolve skills by tag, language, domain, status, or canonical flag. Supports pagination.",
      inputSchema: {
        tag: z.string().optional().describe("Filter by tag"),
        language: z.string().optional().describe("Filter by programming language"),
        domain: z.string().optional().describe("Filter by domain"),
        status: z
          .enum(["unsolved", "partial", "verified", "optimized"])
          .optional()
          .describe("Filter by skill status"),
        is_canonical: z.boolean().optional().describe("Filter to canonical skills only"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of results (default: 20)"),
        next_token: z.string().optional().describe("Pagination token from a previous list response"),
      },
    },
    (args: {
      tag?: string;
      language?: string;
      domain?: string;
      status?: "unsolved" | "partial" | "verified" | "optimized";
      is_canonical?: boolean;
      limit?: number;
      next_token?: string;
    }) => listSkills(client, args)
  );

  server.registerTool(
    "validate_skill",
    {
      description:
        "Run the test suite for a codeVolve skill and update its confidence score. Returns pass/fail counts and updated confidence.",
      inputSchema: {
        skill_id: z.string().uuid().describe("UUID of the skill to validate"),
      },
    },
    (args: { skill_id: string }) => validateSkill(client, args)
  );

  server.registerTool(
    "submit_skill",
    {
      description:
        "Submit a new skill implementation to the codeVolve registry. Requires a complete skill contract including implementation and at least 2 test cases.",
      inputSchema: {
        problem_id: z.string().uuid().describe("UUID of the problem this skill solves"),
        name: z.string().min(1).describe("Short name for the skill"),
        description: z.string().min(1).describe("Description of the algorithm and its complexity"),
        language: z.string().min(1).describe("Programming language"),
        domain: z.array(z.string()).min(1).describe("Domain tags (e.g. [\"arrays\", \"sorting\"])"),
        inputs: z
          .array(z.object({ name: z.string(), type: z.string() }))
          .min(1)
          .describe("Input parameter definitions"),
        outputs: z
          .array(z.object({ name: z.string(), type: z.string() }))
          .min(1)
          .describe("Output value definitions"),
        examples: z
          .array(z.object({ input: z.record(z.unknown()), output: z.record(z.unknown()) }))
          .min(1)
          .describe("Worked examples (min 1)"),
        tests: z
          .array(z.object({ input: z.record(z.unknown()), expected: z.record(z.unknown()) }))
          .min(2)
          .describe("Test cases (min 2)"),
        implementation: z.string().min(1).describe("Complete implementation source code"),
        tags: z.array(z.string()).optional().describe("Optional searchable tags"),
        status: z
          .enum(["unsolved", "partial", "verified", "optimized"])
          .optional()
          .describe("Initial status (default: partial)"),
      },
    },
    (args: {
      problem_id: string;
      name: string;
      description: string;
      language: string;
      domain: string[];
      inputs: Array<{ name: string; type: string }>;
      outputs: Array<{ name: string; type: string }>;
      examples: Array<{ input: Record<string, unknown>; output: Record<string, unknown> }>;
      tests: Array<{ input: Record<string, unknown>; expected: Record<string, unknown> }>;
      implementation: string;
      tags?: string[];
      status?: "unsolved" | "partial" | "verified" | "optimized";
    }) => submitSkill(client, args)
  );

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  // Resource 1: codevolve://skills/{skill_id}
  server.registerResource(
    "skill",
    new ResourceTemplate("codevolve://skills/{skill_id}", { list: undefined }),
    {
      description:
        "Full details of a codeVolve skill including implementation, tests, examples, and confidence metrics.",
      mimeType: "application/json",
    },
    async (uri: URL, _variables: Variables) => {
      const result = await readSkillResource(client, uri.toString());
      return {
        contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }],
      };
    }
  );

  // Resource 2: codevolve://problems/{problem_id}
  server.registerResource(
    "problem",
    new ResourceTemplate("codevolve://problems/{problem_id}", { list: undefined }),
    {
      description: "A codeVolve problem with all associated skill implementations.",
      mimeType: "application/json",
    },
    async (uri: URL, _variables: Variables) => {
      const result = await readProblemResource(client, uri.toString());
      return {
        contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }],
      };
    }
  );

  // Resource 3: codevolve://skills (list with query params)
  server.registerResource(
    "skills-list",
    "codevolve://skills",
    {
      description:
        "Paginated list of codeVolve skills. Supports query parameters: tag, language, domain, status, is_canonical, limit, next_token.",
      mimeType: "application/json",
    },
    async (uri: URL) => {
      const result = await readSkillsListResource(client, uri.toString());
      return {
        contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Prompts
  // -------------------------------------------------------------------------

  for (const promptDef of PROMPT_DEFINITIONS) {
    const argsSchema: Record<string, z.ZodTypeAny> = {};
    for (const arg of promptDef.arguments) {
      const base = z.string().describe(arg.description);
      argsSchema[arg.name] = arg.required ? base : base.optional();
    }

    server.registerPrompt(
      promptDef.name,
      {
        description: promptDef.description,
        argsSchema,
      },
      (args: Record<string, string>) => {
        const messages = promptDef.buildMessages(args);
        return { messages };
      }
    );
  }

  return server;
}

// ---------------------------------------------------------------------------
// Entry point — called by src/mcp/index.ts, not at module load time.
// This keeps the module safe to import in tests without CODEVOLVE_API_URL set.
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const client = createClientFromEnv();
  const server = createServer(client);
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
}
