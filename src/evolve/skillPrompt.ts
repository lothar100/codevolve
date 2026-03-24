/**
 * Prompt builder for the /evolve skill-generation pipeline.
 *
 * Produces a deterministic, structured prompt that instructs Claude to return
 * a single JSON object matching the CreateSkillRequest schema. The JSON is
 * always wrapped in a ```json ``` code fence so the skillParser can extract
 * it reliably with a single regex.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Condensed view of an existing skill used as a few-shot schema example
 * inside the prompt. Only fields that illustrate expected schema shape are
 * included — full implementation text is intentionally omitted to keep the
 * prompt compact.
 */
export interface SimilarSkill {
  skill_id: string;
  name: string;
  description: string;
  language: string;
  domain: string[];
  tags: string[];
  inputs: Array<{ name: string; type: string }>;
  outputs: Array<{ name: string; type: string }>;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the full user-turn prompt sent to Claude for skill generation.
 *
 * @param intent        The raw intent string from the SQS GapQueue message.
 * @param similarSkills Up to 3 existing skills used as schema examples.
 *                      Pass an empty array when none are available.
 */
export function buildSkillPrompt(
  intent: string,
  similarSkills: SimilarSkill[],
): string {
  const examplesSection =
    similarSkills.length > 0
      ? buildExamplesSection(similarSkills.slice(0, 3))
      : "";

  return `You are generating a new programming skill for the codeVolve registry.

## Intent

The following intent was submitted but no matching skill exists in the registry:

"${intent}"

## Your task

Generate a complete skill object that solves this intent. The skill must be
returned as a single JSON object wrapped in a \`\`\`json\`\`\` code fence.
Return ONLY the JSON object, no explanation.

## Required JSON schema

The JSON object must contain exactly these fields:

\`\`\`
{
  "name":           string  — short, descriptive name (1-256 chars)
  "description":    string  — clear description of what the skill does (max 4096 chars)
  "language":       string  — one of: python, javascript, typescript, go, rust, java, cpp, c
  "domain":         string[] — 1-16 domain tags (e.g. ["arrays", "sorting"])
  "tags":           string[] — 0-32 freeform discoverability tags
  "inputs":         Array<{ name: string, type: string }> — at least 1 input
  "outputs":        Array<{ name: string, type: string }> — at least 1 output
  "examples":       Array<{ input: object, output: object }> — at least 1 example
  "tests":          Array<{ input: object, expected: object }> — at least 3 test cases
  "implementation": string  — a complete, runnable function that satisfies the skill contract
  "status":         "partial"
}
\`\`\`

## Rules

- \`implementation\` must be a complete, runnable function (not a stub or pseudocode).
- \`tests\` must contain at least 3 test cases. Each test must have an \`input\` object
  and an \`expected\` object whose keys match the output schema.
- \`status\` must always be \`"partial"\` — the validation pipeline will promote it.
- Do not include \`skill_id\`, \`problem_id\`, \`version\`, \`is_canonical\`,
  \`confidence\`, \`latency_p50_ms\`, \`latency_p95_ms\`, \`created_at\`, or
  \`updated_at\` — these are assigned by the system.
${examplesSection}
## Output

Return ONLY the JSON object inside a \`\`\`json\`\`\` code fence. No prose before
or after the fence.`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildExamplesSection(skills: SimilarSkill[]): string {
  const examples = skills
    .map(
      (s, i) => `### Example ${i + 1}: ${s.name}

\`\`\`json
${JSON.stringify(
  {
    name: s.name,
    description: s.description,
    language: s.language,
    domain: s.domain,
    tags: s.tags,
    inputs: s.inputs,
    outputs: s.outputs,
  },
  null,
  2,
)}
\`\`\``,
    )
    .join("\n\n");

  return `
## Similar existing skills (for schema reference only — do not copy implementations)

The following skills already exist in the registry. They are provided so you
can see the expected schema shape. Your new skill must solve the intent above,
not replicate these.

${examples}

`;
}
