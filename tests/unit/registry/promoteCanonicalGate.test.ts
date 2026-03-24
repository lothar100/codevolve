/**
 * Unit tests for validatePromotionGate — all gate conditions.
 *
 * Tests cover every gate from IMPL-13-B spec:
 *   Gate 1: ALREADY_CANONICAL (409)
 *   Gate 2: CONFIDENCE_TOO_LOW (422)
 *   Gate 3: TESTS_FAILING (422)
 *   Gate 4: NEVER_VALIDATED (422)
 *   Gate 5: WRONG_STATUS (422)
 *   Gate 6: SKILL_ARCHIVED (409)
 *   Happy path: valid skill passes all gates
 */

import { validatePromotionGate, type SkillGateInput } from "../../../src/registry/promoteCanonicalGate.js";

// A base skill that passes all gates — tests mutate individual fields.
const validSkill: SkillGateInput = {
  is_canonical: false,
  confidence: 0.9,
  test_fail_count: 0,
  test_pass_count: 5,
  status: "verified",
  archived: false,
};

describe("validatePromotionGate", () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("returns valid: true when all gates pass (verified status)", () => {
    const result = validatePromotionGate(validSkill);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true when status is optimized", () => {
    const result = validatePromotionGate({ ...validSkill, status: "optimized" });
    expect(result.valid).toBe(true);
  });

  it("returns valid: true when confidence is exactly 0.85", () => {
    const result = validatePromotionGate({ ...validSkill, confidence: 0.85 });
    expect(result.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Gate 1: ALREADY_CANONICAL (409)
  // -------------------------------------------------------------------------

  it("returns 409 ALREADY_CANONICAL when skill is already canonical", () => {
    const result = validatePromotionGate({ ...validSkill, is_canonical: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("ALREADY_CANONICAL");
    }
  });

  // -------------------------------------------------------------------------
  // Gate 2: CONFIDENCE_TOO_LOW (422)
  // -------------------------------------------------------------------------

  it("returns 422 CONFIDENCE_TOO_LOW when confidence < 0.85", () => {
    const result = validatePromotionGate({ ...validSkill, confidence: 0.84 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("CONFIDENCE_TOO_LOW");
    }
  });

  it("returns 422 CONFIDENCE_TOO_LOW when confidence is 0", () => {
    const result = validatePromotionGate({ ...validSkill, confidence: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("CONFIDENCE_TOO_LOW");
    }
  });

  it("returns 422 CONFIDENCE_TOO_LOW when confidence is undefined (defaults to 0)", () => {
    const result = validatePromotionGate({ ...validSkill, confidence: undefined });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("CONFIDENCE_TOO_LOW");
    }
  });

  // -------------------------------------------------------------------------
  // Gate 3: TESTS_FAILING (422)
  // -------------------------------------------------------------------------

  it("returns 422 TESTS_FAILING when test_fail_count > 0", () => {
    const result = validatePromotionGate({ ...validSkill, test_fail_count: 1 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("TESTS_FAILING");
    }
  });

  it("returns 422 TESTS_FAILING when test_fail_count is large", () => {
    const result = validatePromotionGate({ ...validSkill, test_fail_count: 10 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("TESTS_FAILING");
    }
  });

  // -------------------------------------------------------------------------
  // Gate 4: NEVER_VALIDATED (422)
  // -------------------------------------------------------------------------

  it("returns 422 NEVER_VALIDATED when test_pass_count is 0", () => {
    const result = validatePromotionGate({ ...validSkill, test_pass_count: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("NEVER_VALIDATED");
    }
  });

  it("returns 422 NEVER_VALIDATED when test_pass_count is undefined", () => {
    const result = validatePromotionGate({ ...validSkill, test_pass_count: undefined });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("NEVER_VALIDATED");
    }
  });

  // -------------------------------------------------------------------------
  // Gate 5: WRONG_STATUS (422)
  // -------------------------------------------------------------------------

  it("returns 422 WRONG_STATUS when status is unsolved", () => {
    const result = validatePromotionGate({ ...validSkill, status: "unsolved" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("WRONG_STATUS");
    }
  });

  it("returns 422 WRONG_STATUS when status is partial", () => {
    const result = validatePromotionGate({ ...validSkill, status: "partial" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("WRONG_STATUS");
    }
  });

  it("returns 422 WRONG_STATUS when status is archived (via status field, not archived flag)", () => {
    // status = "archived" without the archived flag — still hits WRONG_STATUS gate (gate 5)
    // because it runs before gate 6 (archived flag), and "archived" is not "verified"/"optimized"
    const result = validatePromotionGate({ ...validSkill, status: "archived", archived: false });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("WRONG_STATUS");
    }
  });

  // -------------------------------------------------------------------------
  // Gate 6: SKILL_ARCHIVED (409)
  // -------------------------------------------------------------------------

  it("returns 409 SKILL_ARCHIVED when archived flag is true", () => {
    // Must also have valid status to get past gate 5 and reach gate 6
    const result = validatePromotionGate({ ...validSkill, archived: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("SKILL_ARCHIVED");
    }
  });

  // -------------------------------------------------------------------------
  // Gate ordering — earlier gates block later gates
  // -------------------------------------------------------------------------

  it("ALREADY_CANONICAL (gate 1) blocks CONFIDENCE_TOO_LOW (gate 2)", () => {
    const result = validatePromotionGate({
      ...validSkill,
      is_canonical: true,
      confidence: 0.5,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("ALREADY_CANONICAL");
    }
  });

  it("CONFIDENCE_TOO_LOW (gate 2) blocks TESTS_FAILING (gate 3)", () => {
    const result = validatePromotionGate({
      ...validSkill,
      confidence: 0.5,
      test_fail_count: 3,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONFIDENCE_TOO_LOW");
    }
  });
});
