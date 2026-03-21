/**
 * Core TypeScript types for codeVolve.
 *
 * These mirror the Zod schemas in validation.ts but are plain TS types
 * for use across the codebase without importing Zod at runtime.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SKILL_STATUSES = [
  "unsolved",
  "partial",
  "verified",
  "optimized",
  "archived",
] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export const EVENT_TYPES = [
  "resolve",
  "execute",
  "validate",
  "fail",
  "archive",
  "unarchive",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DASHBOARD_TYPES = [
  "resolve-performance",
  "execution-caching",
  "skill-quality",
  "evolution-gap",
  "agent-behavior",
] as const;
export type DashboardType = (typeof DASHBOARD_TYPES)[number];

export const SUPPORTED_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "go",
  "rust",
  "java",
  "cpp",
  "c",
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Reusable sub-types
// ---------------------------------------------------------------------------

export interface SkillInput {
  name: string;
  type: string;
}

export interface SkillOutput {
  name: string;
  type: string;
}

export interface SkillExample {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface SkillTest {
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core domain models
// ---------------------------------------------------------------------------

export interface Skill {
  skill_id: string;
  problem_id: string;
  name: string;
  description: string;
  version: number; // auto-incrementing integer (DynamoDB sort key: version_number)
  version_label?: string; // semver display string, e.g. "1.0.0"
  is_canonical: boolean;
  status: SkillStatus;
  language: SupportedLanguage;
  domain: string[];
  tags: string[];
  inputs: SkillInput[];
  outputs: SkillOutput[];
  examples: SkillExample[];
  tests: SkillTest[];
  implementation: string;
  confidence: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface Problem {
  problem_id: string;
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  domain: string[];
  tags: string[];
  constraints?: string;
  canonical_skill_id: string | null;
  skill_count: number;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsEvent {
  event_type: EventType;
  timestamp: string;
  skill_id: string | null;
  intent: string | null;
  latency_ms: number;
  confidence: number | null;
  cache_hit: boolean;
  input_hash: string | null;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export interface CreateSkillRequest {
  problem_id: string;
  name: string;
  description: string;
  version_label?: string;
  status?: SkillStatus;
  language: SupportedLanguage;
  domain: string[];
  tags?: string[];
  inputs: SkillInput[];
  outputs: SkillOutput[];
  examples?: SkillExample[];
  tests?: SkillTest[];
  implementation?: string;
}

export interface CreateProblemRequest {
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  domain: string[];
  tags?: string[];
  constraints?: string;
}

// ---------------------------------------------------------------------------
// API error type
// ---------------------------------------------------------------------------

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationParams {
  limit?: number;
  next_token?: string;
}

export interface PaginationMeta {
  limit: number;
  next_token: string | null;
}
