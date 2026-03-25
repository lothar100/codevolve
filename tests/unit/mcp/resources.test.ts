/**
 * Unit tests for src/mcp/resources.ts
 *
 * Tests verify:
 *   - Resource URI parsing (skill_id and problem_id extraction)
 *   - Correct HTTP request construction
 *   - Response content shape (uri, mimeType, text)
 */

import { jest } from "@jest/globals";
import { CodevolveClient } from "../../../src/mcp/client";
import {
  readSkillResource,
  readProblemResource,
  RESOURCE_DEFINITIONS,
} from "../../../src/mcp/resources";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROBLEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeMockClient(): jest.Mocked<CodevolveClient> {
  return {
    request: jest.fn(),
  } as unknown as jest.Mocked<CodevolveClient>;
}

// ---------------------------------------------------------------------------
// RESOURCE_DEFINITIONS — structure checks
// ---------------------------------------------------------------------------

describe("RESOURCE_DEFINITIONS", () => {
  it("contains exactly 2 resource definitions", () => {
    expect(RESOURCE_DEFINITIONS).toHaveLength(2);
  });

  it("includes skills URI template", () => {
    const uriTemplates = RESOURCE_DEFINITIONS.map((r) => r.uriTemplate);
    expect(uriTemplates).toContain("codevolve://skills/{skill_id}");
  });

  it("includes problems URI template", () => {
    const uriTemplates = RESOURCE_DEFINITIONS.map((r) => r.uriTemplate);
    expect(uriTemplates).toContain("codevolve://problems/{problem_id}");
  });

  it("every resource has application/json mimeType", () => {
    for (const resource of RESOURCE_DEFINITIONS) {
      expect(resource.mimeType).toBe("application/json");
    }
  });
});

// ---------------------------------------------------------------------------
// readSkillResource
// ---------------------------------------------------------------------------

describe("readSkillResource", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
    client.request.mockResolvedValue({ skill_id: SKILL_ID, name: "Two Sum" });
  });

  it("extracts skill_id from URI and calls GET /skills/:id", async () => {
    await readSkillResource(client, `codevolve://skills/${SKILL_ID}`);

    expect(client.request).toHaveBeenCalledWith("GET", `/skills/${SKILL_ID}`);
  });

  it("returns the original URI in the result", async () => {
    const result = await readSkillResource(client, `codevolve://skills/${SKILL_ID}`);

    expect(result.uri).toBe(`codevolve://skills/${SKILL_ID}`);
  });

  it("returns application/json mimeType", async () => {
    const result = await readSkillResource(client, `codevolve://skills/${SKILL_ID}`);

    expect(result.mimeType).toBe("application/json");
  });

  it("serializes API response as JSON text", async () => {
    const result = await readSkillResource(client, `codevolve://skills/${SKILL_ID}`);

    const parsed = JSON.parse(result.text);
    expect(parsed.skill_id).toBe(SKILL_ID);
    expect(parsed.name).toBe("Two Sum");
  });

  it("propagates errors from the client", async () => {
    client.request.mockRejectedValueOnce(new Error("Not found"));

    await expect(readSkillResource(client, `codevolve://skills/${SKILL_ID}`)).rejects.toThrow(
      "Not found"
    );
  });
});

// ---------------------------------------------------------------------------
// readProblemResource
// ---------------------------------------------------------------------------

describe("readProblemResource", () => {
  let client: jest.Mocked<CodevolveClient>;

  beforeEach(() => {
    client = makeMockClient();
    client.request.mockResolvedValue({ problem_id: PROBLEM_ID, title: "Two Sum Problem" });
  });

  it("extracts problem_id from URI and calls GET /problems/:id", async () => {
    await readProblemResource(client, `codevolve://problems/${PROBLEM_ID}`);

    expect(client.request).toHaveBeenCalledWith("GET", `/problems/${PROBLEM_ID}`);
  });

  it("returns the original URI in the result", async () => {
    const result = await readProblemResource(client, `codevolve://problems/${PROBLEM_ID}`);

    expect(result.uri).toBe(`codevolve://problems/${PROBLEM_ID}`);
  });

  it("returns application/json mimeType", async () => {
    const result = await readProblemResource(client, `codevolve://problems/${PROBLEM_ID}`);

    expect(result.mimeType).toBe("application/json");
  });

  it("serializes API response as JSON text", async () => {
    const result = await readProblemResource(client, `codevolve://problems/${PROBLEM_ID}`);

    const parsed = JSON.parse(result.text);
    expect(parsed.problem_id).toBe(PROBLEM_ID);
    expect(parsed.title).toBe("Two Sum Problem");
  });

  it("propagates errors from the client", async () => {
    client.request.mockRejectedValueOnce(new Error("API unreachable"));

    await expect(
      readProblemResource(client, `codevolve://problems/${PROBLEM_ID}`)
    ).rejects.toThrow("API unreachable");
  });
});
