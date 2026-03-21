/**
 * Unit tests for Zod validation schemas.
 *
 * Verifies that the schemas from src/shared/validation.ts correctly
 * accept valid data and reject invalid data with proper error shapes.
 */

import {
  CreateSkillRequestSchema,
  CreateProblemRequestSchema,
  SkillSchema,
  AnalyticsEventSchema,
  PaginationParamsSchema,
  validate,
} from "../../../src/shared/validation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SKILL_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_PROBLEM_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

const validCreateSkillRequest = {
  problem_id: VALID_PROBLEM_ID,
  name: "Two Sum",
  description: "Find two numbers that add up to a target",
  language: "python",
  domain: ["arrays"],
  inputs: [{ name: "nums", type: "number[]" }, { name: "target", type: "number" }],
  outputs: [{ name: "indices", type: "number[]" }],
};

const validFullSkill = {
  skill_id: VALID_SKILL_ID,
  problem_id: VALID_PROBLEM_ID,
  name: "Two Sum — Hash Map",
  description: "O(n) hash map solution for Two Sum",
  version: 1,
  version_label: "0.1.0",
  is_canonical: false,
  status: "unsolved" as const,
  language: "python" as const,
  domain: ["arrays"],
  tags: ["hash-map", "easy"],
  inputs: [{ name: "nums", type: "number[]" }, { name: "target", type: "number" }],
  outputs: [{ name: "indices", type: "number[]" }],
  examples: [{ input: { nums: [2, 7, 11, 15], target: 9 }, output: { indices: [0, 1] } }],
  tests: [{ input: { nums: [2, 7, 11, 15], target: 9 }, expected: { indices: [0, 1] } }],
  implementation: "def two_sum(nums, target):\n  lookup = {}\n  for i, n in enumerate(nums):\n    if target - n in lookup:\n      return [lookup[target - n], i]\n    lookup[n] = i",
  confidence: 0,
  latency_p50_ms: null,
  latency_p95_ms: null,
  created_at: "2026-03-21T00:00:00.000Z",
  updated_at: "2026-03-21T00:00:00.000Z",
};

const validCreateProblemRequest = {
  name: "Two Sum",
  description: "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
  difficulty: "easy" as const,
  domain: ["arrays"],
};

const validAnalyticsEvent = {
  event_type: "execute" as const,
  timestamp: "2026-03-21T12:00:00.000Z",
  skill_id: VALID_SKILL_ID,
  intent: null,
  latency_ms: 42,
  confidence: 0.95,
  cache_hit: false,
  input_hash: "abc123def456",
  success: true,
};

// ---------------------------------------------------------------------------
// CreateSkillRequest
// ---------------------------------------------------------------------------

describe("CreateSkillRequestSchema", () => {
  it("accepts a valid minimal skill creation request", () => {
    const result = CreateSkillRequestSchema.safeParse(validCreateSkillRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("unsolved"); // default
      expect(result.data.tags).toEqual([]); // default
      expect(result.data.examples).toEqual([]); // default
      expect(result.data.tests).toEqual([]); // default
      expect(result.data.implementation).toBe(""); // default
    }
  });

  it("rejects when required fields are missing", () => {
    const result = CreateSkillRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an invalid problem_id (not UUID)", () => {
    const result = CreateSkillRequestSchema.safeParse({
      ...validCreateSkillRequest,
      problem_id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const result = CreateSkillRequestSchema.safeParse({
      ...validCreateSkillRequest,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported language", () => {
    const result = CreateSkillRequestSchema.safeParse({
      ...validCreateSkillRequest,
      language: "fortran",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty inputs array", () => {
    const result = CreateSkillRequestSchema.safeParse({
      ...validCreateSkillRequest,
      inputs: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty domain array", () => {
    const result = CreateSkillRequestSchema.safeParse({
      ...validCreateSkillRequest,
      domain: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid version_label (non-semver)", () => {
    const result = CreateSkillRequestSchema.safeParse({
      ...validCreateSkillRequest,
      version_label: "v1.0",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid semver version_label", () => {
    const result = CreateSkillRequestSchema.safeParse({
      ...validCreateSkillRequest,
      version_label: "2.1.0",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SkillSchema (full domain object)
// ---------------------------------------------------------------------------

describe("SkillSchema", () => {
  it("accepts a valid full skill object", () => {
    const result = SkillSchema.safeParse(validFullSkill);
    expect(result.success).toBe(true);
  });

  it("rejects a skill with invalid status", () => {
    const result = SkillSchema.safeParse({
      ...validFullSkill,
      status: "deleted",
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence > 1", () => {
    const result = SkillSchema.safeParse({
      ...validFullSkill,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence < 0", () => {
    const result = SkillSchema.safeParse({
      ...validFullSkill,
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive version", () => {
    const result = SkillSchema.safeParse({
      ...validFullSkill,
      version: 0,
    });
    expect(result.success).toBe(false);
  });

  it("accepts archived status", () => {
    const result = SkillSchema.safeParse({
      ...validFullSkill,
      status: "archived",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CreateProblemRequest
// ---------------------------------------------------------------------------

describe("CreateProblemRequestSchema", () => {
  it("accepts a valid problem creation request", () => {
    const result = CreateProblemRequestSchema.safeParse(validCreateProblemRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]); // default
    }
  });

  it("rejects an invalid difficulty", () => {
    const result = CreateProblemRequestSchema.safeParse({
      ...validCreateProblemRequest,
      difficulty: "nightmare",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty description", () => {
    const result = CreateProblemRequestSchema.safeParse({
      ...validCreateProblemRequest,
      description: "",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AnalyticsEventSchema
// ---------------------------------------------------------------------------

describe("AnalyticsEventSchema", () => {
  it("accepts a valid analytics event", () => {
    const result = AnalyticsEventSchema.safeParse(validAnalyticsEvent);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid event_type", () => {
    const result = AnalyticsEventSchema.safeParse({
      ...validAnalyticsEvent,
      event_type: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null skill_id", () => {
    const result = AnalyticsEventSchema.safeParse({
      ...validAnalyticsEvent,
      skill_id: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative latency", () => {
    const result = AnalyticsEventSchema.safeParse({
      ...validAnalyticsEvent,
      latency_ms: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PaginationParams
// ---------------------------------------------------------------------------

describe("PaginationParamsSchema", () => {
  it("applies defaults", () => {
    const result = PaginationParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("coerces string limit to number", () => {
    const result = PaginationParamsSchema.safeParse({ limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  it("rejects limit > 100", () => {
    const result = PaginationParamsSchema.safeParse({ limit: 200 });
    expect(result.success).toBe(false);
  });

  it("rejects limit = 0", () => {
    const result = PaginationParamsSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validate() helper
// ---------------------------------------------------------------------------

describe("validate()", () => {
  it("returns success with parsed data on valid input", () => {
    const result = validate(CreateSkillRequestSchema, validCreateSkillRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Two Sum");
    }
  });

  it("returns failure with VALIDATION_ERROR code on invalid input", () => {
    const result = validate(CreateSkillRequestSchema, { name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.message).toBe("Request validation failed");
      expect(result.error.details).toBeDefined();
    }
  });

  it("includes field-level errors in details", () => {
    const result = validate(CreateSkillRequestSchema, {
      ...validCreateSkillRequest,
      problem_id: "bad",
      name: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details["problem_id"]).toBeDefined();
      expect(result.error.details["name"]).toBeDefined();
    }
  });
});
