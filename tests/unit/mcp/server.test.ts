/**
 * Unit tests for src/mcp/server.ts
 *
 * Verifies that createServer registers the correct tool names (matching DESIGN-06),
 * all 7 tools are present, and the module is safe to import without CODEVOLVE_API_URL set.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "../../../src/mcp/server.js";
import { CodevolveClient } from "../../../src/mcp/client.js";

// ---------------------------------------------------------------------------
// Mock client — createServer accepts an injected client, so no env vars needed
// ---------------------------------------------------------------------------

const mockRequest = jest.fn();
const mockClient = {
  request: mockRequest,
} as unknown as CodevolveClient;

// ---------------------------------------------------------------------------
// createServer export
// ---------------------------------------------------------------------------

describe("createServer", () => {
  it("is exported as a named function", () => {
    expect(typeof createServer).toBe("function");
  });

  it("returns an McpServer instance", () => {
    const server = createServer(mockClient);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("does not throw when CODEVOLVE_API_URL is not set", () => {
    const savedUrl = process.env["CODEVOLVE_API_URL"];
    delete process.env["CODEVOLVE_API_URL"];
    // createServer receives an injected client — no env var lookup happens
    expect(() => createServer(mockClient)).not.toThrow();
    if (savedUrl !== undefined) {
      process.env["CODEVOLVE_API_URL"] = savedUrl;
    }
  });
});

// ---------------------------------------------------------------------------
// Tool registration — names must match DESIGN-06 §1
// ---------------------------------------------------------------------------

describe("registered tools", () => {
  let server: McpServer;

  beforeEach(() => {
    jest.clearAllMocks();
    server = createServer(mockClient);
  });

  const EXPECTED_TOOL_NAMES = [
    "resolve_skill",
    "execute_skill",
    "chain_skills",
    "get_skill",
    "list_skills",
    "validate_skill",
    "submit_skill",
  ] as const;

  it("registers exactly 7 tools", () => {
    // Access internal registry to count registered tools
    const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(Object.keys(registeredTools)).toHaveLength(7);
  });

  for (const toolName of EXPECTED_TOOL_NAMES) {
    it(`registers tool: ${toolName}`, () => {
      const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools;
      expect(registeredTools).toHaveProperty(toolName);
    });
  }

  it("does NOT register old non-spec tool name 'resolve'", () => {
    const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(registeredTools).not.toHaveProperty("resolve");
  });

  it("does NOT register old non-spec tool name 'execute'", () => {
    const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(registeredTools).not.toHaveProperty("execute");
  });

  it("does NOT register old non-spec tool name 'chain'", () => {
    const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(registeredTools).not.toHaveProperty("chain");
  });

  it("does NOT register old non-spec tool name 'validate'", () => {
    const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(registeredTools).not.toHaveProperty("validate");
  });
});

// ---------------------------------------------------------------------------
// Resource registration
// ---------------------------------------------------------------------------

describe("registered resources", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createServer(mockClient);
  });

  it("registers 3 resources (skill, problem, skills-list)", () => {
    const resources = (
      server as unknown as {
        _registeredResources: Record<string, unknown>;
        _registeredResourceTemplates: Record<string, unknown>;
      }
    );
    const totalResources =
      Object.keys(resources._registeredResources).length +
      Object.keys(resources._registeredResourceTemplates).length;
    expect(totalResources).toBe(3);
  });
});
