/**
 * Unit tests for src/mcp/tools.ts
 *
 * Tests verify:
 *   - Tool definitions (names, schemas present)
 *   - Correct HTTP request construction for each tool
 *   - Error handling (API errors, network errors)
 *   - Zod validation rejects invalid inputs
 */

import { jest } from "@jest/globals";
import {
  CodevolveClient,
  ApiError,
  NetworkError,
} from "../../../src/mcp/client";
import {
  resolve,
  execute,
  chain,
  validate,
  listSkills,
  getSkill,
  TOOL_DEFINITIONS,
} from "../../../src/mcp/tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SKILL_UUID_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeMockClient(): jest.Mocked<CodevolveClient> {
  return {
    request: jest.fn(),
  } as unknown as jest.Mocked<CodevolveClient>;
}

// ---------------------------------------------------------------------------
// TOOL_DEFINITIONS — structure checks
// ---------------------------------------------------------------------------

describe("TOOL_DEFINITIONS", () => {
  it("contains exactly 6 tool definitions", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(6);
  });

  it("includes all required tool names", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("resolve");
    expect(names).toContain("execute");
    expect(names).toContain("chain");
    expect(names).toContain("validate");
    expect(names).toContain("list_skills");
    expect(names).toContain("get_skill");
  });

  it("every tool definition has a description string", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("every tool definition has an inputSchema with type:object", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("resolve tool requires intent field", () => {
    const resolveTool = TOOL_DEFINITIONS.find((t) => t.name === "resolve")!;
    expect(resolveTool.inputSchema.required).toContain("intent");
  });

  it("execute tool requires skill_id and inputs", () => {
    const executeTool = TOOL_DEFINITIONS.find((t) => t.name === "execute")!;
    expect(executeTool.inputSchema.required).toContain("skill_id");
    expect(executeTool.inputSchema.required).toContain("inputs");
  });

  it("chain tool requires steps and inputs", () => {
    const chainTool = TOOL_DEFINITIONS.find((t) => t.name === "chain")!;
    expect(chainTool.inputSchema.required).toContain("steps");
    expect(chainTool.inputSchema.required).toContain("inputs");
  });

  it("validate tool requires skill_id", () => {
    const validateTool = TOOL_DEFINITIONS.find((t) => t.name === "validate")!;
    expect(validateTool.inputSchema.required).toContain("skill_id");
  });

  it("get_skill tool requires skill_id", () => {
    const getSkillTool = TOOL_DEFINITIONS.find((t) => t.name === "get_skill")!;
    expect(getSkillTool.inputSchema.required).toContain("skill_id");
  });
});

// ---------------------------------------------------------------------------
// callApi error wrapping (tested via getSkill)
// ---------------------------------------------------------------------------

