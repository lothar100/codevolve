import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
// Server
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.registerTool(
  "resolve_skill",
  {
    description:
      "Route an intent string to the best matching codeVolve skill using canonical intent routing and optional metadata filters.",
    inputSchema: {
      intent: z.string().min(1).describe("Natural language description of the problem to solve"),
      tags: z.array(z.string()).optional().describe("Optional list of tags to filter results"),
      language: z.string().optional().describe("Optional target programming language"),
    },
  },
  async (args) => resolveSkill(args)
);

server.registerTool(
  "chain_skills",
  {
    description:
      "Build an ordered local execution plan from multiple codeVolve skills. The API returns a chain plan; the caller still executes each step locally.",
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
  async (args) => chainSkills(args)
);

server.registerTool(
  "get_skill",
  {
    description:
      "Retrieve a codeVolve skill payload by its UUID. Prefer this only when you need the full implementation and metadata, not just routing context.",
    inputSchema: {
      skill_id: z.string().uuid().describe("UUID of the skill to retrieve"),
      version: z.number().int().min(1).optional().describe("Optional specific version number to retrieve"),
    },
  },
  async (args) => getSkill(args)
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
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of results (default: 20)"),
      next_token: z.string().optional().describe("Pagination token from a previous list response"),
    },
  },
  async (args) => listSkills(args)
);

server.registerTool(
  "feedback_skill",
  {
    description:
      "Report local test feedback for a codeVolve skill and update its confidence score.",
    inputSchema: {
      skill_id: z.string().uuid().describe("UUID of the skill to send feedback for"),
    },
  },
  async (args) => feedbackSkill(args)
);

server.registerTool(
  "validate_skill",
  {
    description:
      "Legacy alias for feedback reporting. Submit local test feedback for a codeVolve skill.",
    inputSchema: {
      skill_id: z.string().uuid().describe("UUID of the skill to validate"),
    },
  },
  async (args) => validateSkill(args)
);

server.registerTool(
  "submit_skill",
  {
    description:
      "Submit a new skill contract to the codeVolve registry. Requires a complete implementation and at least 2 test cases.",
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
  async (args) => submitSkill(args)
);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

// Resource 1: codevolve://skills/{skill_id}
server.registerResource(
  "skill",
  new ResourceTemplate("codevolve://skills/{skill_id}", { list: undefined }),
  {
    description:
      "Full details of a codeVolve skill including implementation, tests, examples, and confidence metrics.",
    mimeType: "application/json",
  },
  async (uri) => {
    const result = await readSkillResource(uri.toString());
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
  async (uri) => {
    const result = await readProblemResource(uri.toString());
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
  async (uri) => {
    const result = await readSkillsListResource(uri.toString());
    return {
      contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }],
    };
  }
);

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

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
    (args) => {
      const messages = promptDef.buildMessages(args as Record<string, string>);
      return { messages };
    }
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

await server.connect(transport);
