/**
 * Unit tests for mountainLayout utilities.
 */

import { describe, it, expect } from "vitest";
import { computeBrickPositions, normalizeExecutionCounts } from "../src/utils/mountainLayout.js";
import type { MountainProblem } from "../src/types/mountain.js";

const makeProblem = (overrides: Partial<MountainProblem>): MountainProblem => ({
  problem_id: "prob-001",
  name: "Test Problem",
  difficulty: "easy",
  domain: ["arrays"],
  skill_count: 1,
  dominant_status: "optimized",
  skill_status_distribution: {
    unsolved: 0,
    partial: 0,
    verified: 0,
    optimized: 1,
    archived: 0,
  },
  execution_count_30d: 100,
  canonical_skill: null,
  ...overrides,
});

describe("computeBrickPositions", () => {
  it("returns one position per problem", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "p1", domain: ["arrays"] }),
      makeProblem({ problem_id: "p2", domain: ["graphs"] }),
      makeProblem({ problem_id: "p3", domain: ["arrays"] }),
    ];

    const positions = computeBrickPositions(problems);
    expect(positions).toHaveLength(3);
    const ids = positions.map((p) => p.problem_id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    expect(ids).toContain("p3");
  });

  it("returns no positions for empty input", () => {
    expect(computeBrickPositions([])).toHaveLength(0);
  });

  it("easy problems have lower y than hard problems within the same domain", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "easy", difficulty: "easy", domain: ["dp"] }),
      makeProblem({ problem_id: "hard", difficulty: "hard", domain: ["dp"] }),
    ];

    const positions = computeBrickPositions(problems);
    const easyPos = positions.find((p) => p.problem_id === "easy")!;
    const hardPos = positions.find((p) => p.problem_id === "hard")!;

    expect(hardPos.y).toBeGreaterThan(easyPos.y);
  });

  it("medium problems have y strictly between easy and hard", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "easy", difficulty: "easy", domain: ["sorting"] }),
      makeProblem({ problem_id: "medium", difficulty: "medium", domain: ["sorting"] }),
      makeProblem({ problem_id: "hard", difficulty: "hard", domain: ["sorting"] }),
    ];

    const positions = computeBrickPositions(problems);
    const easyY = positions.find((p) => p.problem_id === "easy")!.y;
    const medY = positions.find((p) => p.problem_id === "medium")!.y;
    const hardY = positions.find((p) => p.problem_id === "hard")!.y;

    expect(medY).toBeGreaterThan(easyY);
    expect(hardY).toBeGreaterThan(medY);
  });

  it("problems in different domains get different cluster positions", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "a", domain: ["arrays"] }),
      makeProblem({ problem_id: "b", domain: ["graphs"] }),
    ];

    const positions = computeBrickPositions(problems);
    const posA = positions.find((p) => p.problem_id === "a")!;
    const posB = positions.find((p) => p.problem_id === "b")!;

    // They should be in different positions in XZ plane
    const dist = Math.sqrt(
      Math.pow(posA.x - posB.x, 2) + Math.pow(posA.z - posB.z, 2)
    );
    expect(dist).toBeGreaterThan(0);
  });

  it("problems without a domain fall into uncategorized", () => {
    const problem = makeProblem({ problem_id: "p1", domain: [] });
    const positions = computeBrickPositions([problem]);
    expect(positions).toHaveLength(1);
    expect(positions[0].problem_id).toBe("p1");
  });
});

describe("normalizeExecutionCounts", () => {
  it("returns 1.0 for the problem with the highest count", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "low", execution_count_30d: 10 }),
      makeProblem({ problem_id: "high", execution_count_30d: 1000 }),
    ];

    const result = normalizeExecutionCounts(problems);
    expect(result.get("high")).toBe(1.0);
    expect(result.get("low")).toBeCloseTo(0.01, 5);
  });

  it("returns 0 for a problem with 0 executions when max > 0", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "zero", execution_count_30d: 0 }),
      makeProblem({ problem_id: "nonzero", execution_count_30d: 50 }),
    ];

    const result = normalizeExecutionCounts(problems);
    expect(result.get("zero")).toBe(0);
  });

  it("returns 1.0 for all problems when all have the same count", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "a", execution_count_30d: 42 }),
      makeProblem({ problem_id: "b", execution_count_30d: 42 }),
    ];

    const result = normalizeExecutionCounts(problems);
    expect(result.get("a")).toBe(1.0);
    expect(result.get("b")).toBe(1.0);
  });

  it("handles empty input gracefully", () => {
    const result = normalizeExecutionCounts([]);
    expect(result.size).toBe(0);
  });

  it("handles all-zero execution counts (avoids division by zero)", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "a", execution_count_30d: 0 }),
      makeProblem({ problem_id: "b", execution_count_30d: 0 }),
    ];

    const result = normalizeExecutionCounts(problems);
    // max = Math.max(0, 0, 1) = 1, so both normalize to 0/1 = 0
    expect(result.get("a")).toBe(0);
    expect(result.get("b")).toBe(0);
  });

  it("returns a value for every problem in input", () => {
    const problems: MountainProblem[] = [
      makeProblem({ problem_id: "x", execution_count_30d: 5 }),
      makeProblem({ problem_id: "y", execution_count_30d: 15 }),
      makeProblem({ problem_id: "z", execution_count_30d: 25 }),
    ];

    const result = normalizeExecutionCounts(problems);
    expect(result.size).toBe(3);
  });
});
