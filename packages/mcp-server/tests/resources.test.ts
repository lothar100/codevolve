/**
 * Unit tests for src/resources.ts — URI parsing
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/client.js", () => ({
  client: { request: vi.fn() },
}));

import { client } from "../src/client.js";
import {
  readSkillResource,
  readProblemResource,
  readSkillsListResource,
} from "../src/resources.js";

const mockRequest = vi.mocked(client.request);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequest.mockResolvedValue({ ok: true });
});

const SKILL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROBLEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("readSkillResource", () => {
  it("extracts skill_id from URI and calls GET /skills/:id", async () => {
    await readSkillResource(`codevolve://skills/${SKILL_ID}`);
    expect(mockRequest).toHaveBeenCalledWith("GET", `/skills/${SKILL_ID}`);
  });

  it("returns application/json content", async () => {
    const result = await readSkillResource(`codevolve://skills/${SKILL_ID}`);
    expect(result.mimeType).toBe("application/json");
    expect(result.uri).toBe(`codevolve://skills/${SKILL_ID}`);
  });

  it("serializes result as JSON text", async () => {
    mockRequest.mockResolvedValueOnce({ skill_id: SKILL_ID, name: "Test" });
    const result = await readSkillResource(`codevolve://skills/${SKILL_ID}`);
    const parsed = JSON.parse(result.text);
    expect(parsed.skill_id).toBe(SKILL_ID);
  });
});

describe("readProblemResource", () => {
  it("extracts problem_id from URI and calls GET /problems/:id", async () => {
    await readProblemResource(`codevolve://problems/${PROBLEM_ID}`);
    expect(mockRequest).toHaveBeenCalledWith("GET", `/problems/${PROBLEM_ID}`);
  });

  it("returns application/json content", async () => {
    const result = await readProblemResource(`codevolve://problems/${PROBLEM_ID}`);
    expect(result.mimeType).toBe("application/json");
  });
});

describe("readSkillsListResource", () => {
  it("calls GET /skills with no query string when URI has no params", async () => {
    await readSkillsListResource("codevolve://skills");
    expect(mockRequest).toHaveBeenCalledWith("GET", "/skills");
  });

  it("forwards query params from URI to API path", async () => {
    await readSkillsListResource("codevolve://skills?language=python&domain=graphs");
    const path = mockRequest.mock.calls[0][1] as string;
    expect(path).toContain("language=python");
    expect(path).toContain("domain=graphs");
  });

  it("returns application/json content", async () => {
    const result = await readSkillsListResource("codevolve://skills");
    expect(result.mimeType).toBe("application/json");
  });
});
