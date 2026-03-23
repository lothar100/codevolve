/**
 * Computes 3D world positions for mountain bricks.
 *
 * Layout strategy:
 * - Problems are grouped by domain. Each domain forms a cluster.
 * - Within each cluster, problems are arranged in a grid.
 * - The Y position of each brick is determined by its difficulty:
 *   easy=1, medium=2, hard=3 (multiplied by BRICK_HEIGHT gap).
 * - Clusters are placed in a ring around the origin.
 */

import type { MountainProblem } from "../types/mountain.js";
import { BRICK_SIZE, BRICK_HEIGHT, DIFFICULTY_HEIGHT } from "../types/mountain.js";

export interface BrickPosition {
  problem_id: string;
  x: number;
  y: number;
  z: number;
}

const CLUSTER_RADIUS = 8;
const BRICKS_PER_ROW = 4;
const BRICK_SPACING = BRICK_SIZE + 0.1;

/**
 * Groups problems by their primary domain (domain[0]).
 */
function groupByDomain(problems: MountainProblem[]): Map<string, MountainProblem[]> {
  const groups = new Map<string, MountainProblem[]>();
  for (const problem of problems) {
    const domain = problem.domain[0] ?? "uncategorized";
    const existing = groups.get(domain);
    if (existing) {
      existing.push(problem);
    } else {
      groups.set(domain, [problem]);
    }
  }
  return groups;
}

/**
 * Computes a 3D position for each problem based on domain cluster placement.
 * Returns a map from problem_id to [x, y, z].
 */
export function computeBrickPositions(problems: MountainProblem[]): BrickPosition[] {
  const groups = groupByDomain(problems);
  const domains = Array.from(groups.keys());
  const positions: BrickPosition[] = [];

  domains.forEach((domain, domainIndex) => {
    const domainProblems = groups.get(domain)!;
    const angleStep = (2 * Math.PI) / Math.max(domains.length, 1);
    const angle = domainIndex * angleStep;

    // Cluster center in XZ plane
    const clusterCenterX = CLUSTER_RADIUS * Math.cos(angle);
    const clusterCenterZ = CLUSTER_RADIUS * Math.sin(angle);

    domainProblems.forEach((problem, i) => {
      const row = Math.floor(i / BRICKS_PER_ROW);
      const col = i % BRICKS_PER_ROW;

      // Offset within cluster grid, centered around cluster center
      const offsetX = (col - (BRICKS_PER_ROW - 1) / 2) * BRICK_SPACING;
      const offsetZ = (row - 1) * BRICK_SPACING;

      const heightLevel = DIFFICULTY_HEIGHT[problem.difficulty];
      const y = (heightLevel - 1) * BRICK_HEIGHT * 2;

      positions.push({
        problem_id: problem.problem_id,
        x: clusterCenterX + offsetX,
        y,
        z: clusterCenterZ + offsetZ,
      });
    });
  });

  return positions;
}

/**
 * Normalizes execution_count_30d values to 0.0–1.0 range.
 * Used to compute emissive glow intensity per DESIGN-04 §5.
 */
export function normalizeExecutionCounts(problems: MountainProblem[]): Map<string, number> {
  const maxCount = Math.max(...problems.map((p) => p.execution_count_30d), 1);
  const result = new Map<string, number>();
  for (const problem of problems) {
    result.set(problem.problem_id, problem.execution_count_30d / maxCount);
  }
  return result;
}