describe("callApi error wrapping", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
  });

  it("returns isError:true with API error body when ApiError is thrown", async () => {
    client.request.mockRejectedValueOnce(
      new ApiError(404, "Not Found", { error: { code: "NOT_FOUND", message: "Skill not found" } })
    );

    const result = await getSkill(client, { skill_id: SKILL_UUID });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("NOT_FOUND");
  });

  it("returns isError:true with message when NetworkError is thrown", async () => {
    client.request.mockRejectedValueOnce(new NetworkError("Connection refused"));

    const result = await getSkill(client, { skill_id: SKILL_UUID });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Connection refused");
  });

  it("returns isError:true with message for unknown errors", async () => {
    client.request.mockRejectedValueOnce(new Error("Unexpected failure"));

    const result = await getSkill(client, { skill_id: SKILL_UUID });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Unexpected failure");
  });

  it("returns text content with JSON on success", async () => {
    client.request.mockResolvedValueOnce({ skill_id: SKILL_UUID, name: "Two Sum" });

    const result = await getSkill(client, { skill_id: SKILL_UUID });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill_id).toBe(SKILL_UUID);
    expect(parsed.name).toBe("Two Sum");
  });

  it("returns null ApiError body as error message fallback", async () => {
    client.request.mockRejectedValueOnce(
      new ApiError(500, "Internal Server Error", null)
    );

    const result = await getSkill(client, { skill_id: SKILL_UUID });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resolve tool
// ---------------------------------------------------------------------------

describe("resolve", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
    client.request.mockResolvedValue({ skill_id: SKILL_UUID });
  });

  it("sends POST /resolve with intent only", async () => {
    await resolve(client, { intent: "find shortest path" });

    expect(client.request).toHaveBeenCalledWith("POST", "/resolve", {
      intent: "find shortest path",
    });
  });

  it("includes optional tags when provided", async () => {
    await resolve(client, { intent: "sort array", tags: ["arrays", "sorting"] });

    const body = client.request.mock.calls[0][2] as Record<string, unknown>;
    expect(body["tags"]).toEqual(["arrays", "sorting"]);
  });

  it("includes optional language when provided", async () => {
    await resolve(client, { intent: "sort array", language: "python" });

    const body = client.request.mock.calls[0][2] as Record<string, unknown>;
    expect(body["language"]).toBe("python");
  });

  it("omits tags and language when not provided", async () => {
    await resolve(client, { intent: "sort array" });

    const body = client.request.mock.calls[0][2] as Record<string, unknown>;
    expect("tags" in body).toBe(false);
    expect("language" in body).toBe(false);
  });

  it("rejects empty intent string — does NOT call HTTP", async () => {
    await expect(resolve(client, { intent: "" })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects intent longer than 1024 chars — does NOT call HTTP", async () => {
    await expect(resolve(client, { intent: "x".repeat(1025) })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects invalid language enum value — does NOT call HTTP", async () => {
    await expect(resolve(client, { intent: "sort", language: "cobol" })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// execute tool
// ---------------------------------------------------------------------------

describe("execute", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
    client.request.mockResolvedValue({ outputs: { result: 42 }, cache_hit: false });
  });

  it("sends POST /execute with skill_id and inputs", async () => {
    await execute(client, { skill_id: SKILL_UUID, inputs: { n: 5 } });

    expect(client.request).toHaveBeenCalledWith("POST", "/execute", {
      skill_id: SKILL_UUID,
      inputs: { n: 5 },
    });
  });

  it("includes timeout_ms in body when provided", async () => {
    await execute(client, { skill_id: SKILL_UUID, inputs: {}, timeout_ms: 5000 });

    const body = client.request.mock.calls[0][2] as Record<string, unknown>;
    expect(body["timeout_ms"]).toBe(5000);
  });

  it("omits timeout_ms when not provided", async () => {
    await execute(client, { skill_id: SKILL_UUID, inputs: {} });

    const body = client.request.mock.calls[0][2] as Record<string, unknown>;
    expect("timeout_ms" in body).toBe(false);
  });

  it("rejects non-UUID skill_id — does NOT call HTTP", async () => {
    await expect(execute(client, { skill_id: "not-a-uuid", inputs: {} })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects timeout_ms below minimum (100) — does NOT call HTTP", async () => {
    await expect(execute(client, { skill_id: SKILL_UUID, inputs: {}, timeout_ms: 50 })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects timeout_ms above maximum (300000) — does NOT call HTTP", async () => {
    await expect(execute(client, { skill_id: SKILL_UUID, inputs: {}, timeout_ms: 300001 })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chain tool
// ---------------------------------------------------------------------------

describe("chain", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
    client.request.mockResolvedValue({ chain_id: "c1", success: true });
  });

  it("sends POST /execute/chain with steps and inputs", async () => {
    await chain(client, {
      steps: [{ skill_id: SKILL_UUID }],
      inputs: { x: 1 },
    });

    expect(client.request).toHaveBeenCalledWith("POST", "/execute/chain", {
      steps: [{ skill_id: SKILL_UUID }],
      inputs: { x: 1 },
    });
  });

  it("includes input_mapping when provided in step", async () => {
    await chain(client, {
      steps: [{ skill_id: SKILL_UUID, input_mapping: { n: "$input.count" } }],
      inputs: { count: 5 },
    });

    const body = client.request.mock.calls[0][2] as Record<string, unknown>;
    const steps = body["steps"] as Array<{ input_mapping?: Record<string, string> }>;
    expect(steps[0]["input_mapping"]).toEqual({ n: "$input.count" });
  });

  it("sends multiple steps in order", async () => {
    await chain(client, {
      steps: [
        { skill_id: SKILL_UUID },
        { skill_id: SKILL_UUID_2 },
      ],
      inputs: {},
    });

    const body = client.request.mock.calls[0][2] as Record<string, unknown>;
    const steps = body["steps"] as Array<{ skill_id: string }>;
    expect(steps).toHaveLength(2);
    expect(steps[0]["skill_id"]).toBe(SKILL_UUID);
    expect(steps[1]["skill_id"]).toBe(SKILL_UUID_2);
  });

  it("includes timeout_ms when provided", async () => {
    await chain(client, {
      steps: [{ skill_id: SKILL_UUID }],
      inputs: {},
      timeout_ms: 120000,
    });

    const body = client.request.mock.calls[0][2] as Record<string, unknown>;
    expect(body["timeout_ms"]).toBe(120000);
  });

  it("rejects when steps is empty — does NOT call HTTP", async () => {
    await expect(chain(client, { steps: [], inputs: {} })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects when steps exceed 10 — does NOT call HTTP", async () => {
    const steps = Array.from({ length: 11 }, () => ({ skill_id: SKILL_UUID }));
    await expect(chain(client, { steps, inputs: {} })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// validate tool
// ---------------------------------------------------------------------------

describe("validate", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
    client.request.mockResolvedValue({ pass_count: 5, fail_count: 0, confidence: 0.95 });
  });

  it("sends POST /validate/:skill_id", async () => {
    await validate(client, { skill_id: SKILL_UUID });

    expect(client.request).toHaveBeenCalledWith("POST", `/validate/${SKILL_UUID}`);
  });

  it("rejects non-UUID skill_id — does NOT call HTTP", async () => {
    await expect(validate(client, { skill_id: "bad-id" })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// list_skills tool
// ---------------------------------------------------------------------------

describe("listSkills", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
    client.request.mockResolvedValue({ skills: [] });
  });

  it("sends GET /skills with no query string when no filters provided", async () => {
    await listSkills(client, {});

    expect(client.request).toHaveBeenCalledWith("GET", "/skills");
  });

  it("builds tag query param correctly", async () => {
    await listSkills(client, { tag: "sorting" });

    const path = client.request.mock.calls[0][1] as string;
    expect(path).toContain("tag=sorting");
  });

  it("builds language query param correctly", async () => {
    await listSkills(client, { language: "python" });

    const path = client.request.mock.calls[0][1] as string;
    expect(path).toContain("language=python");
  });

  it("builds domain query param correctly", async () => {
    await listSkills(client, { domain: "graphs" });

    const path = client.request.mock.calls[0][1] as string;
    expect(path).toContain("domain=graphs");
  });

  it("builds status query param correctly", async () => {
    await listSkills(client, { status: "verified" });

    const path = client.request.mock.calls[0][1] as string;
    expect(path).toContain("status=verified");
  });

  it("builds is_canonical query param correctly", async () => {
    await listSkills(client, { is_canonical: true });

    const path = client.request.mock.calls[0][1] as string;
    expect(path).toContain("is_canonical=true");
  });

  it("builds limit query param correctly", async () => {
    await listSkills(client, { limit: 50 });

    const path = client.request.mock.calls[0][1] as string;
    expect(path).toContain("limit=50");
  });

  it("builds next_token query param correctly", async () => {
    await listSkills(client, { next_token: "tok123" });

    const path = client.request.mock.calls[0][1] as string;
    expect(path).toContain("next_token=tok123");
  });

  it("builds multiple query params together", async () => {
    await listSkills(client, { language: "python", domain: "graphs", limit: 10 });

    const path = client.request.mock.calls[0][1] as string;
    expect(path).toContain("language=python");
    expect(path).toContain("domain=graphs");
    expect(path).toContain("limit=10");
  });

  it("rejects invalid status enum — does NOT call HTTP", async () => {
    await expect(listSkills(client, { status: "unknown" as "verified" })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects limit above 100 — does NOT call HTTP", async () => {
    await expect(listSkills(client, { limit: 101 })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects limit below 1 — does NOT call HTTP", async () => {
    await expect(listSkills(client, { limit: 0 })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// get_skill tool
// ---------------------------------------------------------------------------

describe("getSkill", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
    client.request.mockResolvedValue({ skill_id: SKILL_UUID, name: "Two Sum" });
  });

  it("sends GET /skills/:id without version", async () => {
    await getSkill(client, { skill_id: SKILL_UUID });

    expect(client.request).toHaveBeenCalledWith("GET", `/skills/${SKILL_UUID}`);
  });

  it("appends ?version= when version is provided", async () => {
    await getSkill(client, { skill_id: SKILL_UUID, version: 3 });

    expect(client.request).toHaveBeenCalledWith("GET", `/skills/${SKILL_UUID}?version=3`);
  });

  it("rejects non-UUID skill_id — does NOT call HTTP", async () => {
    await expect(getSkill(client, { skill_id: "not-a-uuid" })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("rejects version below 1 — does NOT call HTTP", async () => {
    await expect(getSkill(client, { skill_id: SKILL_UUID, version: 0 })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });
});
