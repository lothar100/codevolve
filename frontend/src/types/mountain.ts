/**
 * Types for the mountain visualization frontend.
 * Derived from DESIGN-04 in docs/platform-design.md.
 */

export type DominantStatus = "unsolved" | "partial" | "verified" | "optimized";
export type Difficulty = "easy" | "medium" | "hard";

export interface SkillStatusDistribution {
  unsolved: number;
  partial: number;
  verified: number;
  optimized: number;
  archived: number;
}

export interface CanonicalSkill {
  skill_id: string;
  language: string;
  confidence: number;
  latency_p50_ms: number | null;
}

export interface MountainProblem {
  problem_id: string;
  name: string;
  difficulty: Difficulty;
  domain: string[];
  skill_count: number;
  dominant_status: DominantStatus;
  skill_status_distribution: SkillStatusDistribution;
  execution_count_30d: number;
  canonical_skill: CanonicalSkill | null;
}

export interface MountainResponse {
  generated_at: string;
  cache_hit: boolean;
  total_problems: number;
  total_skills: number;
  problems: MountainProblem[];
}

export interface MountainFilters {
  domain: string | null;
  language: string | null;
  status: DominantStatus | null;
}

/**
 * Color mapping per DESIGN-04 §5.
 * dominant_status → hex color string
 */
export const STATUS_COLORS: Record<DominantStatus, string> = {
  unsolved: "#6B7280",
  partial: "#F59E0B",
  verified: "#3B82F6",
  optimized: "#10B981",
};

/**
 * Height multiplier per difficulty.
 * easy bricks sit low, hard bricks sit high on the mountain.
 */
export const DIFFICULTY_HEIGHT: Record<Difficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

/**
 * Brick geometry dimensions (world units).
 */
export const BRICK_SIZE = 0.9;
export const BRICK_HEIGHT = 0.45;

/**
 * Mountain API base URL — reads from Vite env, falls back to localhost.
 */
export const API_BASE_URL: string =
  (import.meta.env as Record<string, string | undefined>)["VITE_API_BASE_URL"] ??
  "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1";

/**
 * Auto-refresh cadence: 5 minutes in milliseconds (per DESIGN-04).
 */
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
