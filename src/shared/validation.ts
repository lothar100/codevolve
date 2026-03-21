/**
 * Zod schema definitions matching docs/api.md Common Types.
 *
 * These are the single source of truth for request/response validation.
 * The plain TypeScript types in types.ts are inferred or manually kept
 * in sync for use where Zod is not needed at runtime.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SkillStatusSchema = z.enum([
  "unsolved",
  "partial",
  "verified",
  "optimized",
  "archived",
]);

export const EventTypeSchema = z.enum([
  "resolve",
  "execute",
  "validate",
  "fail",
]);

export const DashboardTypeSchema = z.enum([
  "resolve-performance",
  "execution-caching",
  "skill-quality",
  "evolution-gap",
  "agent-behavior",
]);

export const SupportedLanguageSchema = z.enum([
  "python",
  "javascript",
  "typescript",
  "go",
  "rust",
  "java",
  "cpp",
  "c",
]);

// ---------------------------------------------------------------------------
// Reusable sub-schemas
// ---------------------------------------------------------------------------

export const SkillInputSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.string().min(1).max(128),
});

export const SkillOutputSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.string().min(1).max(128),
});

export const SkillExampleSchema = z.object({
  input: z.record(z.unknown()),
  output: z.record(z.unknown()),
});

export const SkillTestSchema = z.object({
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// Core domain schemas
// ---------------------------------------------------------------------------

export const SkillSchema = z.object({
  skill_id: z.string().uuid(),
  problem_id: z.string().uuid(),
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  version: z.number().int().positive(),
  version_label: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  is_canonical: z.boolean(),
  status: SkillStatusSchema,
  language: SupportedLanguageSchema,
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32),
  inputs: z.array(SkillInputSchema).min(1),
  outputs: z.array(SkillOutputSchema).min(1),
  examples: z.array(SkillExampleSchema).max(32),
  tests: z.array(SkillTestSchema).max(128),
  implementation: z.string().max(1_000_000),
  confidence: z.number().min(0).max(1),
  latency_p50_ms: z.number().nonnegative().nullable(),
  latency_p95_ms: z.number().nonnegative().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const ProblemSchema = z.object({
  problem_id: z.string().uuid(),
  name: z.string().min(1).max(256),
  description: z.string().max(8192),
  difficulty: z.enum(["easy", "medium", "hard"]),
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32),
  constraints: z.string().max(4096).optional(),
  canonical_skill_id: z.string().uuid().nullable(),
  skill_count: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const AnalyticsEventSchema = z.object({
  event_type: EventTypeSchema,
  timestamp: z.string().datetime(),
  skill_id: z.string().uuid().nullable(),
  intent: z.string().max(1024).nullable(),
  latency_ms: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).nullable(),
  cache_hit: z.boolean(),
  input_hash: z.string().max(128).nullable(),
  success: z.boolean(),
});

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const CreateSkillRequestSchema = z.object({
  problem_id: z.string().uuid(),
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  version_label: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default("0.1.0")
    .optional(),
  status: SkillStatusSchema.default("unsolved"),
  language: SupportedLanguageSchema,
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),
  inputs: z.array(SkillInputSchema).min(1),
  outputs: z.array(SkillOutputSchema).min(1),
  examples: z.array(SkillExampleSchema).max(32).default([]),
  tests: z.array(SkillTestSchema).max(128).default([]),
  implementation: z.string().max(1_000_000).default(""),
});

export const CreateProblemRequestSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(8192),
  difficulty: z.enum(["easy", "medium", "hard"]),
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),
  constraints: z.string().max(4096).optional(),
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const PaginationParamsSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  next_token: z.string().optional(),
});

export const PaginationMetaSchema = z.object({
  limit: z.number().int().positive(),
  next_token: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validate `input` against a Zod schema. Returns a discriminated union:
 *   - { success: true, data: T } on valid input
 *   - { success: false, error: ApiError-shaped object } on invalid input
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!fieldErrors[path]) {
      fieldErrors[path] = [];
    }
    fieldErrors[path].push(issue.message);
  }

  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: fieldErrors,
    },
  };
}
