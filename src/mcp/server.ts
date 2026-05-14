import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";

import type { CodevolveClient } from "./client.js";
import { createClientFromEnv } from "./client.js";
import {
  resolveSkill,
  chainSkills,
  getSkill,
  listSkills,
  feedbackSkill,
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
        "Compatibility alias for intent routing. Route a natural-language intent to codeVolve's /intent API and return the best matching skills for the caller to inspect and run locally.",
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
    "chain_skills",
    {
      description:
        "Build an ordered local execution plan from multiple codeVolve skill intents. The API returns routing guidance only; the caller still fetches implementations and executes each step locally.",
      inputSchema: {
        steps: z
          .array(
            z.object({
              intent: z.string().min(1).describe("Natural-language description of this step"),
              language: z.string().optional().describe("Preferred language for this step"),
              tags: z.array(z.string()).optional().describe("Optional tags to narrow the search"),
            })
          )
          .min(2)
          .max(10)
          .describe("Ordered list of steps to resolve (minimum 2)"),
      },
    },
    (args: { steps: Array<{ intent: string; language?: string; tags?: string[] }> }) =>
      chainSkills(client, args)
  );

  server.registerTool(
    "get_skill",
    {
      description:
        "Retrieve full details of a codeVolve skill by its UUID, including the implementation, tests, examples, and caller-reported validation metrics needed for local execution.",
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
    "feedback_skill",
    {
      description:
        "Report caller-run local test feedback for a codeVolve skill and update its confidence score. The caller executes the skill locally, then reports aggregate pass/fail counts through /validate.",
      inputSchema: {
        skill_id: z.string().uuid().describe("UUID of the skill to send feedback for"),
        pass_count: z.number().int().min(0).describe("Number of tests that passed"),
        fail_count: z.number().int().min(0).describe("Number of tests that failed"),
        total_tests: z.number().int().min(1).describe("Total number of tests run"),
      },
    },
    (args: { skill_id: string; pass_count: number; fail_count: number; total_tests: number }) =>
      feedbackSkill(client, args)
  );

  server.registerTool(
    "validate_skill",
    {
      description:
        "Compatibility alias for feedback_skill. Report caller-run local test results for a codeVolve skill through the current /validate feedback contract.",
      inputSchema: {
        skill_id: z.string().uuid().describe("UUID of the skill to validate"),
        pass_count: z.number().int().min(0).describe("Number of tests that passed"),
        fail_count: z.number().int().min(0).describe("Number of tests that failed"),
        total_tests: z.number().int().min(1).describe("Total number of tests run"),
      },
    },
    (args: { skill_id: string; pass_count: number; fail_count: number; total_tests: number }) =>
      validateSkill(client, args)
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
        "Full details of a codeVolve skill including implementation, tests, examples, and caller-reported validation metrics.",
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
        "Paginated list of codeVolve skills for intent routing and local execution. Supports query parameters: tag, language, domain, status, is_canonical, limit, next_token.",
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
