import type { MountainProblem, DominantStatus } from "../types/mountain.js";

const STATUS_ORDER: DominantStatus[] = ["optimized", "verified", "partial", "unsolved"];

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Jaccard similarity between two string arrays (treated as sets).
 * Returns 0 if both arrays are empty.
 */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);

  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  if (unionSize === 0) return 0;

  return intersectionSize / unionSize;
}

/** Build the label set for a problem: combined domain + tags. */
function labelArray(p: MountainProblem): string[] {
  return [...p.domain, ...(p.tags ?? [])];
}

/**
 * Sort problems within a single status bucket using greedy nearest-neighbor
 * traversal. Starts from the most-central node (highest sum of similarities).
 * Tie-breaks by lexicographic problem_id throughout.
 *
 * Falls back to difficulty-then-id order when all label sets are empty.
 */
function sortBucket(bucket: MountainProblem[]): MountainProblem[] {
  if (bucket.length <= 1) return bucket;

  const labels = bucket.map(labelArray);

  // Check whether all label sets are empty — fall back to difficulty sort.
  const allEmpty = labels.every((l) => l.length === 0);
  if (allEmpty) {
    return [...bucket].sort((a, b) => {
      const da = DIFFICULTY_ORDER[a.difficulty] ?? 1;
      const db = DIFFICULTY_ORDER[b.difficulty] ?? 1;
      if (da !== db) return da - db;
      return a.problem_id < b.problem_id ? -1 : 1;
    });
  }

  const n = bucket.length;

  // Build pairwise similarity matrix (upper triangle, symmetric).
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = jaccard(labels[i], labels[j]);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }

  // Find start: argmax of row sums. Tie-break: lex smallest problem_id.
  let startIdx = 0;
  let bestSum = -1;
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      rowSum += sim[i][j];
    }
    if (
      rowSum > bestSum ||
      (rowSum === bestSum && bucket[i].problem_id < bucket[startIdx].problem_id)
    ) {
      bestSum = rowSum;
      startIdx = i;
    }
  }

  // Greedy nearest-neighbor traversal.
  const visited = new Set<number>([startIdx]);
  const result: MountainProblem[] = [bucket[startIdx]];
  let current = startIdx;

  while (visited.size < n) {
    let nextIdx = -1;
    let bestSim = -1;

    for (let j = 0; j < n; j++) {
      if (visited.has(j)) continue;
      const s = sim[current][j];
      if (
        s > bestSim ||
        (s === bestSim && (nextIdx === -1 || bucket[j].problem_id < bucket[nextIdx].problem_id))
      ) {
        bestSim = s;
        nextIdx = j;
      }
    }

    visited.add(nextIdx);
    result.push(bucket[nextIdx]);
    current = nextIdx;
  }

  return result;
}

/**
 * Sort problems using greedy nearest-neighbor traversal within each status group.
 * Status order: optimized → verified → partial → unsolved.
 * Within each group: starts from the most-central node, then picks the most-similar
 * unvisited next. Tie-break: lexicographic problem_id (deterministic).
 * Falls back to difficulty order when all label sets are empty.
 * Similarity input: combined tags + domain arrays.
 */
export function jaccardSort(problems: MountainProblem[]): MountainProblem[] {
  if (problems.length === 0) return [];

  // Split into status buckets maintaining STATUS_ORDER.
  const buckets = new Map<DominantStatus, MountainProblem[]>();
  for (const status of STATUS_ORDER) {
    buckets.set(status, []);
  }

  for (const p of problems) {
    const bucket = buckets.get(p.dominant_status);
    if (bucket) {
      bucket.push(p);
    } else {
      // Unknown status — append to unsolved bucket.
      buckets.get("unsolved")!.push(p);
    }
  }

  const result: MountainProblem[] = [];
  for (const status of STATUS_ORDER) {
    const sorted = sortBucket(buckets.get(status)!);
    result.push(...sorted);
  }

  return result;
}
