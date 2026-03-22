/**
 * Unit tests for src/tools.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock client before importing tools so process.exit(1) in client.ts never runs
vi.mock("../src/client.js", () => ({
  client: { request: vi.fn() },
}));

import { client } from "../src/client.js";
import {
  resolveSkill,
  executeSkill,
  chainSkills,
  getSkill,
  listSkills,
  validateSkill,
  submitSkill,
} from "../src/tools.js";

const mockRequest = vi.mocked(client.request);

const SKILL_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROBLEM_UUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// callApi — error wrapping
// ---------------------------------------------------------------------------

describe("callApi error wrapping", () => {
  it("returns isError:true with parsed body on HTTP error", async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error("HTTP 404"), {
        statusCode: 404,
        body: { error: { code: "NOT_FOUND", message: "Skill not found" } },
      })
    );

    const result = await getSkill({ skill_id: SKILL_UUID });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("NOT_FOUND");
  });

  it("returns isError:true with message fallback when body is undefined", async () => {
    mockRequest.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await getSkill({ skill_id: SKILL_UUID });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Network timeout");
  });

  it("returns text content with JSON on success", async () => {
    mockRequest.mockResolvedValueOnce({ skill_id: SKILL_UUID, name: "Two Sum" });

    const result = await getSkill({ skill_id: SKILL_UUID });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skill_id).toBe(SKILL_UUID);
  });
});

// ---------------------------------------------------------------------------
// resolveSkill
// ---------------------------------------------------------------------------

describe("resolveSkill", () => {
  it("sends POST /resolve with intent", async () => {
    mockRequest.mockResolvedValueOnce({ skill_id: SKILL_UUID });

    await resolveSkill({ intent: "find shortest path" });

    expect(mockRequest).toHaveBeenCalledWith("POST", "/resolve", {
      intent: "find shortest path",
    });
  });

  it("includes optional tags and language when provided", async () => {
    mockRequest.mockResolvedValueOnce({});

    await resolveSkill({ intent: "sort array", tags: ["arrays"], language: "python" });

    expect(mockRequest).toHaveBeenCalledWith("POST", "/resolve", {
      intent: "sort array",
      tags: ["arrays"],
      language: "python",
    });
  });

  it("omits tags and language when not provided", async () => {
    mockRequest.mockResolvedValueOnce({});

    await resolveSkill({ intent: "sort array" });

    const callArgs = mockRequest.mock.calls[0][2] as Record<string, unknown>;
    expect("tags" in callArgs).toBe(false);
    expect("language" in callArgs).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeSkill
// ---------------------------------------------------------------------------

describe("executeSkill", () => {
  it("sends POST /execute with skill_id and inputs", async () => {
    mockRequest.mockResolvedValueOnce({ outputs: { result: 42 } });

    await executeSkill({ skill_id: SKILL_UUID, inputs: { n: 5 } });

    expect(mockRequest).toHaveBeenCalledWith("POST", "/execute", {
      skill_id: SKILL_UUID,
      inputs: { n: 5 },
    });
  });

  it("includes timeout_ms when provided", async () => {
    mockRequest.mockResolvedValueOnce({});

    await executeSkill({ skill_id: SKILL_UUID, inputs: {}, timeout_ms: 5000 });

    const body = mockRequest.mock.calls[0][2] as Record<string, unknown>;
    expect(body["timeout_ms"]).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// chainSkills
// ---------------------------------------------------------------------------

describe("chainSkills", () => {
  it("sends POST /execute/chain with steps and inputs", async () => {
    mockRequest.mockResolvedValueOnce({ chain_id: "c1" });

    await chainSkills({
      steps: [{ skill_id: SKILL_UUID }],
      inputs: { x: 1 },
    });

    expect(mockRequest).toHaveBeenCalledWith("POST", "/execute/chain", {
      steps: [{ skill_id: SKILL_UUID }],
      inputs: { x: 1 },
    });
  });

  it("rejects when steps is empty — does NOT call HTTP", async () => {
    await expect(chainSkills({ steps: [], inputs: {} })).rejects.toThrow();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("rejects when steps exceed 10 — does NOT call HTTP", async () => {
    const steps = Array.from({ length: 11 }, () => ({ skill_id: SKILL_UUID }));
    await expect(chainSkills({ steps, inputs: {} })).rejects.toThrow();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getSkill
// ---------------------------------------------------------------------------

describe("getSkill", () => {
  it("sends GET /skills/:id without version", async () => {
    mockRequest.mockResolvedValueOnce({ skill_id: SKILL_UUID });

    await getSkill({ skill_id: SKILL_UUID });

    expect(mockRequest).toHaveBeenCalledWith("GET", `/skills/${SKILL_UUID}`);
  });

  it("appends ?version= when version is provided", async () => {
    mockRequest.mockResolvedValueOnce({});

    await getSkill({ skill_id: SKILL_UUID, version: 3 });

    expect(mockRequest).toHaveBeenCalledWith("GET", `/skills/${SKILL_UUID}?version=3`);
  });
});

// ---------------------------------------------------------------------------
// listSkills
// ---------------------------------------------------------------------------

describe("listSkills", () => {
  it("sends GET /skills with no params when no filters", async () => {
    mockRequest.mockResolvedValueOnce({ skills: [] });

    await listSkills({});

    expect(mockRequest).toHaveBeenCalledWith("GET", "/skills");
  });

  it("builds correct query string from filters", async () => {
    mockRequest.mockResolvedValueOnce({ skills: [] });

    await listSkills({ language: "python", domain: "graphs", limit: 10 });

    const path = mockRequest.mock.calls[0][1] as string;
    expect(path).toContain("language=python");
    expect(path).toContain("domain=graphs");
    expect(path).toContain("limit=10");
  });
});

// ---------------------------------------------------------------------------
// validateSkill
// ---------------------------------------------------------------------------

describe("validateSkill", () => {
  it("sends POST /validate/:skill_id", async () => {
    mockRequest.mockResolvedValueOnce({ pass_count: 5 });

    await validateSkill({ skill_id: SKILL_UUID });

    expect(mockRequest).toHaveBeenCalledWith("POST", `/validate/${SKILL_UUID}`);
  });
});

// ---------------------------------------------------------------------------
// submitSkill — Zod enforcement
// ---------------------------------------------------------------------------

const validSubmit = {
  problem_id: PROBLEM_UUID,
  name: "Two Sum",
  description: "Returns indices of two numbers that add to target",
  language: "python",
  domain: ["arrays"],
  inputs: [{ name: "nums", type: "number[]" }, { name: "target", type: "number" }],
  outputs: [{ name: "indices", type: "number[]" }],
  examples: [{ input: { nums: [2, 7], target: 9 }, output: { indices: [0, 1] } }],
  tests: [
    { input: { nums: [2, 7], target: 9 }, expected: { indices: [0, 1] } },
    { input: { nums: [3, 3], target: 6 }, expected: { indices: [0, 1] } },
  ],
  implementation: "def solve(nums, target): return [0, 1]",
};

describe("submitSkill Zod enforcement", () => {
  it("accepts a valid full skill contract", async () => {
    mockRequest.mockResolvedValueOnce({ skill_id: SKILL_UUID, version: 1 });

    const result = await submitSkill(validSubmit);

    expect(result.isError).toBeFalsy();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects when tests has fewer than 2 items — does NOT call HTTP", async () => {
    await expect(
      submitSkill({ ...validSubmit, tests: [validSubmit.tests[0]] })
    ).rejects.toThrow();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("rejects when examples is empty — does NOT call HTTP", async () => {
    await expect(submitSkill({ ...validSubmit, examples: [] })).rejects.toThrow();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("rejects when a required field is missing — does NOT call HTTP", async () => {
    const { implementation: _omit, ...withoutImpl } = validSubmit;
    await expect(submitSkill(withoutImpl)).rejects.toThrow();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
