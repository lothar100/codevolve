/**
 * MountainBricks
 *
 * Renders all problem bricks as a single Three.js InstancedMesh per status color.
 * Using one InstancedMesh per color group (4 groups: unsolved/partial/verified/optimized)
 * keeps draw calls minimal while still allowing per-instance emissive glow via
 * emissiveIntensity set through material color tinting.
 *
 * Interaction:
 * - Hover: slightly scales up the hovered brick.
 * - Click: calls onSelect with the MountainProblem record.
 */

import { useRef, useMemo, useCallback } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { MountainProblem, DominantStatus } from "../types/mountain.js";
import { STATUS_COLORS, BRICK_SIZE, BRICK_HEIGHT } from "../types/mountain.js";
import type { BrickPosition } from "../utils/mountainLayout.js";

interface MountainBricksProps {
  problems: MountainProblem[];
  positions: BrickPosition[];
  glowMap: Map<string, number>;
  hoveredId: string | null;
  onHover: (problemId: string | null) => void;
  onSelect: (problem: MountainProblem) => void;
}

// Map from instanceId to problem for raycasting
interface InstanceEntry {
  instanceIndex: number;
  problem: MountainProblem;
}

const STATUSES: DominantStatus[] = ["unsolved", "partial", "verified", "optimized"];
const BRICK_GEOMETRY = new THREE.BoxGeometry(BRICK_SIZE, BRICK_HEIGHT, BRICK_SIZE);

export function MountainBricks({
  problems,
  positions,
  glowMap,
  hoveredId,
  onHover,
  onSelect,
}: MountainBricksProps) {
  // Build a position map for O(1) lookup
  const positionMap = useMemo(() => {
    const map = new Map<string, BrickPosition>();
    for (const pos of positions) {
      map.set(pos.problem_id, pos);
    }
    return map;
  }, [positions]);

  // Group problems by dominant_status
  const groups = useMemo(() => {
    const g = new Map<DominantStatus, MountainProblem[]>();
    for (const status of STATUSES) {
      g.set(status, []);
    }
    for (const problem of problems) {
      g.get(problem.dominant_status)?.push(problem);
    }
    return g;
  }, [problems]);

  // Build lookup from (status, instanceIndex) → problem for raycasting
  const instanceLookup = useRef<Map<string, InstanceEntry[]>>(new Map());

  const meshRefs = useRef<Map<DominantStatus, THREE.InstancedMesh>>(new Map());

  const registerRef = useCallback(
    (status: DominantStatus) => (mesh: THREE.InstancedMesh | null) => {
      if (mesh) {
        meshRefs.current.set(status, mesh);
      }
    },
    []
  );

  // Sync instance matrices whenever problems/positions change
  useMemo(() => {
    const dummy = new THREE.Object3D();
    instanceLookup.current = new Map();

    for (const status of STATUSES) {
      const groupProblems = groups.get(status) ?? [];
      const mesh = meshRefs.current.get(status);

      const entries: InstanceEntry[] = [];

      groupProblems.forEach((problem, i) => {
        const pos = positionMap.get(problem.problem_id);
        if (!pos) return;

        dummy.position.set(pos.x, pos.y, pos.z);
        dummy.scale.setScalar(1.0);
        dummy.updateMatrix();

        if (mesh) {
          mesh.setMatrixAt(i, dummy.matrix);

          // Apply emissive glow via instance color (approximate)
          const glow = glowMap.get(problem.problem_id) ?? 0;
          const baseHex = STATUS_COLORS[status];
          const base = new THREE.Color(baseHex);
          // Brighten the color slightly based on glow intensity
          const r = Math.min(1, base.r + glow * 0.3);
          const g = Math.min(1, base.g + glow * 0.3);
          const b = Math.min(1, base.b + glow * 0.3);
          mesh.setColorAt(i, new THREE.Color(r, g, b));
        }

        entries.push({ instanceIndex: i, problem });
      });

      instanceLookup.current.set(status, entries);

      if (mesh) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }, [groups, positionMap, glowMap]);

  // Animate hover: scale hovered brick up slightly each frame
  useFrame(() => {
    const dummy = new THREE.Object3D();
    for (const status of STATUSES) {
      const mesh = meshRefs.current.get(status);
      if (!mesh) continue;

      const entries = instanceLookup.current.get(status) ?? [];
      let updated = false;

      entries.forEach(({ instanceIndex, problem }) => {
        const pos = positionMap.get(problem.problem_id);
        if (!pos) return;

        const isHovered = problem.problem_id === hoveredId;
        dummy.position.set(pos.x, pos.y, pos.z);
        dummy.scale.setScalar(isHovered ? 1.12 : 1.0);
        dummy.updateMatrix();
        mesh.setMatrixAt(instanceIndex, dummy.matrix);
        updated = true;
      });

      if (updated) mesh.instanceMatrix.needsUpdate = true;
    }
  });

  const handlePointerMove = useCallback(
    (status: DominantStatus) => (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const entries = instanceLookup.current.get(status) ?? [];
      const entry = entries[e.instanceId ?? -1];
      onHover(entry?.problem.problem_id ?? null);
    },
    [onHover]
  );

  const handlePointerOut = useCallback(
    () => {
      onHover(null);
    },
    [onHover]
  );

  const handleClick = useCallback(
    (status: DominantStatus) => (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const entries = instanceLookup.current.get(status) ?? [];
      const entry = entries[e.instanceId ?? -1];
      if (entry) {
        onSelect(entry.problem);
      }
    },
    [onSelect]
  );

  return (
    <>
      {STATUSES.map((status) => {
        const groupProblems = groups.get(status) ?? [];
        if (groupProblems.length === 0) return null;

        const color = STATUS_COLORS[status];

        return (
          <instancedMesh
            key={status}
            ref={registerRef(status)}
            args={[BRICK_GEOMETRY, undefined, groupProblems.length]}
            onPointerMove={handlePointerMove(status)}
            onPointerOut={handlePointerOut}
            onClick={handleClick(status)}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0}
              roughness={0.6}
              metalness={0.1}
            />
          </instancedMesh>
        );
      })}
    </>
  );
}
