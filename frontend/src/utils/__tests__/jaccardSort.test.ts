import { describe, it, expect } from "vitest";
import { jaccard, jaccardSort } from "../jaccardSort.js";
import type { MountainProblem } from "../../types/mountain.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProblem(
  overrides: Partial<MountainProblem> & { problem_id: string }
): MountainProblem {
  return {
    name: `Problem ${overrides.problem_id}`,
    difficulty: "medium",
    domain: [],
    tags: [],
    skill_count: 0,
    dominant_status: "unsolved",
    skill_status_distribution: {
      unsolved: 1,
      partial: 0,
      verified: 0,
      optimized: 0,
      archived: 0,
    },
    execution_count_30d: 0,
    canonical_skill: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// jaccard()
// ---------------------------------------------------------------------------

describe("jaccard", () => {
  it("returns 1/3 for [a,b] and [b,c]", () => {
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
  });

  it("returns 0 for two empty arrays", () => {
    expect(jaccard([], [])).toBe(0);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("returns 1 for identical sets", () => {
    expect(jaccard(["x", "y", "z"], ["x", "y", "z"])).toBe(1);
  });

  it("handles one empty and one non-empty (returns 0)", () => {
    expect(jaccard([], ["a"])).toBe(0);
    expect(jaccard(["a"], [])).toBe(0);
  });

  it("does not return NaN for empty inputs", () => {
    expect(Number.isNaN(jaccard([], []))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// jaccardSort()
// ---------------------------------------------------------------------------

describe("jaccardSort", () => {
  it("returns empty array for empty input", () => {
    expect(jaccardSort([])).toEqual([]);
  });

  it("returns single problem unchanged", () => {
    const p = makeProblem({ problem_id: "p1", dominant_status: "verified" });
    expect(jaccardSort([p])).toEqual([p]);
  });

  it("preserves status grouping: optimized first, unsolved last", () => {
    const problems = [
      makeProblem({ problem_id: "u1", dominant_status: "unsolved" }),
      makeProblem({ problem_id: "o1", dominant_status: "optimized" }),
      makeProblem({ problem_id: "p1", dominant_status: "partial" }),
      makeProblem({ problem_id: "v1", dominant_status: "verified" }),
    ];

    const result = jaccardSort(problems);

    expect(result[0].dominant_status).toBe("optimized");
    expect(result[1].dominant_status).toBe("verified");
    expect(result[2].dominant_status).toBe("partial");
    expect(result[3].dominant_status).toBe("unsolved");
  });

  it("places two problems sharing all tags adjacent", () => {
    const sharedTags = ["graph", "bfs", "shortest-path"];
    const a = makeProblem({
      problem_id: "aaa",
      dominant_status: "verified",
      tags: sharedTags,
      domain: ["graphs"],
    });
    const b = makeProblem({
      problem_id: "bbb",
      dominant_status: "verified",
      tags: sharedTags,
      domain: ["graphs"],
    });
    const c = makeProblem({
      problem_id: "ccc",
      dominant_status: "verified",
      tags: ["string", "regex", "parsing"],
      domain: ["strings"],
    });

    const result = jaccardSort([c, a, b]);

    // a and b share all tags — they must be adjacent in the result
    const idxA = result.findIndex((p) => p.problem_id === "aaa");
    const idxB = result.findIndex((p) => p.problem_id === "bbb");
    expect(Math.abs(idxA - idxB)).toBe(1);
  });

  it("is deterministic — calling twice on the same input gives identical output", () => {
    const problems = [
      makeProblem({ problem_id: "d1", dominant_status: "partial", tags: ["dp", "memoization"] }),
      makeProblem({ problem_id: "d2", dominant_status: "partial", tags: ["dp", "tabulation"] }),
      makeProblem({ problem_id: "d3", dominant_status: "partial", tags: ["greedy", "sorting"] }),
      makeProblem({ problem_id: "d4", dominant_status: "partial", tags: ["dp", "memoization", "greedy"] }),
    ];

    const result1 = jaccardSort([...problems]);
    const result2 = jaccardSort([...problems].reverse());

    expect(result1.map((p) => p.problem_id)).toEqual(result2.map((p) => p.problem_id));
  });

  it("does not crash when all tags are empty — output length equals input length", () => {
    const problems = [
      makeProblem({ problem_id: "e1", dominant_status: "unsolved", tags: [], domain: [] }),
      makeProblem({ problem_id: "e2", dominant_status: "unsolved", tags: [], domain: [] }),
      makeProblem({ problem_id: "e3", dominant_status: "unsolved", tags: [], domain: [] }),
    ];

    const result = jaccardSort(problems);
    expect(result).toHaveLength(3);
  });

  it("does not crash when tags field is absent (undefined)", () => {
    const problems = [
      makeProblem({ problem_id: "f1", dominant_status: "partial" }),
      makeProblem({ problem_id: "f2", dominant_status: "partial" }),
    ];
    // Remove tags field entirely to simulate old API response
    for (const p of problems) {
      delete (p as Partial<MountainProblem>).tags;
    }

    expect(() => jaccardSort(problems)).not.toThrow();
    expect(jaccardSort(problems)).toHaveLength(2);
  });

  it("tie-breaks by lexicographically smaller problem_id", () => {
    // All three problems in the same bucket with identical tags — every pair has
    // similarity 1.0. The start node should be "aaa" (lex smallest), then "bbb",
    // then "ccc" (tie-break chain).
    const sharedTags = ["x", "y", "z"];
    const problems = [
      makeProblem({ problem_id: "ccc", dominant_status: "optimized", tags: sharedTags }),
      makeProblem({ problem_id: "aaa", dominant_status: "optimized", tags: sharedTags }),
      makeProblem({ problem_id: "bbb", dominant_status: "optimized", tags: sharedTags }),
    ];

    const result = jaccardSort(problems);
    expect(result[0].problem_id).toBe("aaa");
    expect(result[1].problem_id).toBe("bbb");
    expect(result[2].problem_id).toBe("ccc");
  });

  it("output contains all input problems (no problem dropped)", () => {
    const problems = Array.from({ length: 10 }, (_, i) =>
      makeProblem({
        problem_id: `p${i}`,
        dominant_status: i % 2 === 0 ? "verified" : "partial",
        tags: [`tag${i}`, `tag${i + 1}`],
      })
    );

    const result = jaccardSort(problems);
    expect(result).toHaveLength(problems.length);
    const ids = new Set(result.map((p) => p.problem_id));
    for (const p of problems) {
      expect(ids.has(p.problem_id)).toBe(true);
    }
  });
});
