/**
 * Unit tests for src/evolve/skillPrompt.ts
 *
 * Verifies that buildSkillPrompt produces prompts that:
 *   - contain the intent verbatim
 *   - describe the expected JSON schema
 *   - include similar skills as examples when provided
 *   - omit the examples section when no similar skills are given
 *   - cap the example list at 3 regardless of how many are supplied
 */

import { buildSkillPrompt, type SimilarSkill } from "../../../src/evolve/skillPrompt";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSimilarSkill = (overrides: Partial<SimilarSkill> = {}): SimilarSkill => ({
  skill_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  name: "Two Sum",
  description: "Find two indices that add up to a target.",
  language: "python",
  domain: ["arrays"],
  tags: ["hash-map"],
  inputs: [
    { name: "nums", type: "list[int]" },
    { name: "target", type: "int" },
  ],
  outputs: [{ name: "indices", type: "list[int]" }],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSkillPrompt", () => {
  describe("intent", () => {
    it("includes the intent verbatim in the prompt", () => {
      const intent = "sort a list of integers by frequency descending";
      const prompt = buildSkillPrompt(intent, []);

      expect(prompt).toContain(intent);
    });

    it("wraps the intent in quotes so it is visually distinct", () => {
      const intent = "binary search on a sorted array";
      const prompt = buildSkillPrompt(intent, []);

      expect(prompt).toContain(`"${intent}"`);
    });
  });

  describe("JSON schema description", () => {
    it('contains the word "name" as a required field', () => {
      const prompt = buildSkillPrompt("test intent", []);
      expect(prompt).toContain("name");
    });

    it('contains the word "implementation" so Claude knows to generate code', () => {
      const prompt = buildSkillPrompt("test intent", []);
      expect(prompt).toContain("implementation");
    });

    it('contains "tests" with a minimum count instruction', () => {
      const prompt = buildSkillPrompt("test intent", []);
      expect(prompt).toContain("tests");
      expect(prompt).toContain("3");
    });

    it('instructs Claude to use status "partial"', () => {
      const prompt = buildSkillPrompt("test intent", []);
      expect(prompt).toContain("partial");
    });

    it('requests output wrapped in a ```json ``` code fence', () => {
      const prompt = buildSkillPrompt("test intent", []);
      expect(prompt).toContain("```json");
    });

    it('contains "Return ONLY the JSON object" instruction', () => {
      const prompt = buildSkillPrompt("test intent", []);
      expect(prompt).toContain("Return ONLY the JSON object");
    });
  });

  describe("similar skills examples", () => {
    it("omits the examples section when no similar skills are provided", () => {
      const prompt = buildSkillPrompt("test intent", []);
      expect(prompt).not.toContain("Similar existing skills");
    });

    it("includes the similar skill name when one skill is provided", () => {
      const skill = makeSimilarSkill({ name: "Binary Search" });
      const prompt = buildSkillPrompt("test intent", [skill]);

      expect(prompt).toContain("Binary Search");
      expect(prompt).toContain("Similar existing skills");
    });

    it("includes all three skills when three are provided", () => {
      const skills = [
        makeSimilarSkill({ name: "Skill Alpha", skill_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
        makeSimilarSkill({ name: "Skill Beta", skill_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901" }),
        makeSimilarSkill({ name: "Skill Gamma", skill_id: "c3d4e5f6-a7b8-9012-cdef-123456789012" }),
      ];
      const prompt = buildSkillPrompt("test intent", skills);

      expect(prompt).toContain("Skill Alpha");
      expect(prompt).toContain("Skill Beta");
      expect(prompt).toContain("Skill Gamma");
    });

    it("caps examples at 3 even when more than 3 similar skills are supplied", () => {
      const skills = [
        makeSimilarSkill({ name: "Skill One", skill_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
        makeSimilarSkill({ name: "Skill Two", skill_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901" }),
        makeSimilarSkill({ name: "Skill Three", skill_id: "c3d4e5f6-a7b8-9012-cdef-123456789012" }),
        makeSimilarSkill({ name: "Skill Four", skill_id: "d4e5f6a7-b8c9-0123-defa-234567890123" }),
        makeSimilarSkill({ name: "Skill Five", skill_id: "e5f6a7b8-c9d0-1234-efab-345678901234" }),
      ];
      const prompt = buildSkillPrompt("test intent", skills);

      // Only the first 3 should appear
      expect(prompt).toContain("Skill One");
      expect(prompt).toContain("Skill Two");
      expect(prompt).toContain("Skill Three");
      expect(prompt).not.toContain("Skill Four");
      expect(prompt).not.toContain("Skill Five");
    });

    it("includes the similar skill description in the examples section", () => {
      const skill = makeSimilarSkill({
        description: "Find two indices that add up to a target.",
      });
      const prompt = buildSkillPrompt("test intent", [skill]);

      expect(prompt).toContain("Find two indices that add up to a target.");
    });
  });

  describe("output format", () => {
    it("returns a non-empty string", () => {
      const prompt = buildSkillPrompt("any intent", []);
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(100);
    });
  });
});
