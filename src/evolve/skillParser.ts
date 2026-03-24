/**
 * Parses and repairs the raw text output from Claude's skill-generation call.
 *
 * Responsibilities:
 *   1. Extract the first JSON object from Claude's response (strips markdown
 *      fences and surrounding prose).
 *   2. Repair common schema deviations — e.g. Claude sometimes uses "output"
 *      instead of "expected" in test cases.
 *   3. Export a Zod schema for the parsed Claude response that can be used
 *      by the handler before constructing a full CreateSkillRequest.
 *
 * This module has no side effects and no I/O — all functions are pure.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schema for the shape Claude is expected to produce
// ---------------------------------------------------------------------------

/**
 * The schema Claude must produce in its response. Intentionally permissive on
 * optional fields (status, tags, examples, tests) so that minor deviations do
 * not hard-fail here — the downstream CreateSkillRequestSchema in
 * src/shared/validation.ts is the definitive gate before DynamoDB writes.
 */
export const ClaudeSkillResponseSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(4096),
  language: z.string().min(1),
  domain: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string()).default([]),
  inputs: z
    .array(z.object({ name: z.string(), type: z.string() }))
    .min(1),
  outputs: z
    .array(z.object({ name: z.string(), type: z.string() }))
    .min(1),
  examples: z
    .array(
      z.object({
        input: z.record(z.unknown()),
        output: z.record(z.unknown()),
      }),
    )
    .default([]),
  tests: z
    .array(
      // Accept both "expected" (correct) and "output" (Claude error) — repairTestCases
      // normalises the field before this schema is invoked, but we keep both keys
      // here as a safety net.
      z
        .object({
          input: z.record(z.unknown()),
          expected: z.record(z.unknown()).optional(),
          output: z.record(z.unknown()).optional(),
        })
        .passthrough(),
    )
    .default([]),
  implementation: z.string().min(1),
  status: z.string().default("partial"),
});

export type ClaudeSkillResponse = z.infer<typeof ClaudeSkillResponseSchema>;

// ---------------------------------------------------------------------------
// parseClaudeSkillResponse
// ---------------------------------------------------------------------------

/**
 * Extract the first valid JSON object from a Claude response string.
 *
 * Handles three response formats:
 *   1. Bare JSON  — `{ ... }`
 *   2. Markdown fence  — ` ```json\n{ ... }\n``` `
 *   3. Prose with embedded JSON — "Here is the skill:\n```json\n{ ... }\n```"
 *
 * @param text  Raw string returned by the Claude API.
 * @returns     Parsed JavaScript value (type `unknown` — caller must Zod-validate).
 * @throws      SyntaxError if no valid JSON object can be found or parsed.
 */
export function parseClaudeSkillResponse(text: string): unknown {
  // --- Strategy 1: extract from ```json ... ``` fence ---
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]);
  }

  // --- Strategy 2: find the first `{` and attempt to parse from there ---
  const braceIndex = text.indexOf("{");
  if (braceIndex !== -1) {
    const candidate = text.slice(braceIndex);
    return JSON.parse(candidate);
  }

  throw new SyntaxError(
    "parseClaudeSkillResponse: no JSON object found in response text",
  );
}

// ---------------------------------------------------------------------------
// repairTestCases
// ---------------------------------------------------------------------------

/**
 * Normalize test-case objects so they always use `expected` rather than
 * `output`.
 *
 * Claude occasionally generates test cases like `{ input: ..., output: ... }`
 * instead of the required `{ input: ..., expected: ... }`. This function
 * swaps the field name so downstream Zod validation passes cleanly.
 *
 * Rules:
 *   - If a test has `expected`, leave it untouched (already correct).
 *   - If a test has `output` but no `expected`, rename `output` → `expected`.
 *   - Any other shape is left untouched (Zod will reject it later).
 *
 * @param tests  Array of raw test-case objects (type `unknown[]`).
 * @returns      New array with `output` → `expected` renamed where necessary.
 */
export function repairTestCases(tests: unknown[]): unknown[] {
  return tests.map((test) => {
    if (
      test === null ||
      typeof test !== "object" ||
      Array.isArray(test)
    ) {
      return test;
    }

    const t = test as Record<string, unknown>;

    // Already has `expected` — leave as-is even if `output` is also present.
    if ("expected" in t) {
      return t;
    }

    // Has `output` but no `expected` — rename.
    if ("output" in t) {
      const { output, ...rest } = t;
      return { ...rest, expected: output };
    }

    return t;
  });
}
