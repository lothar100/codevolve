/**
 * codeVolve MCP Server
 *
 * A stdio JSON-RPC MCP server that wraps the codeVolve HTTP API.
 * This is a long-running process, not a Lambda.
 *
 * Configuration via environment variables:
 *   CODEVOLVE_API_URL     — required, base URL of the codeVolve API
 *   CODEVOLVE_API_KEY     — optional, forwarded as Authorization: Bearer {key}
 *   CODEVOLVE_AGENT_ID    — optional, sent as X-Agent-Id (default: mcp-server)
 *   CODEVOLVE_TIMEOUT_MS  — optional, HTTP timeout (default: 35000)
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClientFromEnv } from "./client.js";
import {
  resolve,
  execute,
  chain,
  validate,
  listSkills,
  getSkill,
} from "./tools.js";
import { readSkillResource, readProblemResource } from "./resources.js";

// ---------------------------------------------------------------------------
// Validate required config early — fail fast with a clear message
// ---------------------------------------------------------------------------

const client = createClientFromEnv();

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: "codevolve", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.registerTool(
  "resolve",
  {
    description:
      "Map a natural-language intent to the best matching skill in the registry. " +
      "Returns the top match with its confidence score. " +
      "Check confidence before proceeding — below 0.7 means the match is unreliable.",
    inputSchema: {
      intent: z
        .string()
        .min(1)
        .max(1024)
        .describe(
          "Natural language description of what you need. " +
            "Example: 'find the shortest path between two nodes in a weighted graph'."
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe("Optional. Narrow results to skills with all of these tags."),
      language: z
        .enum(["python", "javascript", "typescript", "go", "rust", "java", "cpp", "c"])
        .optional()
        .describe("Optional. Prefer skills in this language."),
    },
  },
  async (args) => resolve(client, args)
);

server.registerTool(
  "execute",
  {
    description:
      "Run a skill with the provided inputs. Returns the skill's typed outputs. " +
      "Automatically uses the cache when available.",
    inputSchema: {
      skill_id: z
        .string()
        .uuid()
        .describe("UUID of the skill to execute. Obtain from resolve."),
      inputs: z
        .record(z.unknown())
        .describe("Key-value pairs matching the skill's declared input schema."),
      timeout_ms: z
        .number()
        .int()
        .min(100)
        .max(300000)
        .optional()
        .describe("Optional. Execution timeout in milliseconds. Defaults to 30000."),
    },
  },
  async (args) => execute(client, args)
);

server.registerTool(
  "chain",
  {
    description:
      "Execute a sequence of skills in order, automatically piping outputs from one step " +
      "to the inputs of the next. If any step fails, execution halts and partial results are returned.",
    inputSchema: {
      steps: z
        .array(
          z.object({
            skill_id: z.string().uuid().describe("UUID of the skill to run at this step."),
            input_mapping: z
              .record(z.string())
              .optional()
              .describe(
                "Optional. Maps this step's input field names to values from chain inputs or prior step outputs."
              ),
          })
        )
        .min(1)
        .max(10)
        .describe("Ordered list of skills to execute."),
      inputs: z
        .record(z.unknown())
        .describe("Initial inputs for the chain."),
      timeout_ms: z
        .number()
        .int()
        .min(100)
        .max(600000)
        .optional()
        .describe("Optional. Total chain timeout in milliseconds. Defaults to 60000."),
    },
  },
  async (args) => chain(client, args)
);

server.registerTool(
  "validate",
  {
    description:
      "Run the test suite for a skill and update its confidence score. " +
      "Returns pass/fail counts and updated confidence.",
    inputSchema: {
      skill_id: z.string().uuid().describe("UUID of the skill to validate."),
    },
  },
  async (args) => validate(client, args)
);

server.registerTool(
  "list_skills",
  {
    description:
      "List and filter codeVolve skills by tag, language, domain, status, or canonical flag. " +
      "Supports pagination.",
    inputSchema: {
      tag: z.string().optional().describe("Filter by tag."),
      language: z.string().optional().describe("Filter by programming language."),
      domain: z.string().optional().describe("Filter by domain."),
      status: z
        .enum(["unsolved", "partial", "verified", "optimized"])
        .optional()
        .describe("Filter by skill status."),
      is_canonical: z.boolean().optional().describe("Filter to canonical skills only."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of results (default: 20)."),
      next_token: z
        .string()
        .optional()
        .describe("Pagination token from a previous list response."),
    },
  },
  async (args) => listSkills(client, args)
);

server.registerTool(
  "get_skill",
  {
    description:
      "Retrieve full details for a skill by ID, including its implementation, tests, " +
      "examples, and confidence score.",
    inputSchema: {
      skill_id: z.string().uuid().describe("UUID of the skill to retrieve."),
      version: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Optional specific version number to retrieve."),
    },
  },
  async (args) => getSkill(client, args)
);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.registerResource(
  "skill",
  new ResourceTemplate("codevolve://skills/{skill_id}", { list: undefined }),
  {
    description:
      "Full details of a codeVolve skill including implementation, tests, examples, and confidence metrics.",
    mimeType: "application/json",
  },
  async (uri) => {
    const result = await readSkillResource(client, uri.toString());
    return {
      contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }],
    };
  }
);

server.registerResource(
  "problem",
  new ResourceTemplate("codevolve://problems/{problem_id}", { list: undefined }),
  {
    description: "A codeVolve problem with all associated skill implementations.",
    mimeType: "application/json",
  },
  async (uri) => {
    const result = await readProblemResource(client, uri.toString());
    return {
      contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
