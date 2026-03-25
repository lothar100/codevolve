// ---------------------------------------------------------------------------
// Prompt template definitions for codeVolve MCP server
// ---------------------------------------------------------------------------

export type PromptArgument = {
  name: string;
  description: string;
  required: boolean;
};

export type PromptMessage = {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
};

export type PromptDefinition = {
  name: string;
  description: string;
  arguments: PromptArgument[];
  buildMessages: (args: Record<string, string>) => PromptMessage[];
};

// ---------------------------------------------------------------------------
// Prompt: generate_skill
// ---------------------------------------------------------------------------

const generateSkillPrompt: PromptDefinition = {
  name: "generate_skill",
  description:
    "Generate a new production-quality codeVolve skill from a problem description. The agent will write the implementation, test cases, and submit it to the registry.",
  arguments: [
    {
      name: "problem_description",
      description: "Full description of the problem to solve",
      required: true,
    },
    {
      name: "language",
      description: "Target programming language for the implementation",
      required: true,
    },
    {
      name: "examples",
      description:
        "One or more worked examples showing inputs and expected outputs",
      required: true,
    },
    {
      name: "domain",
      description: "Problem domain (e.g. arrays, graphs, dynamic-programming)",
      required: false,
    },
  ],
  buildMessages(args) {
    const domain = args["domain"] ?? "general";
    const text = `You are implementing a verified, production-quality algorithmic skill for the codeVolve registry.

Problem:
${args["problem_description"]}

Target language: ${args["language"]}
Domain: ${domain}

Examples:
${args["examples"]}

Your task:
1. Write a complete, correct implementation in ${args["language"]}.
2. Write at least 5 test cases covering: basic case, edge cases, large inputs, invalid inputs.
3. Define the inputs array (name + type for each parameter).
4. Define the outputs array (name + type for each return value).
5. Write a clear description of the algorithm and its time/space complexity.

Then call submit_skill with the complete skill contract.
After submitting, call validate_skill with the returned skill_id to confirm all tests pass.`;
    return [{ role: "user", content: { type: "text", text } }];
  },
};

// ---------------------------------------------------------------------------
// Prompt: improve_skill
// ---------------------------------------------------------------------------

const improveSkillPrompt: PromptDefinition = {
  name: "improve_skill",
  description:
    "Improve an existing codeVolve skill that is failing tests or has low confidence. The agent will diagnose failures, rewrite the implementation, and validate the fix.",
  arguments: [
    {
      name: "skill_id",
      description: "UUID of the skill to improve",
      required: true,
    },
    {
      name: "current_implementation",
      description: "The current implementation source code",
      required: true,
    },
    {
      name: "failure_cases",
      description: "Test cases that are currently failing",
      required: true,
    },
    {
      name: "confidence",
      description: "Current confidence score (0–1)",
      required: false,
    },
  ],
  buildMessages(args) {
    const confidence = args["confidence"] ?? "unknown";
    const text = `You are improving an existing codeVolve skill that is failing tests or has low confidence.

Skill ID: ${args["skill_id"]}
Current confidence: ${confidence}

Current implementation:
${args["current_implementation"]}

Failing test cases:
${args["failure_cases"]}

Your task:
1. Analyze why the current implementation fails these test cases.
2. Write a corrected implementation that passes all failing cases without breaking passing ones.
3. Do not change the skill's inputs, outputs, or public interface — only fix the implementation.
4. If the implementation is fundamentally flawed, rewrite it entirely.

Call submit_skill with the updated implementation. Use the same problem_id, name, description, inputs, outputs, examples, and tests — only the implementation field should change.
After submitting, call validate_skill with the returned skill_id to confirm the pass rate has improved.`;
    return [{ role: "user", content: { type: "text", text } }];
  },
};

// ---------------------------------------------------------------------------
// Exported list
// ---------------------------------------------------------------------------

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  generateSkillPrompt,
  improveSkillPrompt,
];
