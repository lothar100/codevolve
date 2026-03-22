/**
 * Unit tests for src/prompts.ts — buildMessages interpolation
 */
import { describe, it, expect } from "vitest";
import { PROMPT_DEFINITIONS } from "../src/prompts.js";

const generateSkill = PROMPT_DEFINITIONS.find((p) => p.name === "generate_skill")!;
const improveSkill = PROMPT_DEFINITIONS.find((p) => p.name === "improve_skill")!;

describe("generate_skill prompt", () => {
  it("interpolates all required args into message text", () => {
    const msgs = generateSkill.buildMessages({
      problem_description: "Find two numbers that sum to target",
      language: "python",
      examples: '[{"input":{"nums":[2,7],"target":9},"output":{"indices":[0,1]}}]',
      domain: "arrays",
    });

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    const text = msgs[0].content.text;
    expect(text).toContain("Find two numbers that sum to target");
    expect(text).toContain("python");
    expect(text).toContain("arrays");
    expect(text).toContain("[{\"input\"");
  });

  it("uses 'general' as domain default when domain is omitted", () => {
    const msgs = generateSkill.buildMessages({
      problem_description: "Sort an array",
      language: "javascript",
      examples: "[]",
    });

    expect(msgs[0].content.text).toContain("Domain: general");
  });

  it("includes submit_skill and validate_skill instructions", () => {
    const msgs = generateSkill.buildMessages({
      problem_description: "Test",
      language: "python",
      examples: "[]",
    });

    const text = msgs[0].content.text;
    expect(text).toContain("submit_skill");
    expect(text).toContain("validate_skill");
  });

  it("marks domain argument as optional", () => {
    const domainArg = generateSkill.arguments.find((a) => a.name === "domain");
    expect(domainArg?.required).toBe(false);
  });
});

describe("improve_skill prompt", () => {
  it("interpolates all required args into message text", () => {
    const SKILL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const msgs = improveSkill.buildMessages({
      skill_id: SKILL_ID,
      current_implementation: "def solve(n): return n",
      failure_cases: '[{"input":{"n":0},"expected":{"r":1},"actual":{"r":0}}]',
      confidence: "0.42",
    });

    expect(msgs).toHaveLength(1);
    const text = msgs[0].content.text;
    expect(text).toContain(SKILL_ID);
    expect(text).toContain("def solve(n): return n");
    expect(text).toContain("0.42");
    expect(text).toContain("[{\"input\"");
  });

  it("uses 'unknown' as confidence default when confidence is omitted", () => {
    const msgs = improveSkill.buildMessages({
      skill_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      current_implementation: "def solve(): pass",
      failure_cases: "[]",
    });

    expect(msgs[0].content.text).toContain("Current confidence: unknown");
  });

  it("includes submit_skill and validate_skill instructions", () => {
    const msgs = improveSkill.buildMessages({
      skill_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      current_implementation: "def solve(): pass",
      failure_cases: "[]",
    });

    const text = msgs[0].content.text;
    expect(text).toContain("submit_skill");
    expect(text).toContain("validate_skill");
  });

  it("marks confidence argument as optional", () => {
    const confidenceArg = improveSkill.arguments.find((a) => a.name === "confidence");
    expect(confidenceArg?.required).toBe(false);
  });
});
