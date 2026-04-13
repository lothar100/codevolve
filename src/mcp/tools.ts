import { z } from "zod";
import type { CodevolveClient } from "./client.js";

type TextContent = {
  type: "text";
  text: string;
};

export type ToolResult = {
  content: TextContent[];
  isError?: boolean;
};

export async function callApi(
  fn: () => Promise<unknown>,
): Promise<ToolResult> {
  try {
    const result = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: unknown) {
    const apiErr = err as { statusCode?: number; body?: unknown; message?: string };
    const body = apiErr.body ?? { error: apiErr.message ?? String(err) };
    return {
      content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool 1: resolve_skill (legacy alias for intent routing)
// ---------------------------------------------------------------------------

export const resolveSkillSchema = z.object({
  intent: z.string().min(1),
  tags: z.array(z.string()).optional(),
  language: z.string().optional(),
});

export async function resolveSkill(
  client: CodevolveClient,
  raw: unknown,
): Promise<ToolResult> {
  const input = resolveSkillSchema.parse(raw);
  const body: Record<string, unknown> = { intent: input.intent };
  if (input.tags !== undefined) body["tags"] = input.tags;
  if (input.language !== undefined) body["language"] = input.language;
  // The /intent API adaptively narrows results based on best-match confidence.
  return callApi(() => client.request("POST", "/intent", body));
}

// ---------------------------------------------------------------------------
// Tool 2: get_skill
// ---------------------------------------------------------------------------

export const getSkillSchema = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().min(1).optional(),
});

export async function getSkill(
  client: CodevolveClient,
  raw: unknown,
): Promise<ToolResult> {
  const input = getSkillSchema.parse(raw);
  const qs = input.version !== undefined ? `?version=${input.version}` : "";
  return callApi(() => client.request("GET", `/skills/${input.skill_id}${qs}`));
}

// ---------------------------------------------------------------------------
// Tool 3: list_skills
// ---------------------------------------------------------------------------

export const listSkillsSchema = z.object({
  tag: z.string().optional(),
  language: z.string().optional(),
  domain: z.string().optional(),
  status: z.string().optional(),
  is_canonical: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  next_token: z.string().optional(),
});

export async function listSkills(
  client: CodevolveClient,
  raw: unknown,
): Promise<ToolResult> {
  const input = listSkillsSchema.parse(raw);
  const params = new URLSearchParams();
  if (input.tag !== undefined) params.set("tag", input.tag);
  if (input.language !== undefined) params.set("language", input.language);
  if (input.domain !== undefined) params.set("domain", input.domain);
  if (input.status !== undefined) params.set("status", input.status);
  if (input.is_canonical !== undefined) {
    params.set("is_canonical", String(input.is_canonical));
  }
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.next_token !== undefined) params.set("next_token", input.next_token);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return callApi(() => client.request("GET", `/skills${qs}`));
}

// ---------------------------------------------------------------------------
// Tool 4: feedback_skill
// ---------------------------------------------------------------------------

export const feedbackSkillSchema = z.object({
  skill_id: z.string().uuid(),
  pass_count: z.number().int().min(0),
  fail_count: z.number().int().min(0),
  total_tests: z.number().int().min(1),
});

export async function feedbackSkill(
  client: CodevolveClient,
  raw: unknown,
): Promise<ToolResult> {
  const input = feedbackSkillSchema.parse(raw);
  return callApi(() =>
    client.request("POST", `/validate/${input.skill_id}`, {
      pass_count: input.pass_count,
      fail_count: input.fail_count,
      total_tests: input.total_tests,
    }),
  );
}

// Legacy alias while /validate remains the compatibility endpoint.
export const validateSkillSchema = feedbackSkillSchema;
export const validateSkill = feedbackSkill;

// ---------------------------------------------------------------------------
// Tool 5: chain_skills
// ---------------------------------------------------------------------------

export const chainSkillsSchema = z.object({
  steps: z
    .array(
      z.object({
        intent: z.string().min(1).describe("Natural-language description of this step"),
        language: z.string().optional().describe("Preferred language for this step"),
        tags: z.array(z.string()).optional().describe("Optional tags to narrow the search"),
      }),
    )
    .min(2)
    .max(10)
    .describe("Ordered list of steps. Each step is resolved independently; outputs of one step are piped as inputs to the next by the caller."),
});

export async function chainSkills(
  client: CodevolveClient,
  raw: unknown,
): Promise<ToolResult> {
  const input = chainSkillsSchema.parse(raw);
  return callApi(() => client.request("POST", "/chains", input));
}

// ---------------------------------------------------------------------------
// Tool 6: submit_skill
// ---------------------------------------------------------------------------

const ioFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
});

const exampleSchema = z.object({
  input: z.record(z.unknown()),
  output: z.record(z.unknown()),
});

const testCaseSchema = z.object({
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()),
});

export const submitSkillSchema = z.object({
  problem_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  language: z.string().min(1),
  domain: z.array(z.string()).min(1),
  inputs: z.array(ioFieldSchema).min(1),
  outputs: z.array(ioFieldSchema).min(1),
  examples: z.array(exampleSchema).min(1),
  tests: z.array(testCaseSchema).min(2),
  implementation: z.string().min(1),
  tags: z.array(z.string()).optional(),
  status: z.string().optional(),
});

export async function submitSkill(
  client: CodevolveClient,
  raw: unknown,
): Promise<ToolResult> {
  const input = submitSkillSchema.parse(raw);
  return callApi(() => client.request("POST", "/skills", input));
}
