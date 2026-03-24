/**
 * Unit tests for src/evolve/skillParser.ts
 *
 * Coverage:
 *   parseClaudeSkillResponse — bare JSON, markdown fence, prose + fence, invalid
 *   repairTestCases — swaps output→expected, leaves expected alone, handles non-objects
 */

import {
  parseClaudeSkillResponse,
  repairTestCases,
  ClaudeSkillResponseSchema,
} from "../../../src/evolve/skillParser.js";

// ---------------------------------------------------------------------------
// parseClaudeSkillResponse
// ---------------------------------------------------------------------------

describe("parseClaudeSkillResponse", () => {
  it("parses bare JSON (no fences)", () => {
    const input = JSON.stringify({ name: "sort list", language: "python" });
    const result = parseClaudeSkillResponse(input);
    expect(result).toEqual({ name: "sort list", language: "python" });
  });

  it("parses JSON inside ```json fence", () => {
    const inner = { name: "binary search", language: "python", domain: ["arrays"] };
    const input = "```json\n" + JSON.stringify(inner) + "\n```";
    const result = parseClaudeSkillResponse(input);
    expect(result).toEqual(inner);
  });

  it("parses JSON inside plain ``` fence (no language tag)", () => {
    const inner = { name: "merge sort", language: "javascript" };
    const input = "```\n" + JSON.stringify(inner) + "\n```";
    const result = parseClaudeSkillResponse(input);
    expect(result).toEqual(inner);
  });

  it("parses JSON preceded by prose text", () => {
    const inner = { name: "two sum", language: "python" };
    const input =
      "Here is the generated skill for you:\n```json\n" +
      JSON.stringify(inner) +
      "\n```\nHope that helps!";
    const result = parseClaudeSkillResponse(input);
    expect(result).toEqual(inner);
  });

  it("falls back to first { when no fence present", () => {
    // Claude occasionally returns bare JSON with some leading text.
    const inner = { name: "quick sort" };
    const input = "The skill is: " + JSON.stringify(inner);
    const result = parseClaudeSkillResponse(input);
    expect(result).toEqual(inner);
  });

  it("throws SyntaxError when no JSON object is found at all", () => {
    expect(() => parseClaudeSkillResponse("No JSON here at all.")).toThrow(
      SyntaxError,
    );
  });

  it("throws SyntaxError when fence content is malformed JSON", () => {
    const input = "```json\n{ not valid json }\n```";
    expect(() => parseClaudeSkillResponse(input)).toThrow(SyntaxError);
  });

  it("throws SyntaxError when bare text has opening brace but malformed content", () => {
    expect(() =>
      parseClaudeSkillResponse("{ this is not valid JSON"),
    ).toThrow(SyntaxError);
  });

  it("preserves nested objects and arrays in parsed JSON", () => {
    const inner = {
      name: "topological sort",
      inputs: [{ name: "graph", type: "object" }],
      tests: [{ input: { graph: {} }, expected: { order: [] } }],
    };
    const input = "```json\n" + JSON.stringify(inner) + "\n```";
    const result = parseClaudeSkillResponse(input);
    expect(result).toEqual(inner);
  });
});

// ---------------------------------------------------------------------------
// repairTestCases
// ---------------------------------------------------------------------------

describe("repairTestCases", () => {
  it("swaps output → expected when expected is absent", () => {
    const tests = [{ input: { x: 1 }, output: { result: 42 } }];
    const repaired = repairTestCases(tests);
    expect(repaired).toEqual([{ input: { x: 1 }, expected: { result: 42 } }]);
  });

  it("leaves test case untouched when expected is already present", () => {
    const tests = [{ input: { x: 1 }, expected: { result: 42 } }];
    const repaired = repairTestCases(tests);
    expect(repaired).toEqual([{ input: { x: 1 }, expected: { result: 42 } }]);
  });

  it("does not override expected when both output and expected are present", () => {
    // If expected already exists, the test is already correct — leave as-is.
    const tests = [
      { input: { x: 1 }, expected: { result: 42 }, output: { result: 99 } },
    ];
    const repaired = repairTestCases(tests);
    expect(repaired).toEqual([
      { input: { x: 1 }, expected: { result: 42 }, output: { result: 99 } },
    ]);
  });

  it("handles a mixed array (some correct, some needing repair)", () => {
    const tests = [
      { input: { x: 1 }, expected: { result: 1 } },
      { input: { x: 2 }, output: { result: 4 } },
      { input: { x: 3 }, expected: { result: 9 } },
    ];
    const repaired = repairTestCases(tests);
    expect(repaired).toEqual([
      { input: { x: 1 }, expected: { result: 1 } },
      { input: { x: 2 }, expected: { result: 4 } },
      { input: { x: 3 }, expected: { result: 9 } },
    ]);
  });

  it("leaves non-object elements untouched", () => {
    const tests = [null, "string", 42, { input: { x: 1 }, output: { y: 2 } }];
    const repaired = repairTestCases(tests);
    expect(repaired).toEqual([
      null,
      "string",
      42,
      { input: { x: 1 }, expected: { y: 2 } },
    ]);
  });

  it("leaves array elements untouched", () => {
    const tests = [[1, 2, 3]];
    const repaired = repairTestCases(tests);
    expect(repaired).toEqual([[1, 2, 3]]);
  });

  it("returns an empty array unchanged", () => {
    expect(repairTestCases([])).toEqual([]);
  });

  it("does not mutate the original test objects", () => {
    const original = { input: { x: 1 }, output: { y: 2 } };
    const tests = [original];
    repairTestCases(tests);
    // Original should still have "output", not "expected"
    expect(original).toHaveProperty("output");
    expect(original).not.toHaveProperty("expected");
  });
});

// ---------------------------------------------------------------------------
// ClaudeSkillResponseSchema
// ---------------------------------------------------------------------------

describe("ClaudeSkillResponseSchema", () => {
  const validResponse = {
    name: "bubble sort",
    description: "Sorts a list using bubble sort algorithm",
    language: "python",
    domain: ["sorting", "arrays"],
    tags: ["beginner"],
    inputs: [{ name: "arr", type: "list[int]" }],
    outputs: [{ name: "sorted_arr", type: "list[int]" }],
    examples: [{ input: { arr: [3, 1, 2] }, output: { sorted_arr: [1, 2, 3] } }],
    tests: [
      { input: { arr: [3, 1, 2] }, expected: { sorted_arr: [1, 2, 3] } },
      { input: { arr: [] }, expected: { sorted_arr: [] } },
      { input: { arr: [1] }, expected: { sorted_arr: [1] } },
    ],
    implementation: "def bubble_sort(arr): return sorted(arr)",
    status: "partial",
  };

  it("accepts a valid complete response", () => {
    const result = ClaudeSkillResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it("defaults tags to [] when omitted", () => {
    const input = { ...validResponse };
    delete (input as Record<string, unknown>).tags;
    const result = ClaudeSkillResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  it("defaults status to 'partial' when omitted", () => {
    const input = { ...validResponse };
    delete (input as Record<string, unknown>).status;
    const result = ClaudeSkillResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("partial");
    }
  });

  it("rejects when name is missing", () => {
    const input = { ...validResponse };
    delete (input as Record<string, unknown>).name;
    const result = ClaudeSkillResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects when inputs array is empty", () => {
    const input = { ...validResponse, inputs: [] };
    const result = ClaudeSkillResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects when domain array is empty", () => {
    const input = { ...validResponse, domain: [] };
    const result = ClaudeSkillResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
