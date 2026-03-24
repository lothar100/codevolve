/**
 * Pure function gate for POST /skills/:id/promote-canonical.
 *
 * All gates must pass before promotion proceeds. This function has no side
 * effects — it reads only from the skill record passed to it.
 *
 * Gate evaluation order matches the spec in docs/validation-evolve.md §4.
 * The Skill DynamoDB item is passed as a plain record because the handler
 * reads it before mapping to the typed Skill domain object.
 */

export interface GateValid {
  valid: true;
}

export interface GateInvalid {
  valid: false;
  status: number;
  code: string;
  message: string;
}

export type GateResult = GateValid | GateInvalid;

/**
 * Skill record shape expected by the gate — a subset of the DynamoDB item
 * attributes needed to evaluate the promotion preconditions.
 */
export interface SkillGateInput {
  is_canonical?: boolean;
  confidence?: number;
  test_fail_count?: number;
  test_pass_count?: number;
  status?: string;
  archived?: boolean;
}

/**
 * Validate all promotion preconditions.
 *
 * Returns { valid: true } if all gates pass, or a typed error response shape
 * if any gate fails. Gates are evaluated in declaration order; the first
 * failure is returned immediately.
 */
export function validatePromotionGate(skill: SkillGateInput): GateResult {
  // Gate 1: already canonical
  if (skill.is_canonical === true) {
    return {
      valid: false,
      status: 409,
      code: "ALREADY_CANONICAL",
      message: "Skill is already canonical",
    };
  }

  // Gate 2: confidence threshold
  const confidence = skill.confidence ?? 0;
  if (confidence < 0.85) {
    return {
      valid: false,
      status: 422,
      code: "CONFIDENCE_TOO_LOW",
      message: `Skill confidence must be >= 0.85, got ${confidence}`,
    };
  }

  // Gate 3: no failing tests
  const testFailCount = skill.test_fail_count ?? 0;
  if (testFailCount > 0) {
    return {
      valid: false,
      status: 422,
      code: "TESTS_FAILING",
      message: `Skill has ${testFailCount} failing test(s)`,
    };
  }

  // Gate 4: has at least one passing test (never validated)
  const testPassCount = skill.test_pass_count;
  if (testPassCount === undefined || testPassCount === null || testPassCount === 0) {
    return {
      valid: false,
      status: 422,
      code: "NEVER_VALIDATED",
      message: "Skill has never been validated (test_pass_count is 0 or missing)",
    };
  }

  // Gate 5: status must be verified or optimized
  if (skill.status !== "verified" && skill.status !== "optimized") {
    return {
      valid: false,
      status: 422,
      code: "WRONG_STATUS",
      message: `Skill status must be "verified" or "optimized", got "${skill.status}"`,
    };
  }

  // Gate 6: not archived
  if (skill.archived === true) {
    return {
      valid: false,
      status: 409,
      code: "SKILL_ARCHIVED",
      message: "Cannot promote an archived skill",
    };
  }

  return { valid: true };
}
