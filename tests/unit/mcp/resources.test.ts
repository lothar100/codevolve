/**
 * Unit tests for src/mcp/resources.ts — URI parsing
 */

import { CodevolveClient } from "../../../src/mcp/client.js";
import {
  readSkillResource,
  readProblemResource,
  readSkillsListResource,
} from "../../../src/mcp/resources.js";

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

const mockRequest = jest.fn();
const client = {
  request: mockRequest,
} as unknown as CodevolveClient;

const SKILL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROBLEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  jest.clearAllMocks();
  mockRequest.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// readSkillResource
// ---------------------------------------------------------------------------

describe("readSkillResource", () => {
  it("extracts skill_id from URI and calls GET /skills/:id", async () => {
    await readSkillResource(client, `codevolve://skills/${SKILL_ID}`);
    expect(mockRequest).toHaveBeenCalledWith("GET", `/skills/${SKILL_ID}`);
  });

  it("returns application/json content", async () => {
    const result = await readSkillResource(client, `codevolve://skills/${SKILL_ID}`);
    expect(result.mimeType).toBe("application/json");
    expect(result.uri).toBe(`codevolve://skills/${SKILL_ID}`);
  });

  it("serializes result as JSON text", async () => {
    mockRequest.mockResolvedValueOnce({ skill_id: SKILL_ID, name: "Test" });
    const result = await readSkillResource(client, `codevolve://skills/${SKILL_ID}`);
    const parsed = JSON.parse(result.text);
    expect(parsed.skill_id).toBe(SKILL_ID);
  });

  it("throws structured error on malformed URI", async () => {
    await expect(readSkillResource(client, "not a uri at all")).rejects.toThrow(
      "Invalid resource URI"
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// readProblemResource
// ---------------------------------------------------------------------------

describe("readProblemResource", () => {
  it("extracts problem_id from URI and calls GET /problems/:id", async () => {
    await readProblemResource(client, `codevolve://problems/${PROBLEM_ID}`);
    expect(mockRequest).toHaveBeenCalledWith("GET", `/problems/${PROBLEM_ID}`);
  });

  it("returns application/json content", async () => {
    const result = await readProblemResource(client, `codevolve://problems/${PROBLEM_ID}`);
    expect(result.mimeType).toBe("application/json");
  });

  it("throws structured error on malformed URI", async () => {
    await expect(readProblemResource(client, ":::bad")).rejects.toThrow(
      "Invalid resource URI"
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// readSkillsListResource
// ---------------------------------------------------------------------------

describe("readSkillsListResource", () => {
  it("calls GET /skills with no query string when URI has no params", async () => {
    await readSkillsListResource(client, "codevolve://skills");
    expect(mockRequest).toHaveBeenCalledWith("GET", "/skills");
  });

  it("forwards query params from URI to API path", async () => {
    await readSkillsListResource(
      client,
      "codevolve://skills?language=python&domain=graphs"
    );
    const path = mockRequest.mock.calls[0][1] as string;
    expect(path).toContain("language=python");
    expect(path).toContain("domain=graphs");
  });

  it("returns application/json content", async () => {
    const result = await readSkillsListResource(client, "codevolve://skills");
    expect(result.mimeType).toBe("application/json");
  });
});
