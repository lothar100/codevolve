/**
 * MountainScene
 *
 * Root Three.js/R3F canvas component. Sets up:
 * - Camera (perspective, orbit controls)
 * - Lighting (ambient + directional with shadows)
 * - Grid floor
 * - MountainBricks renderer
 */

import { Suspense, useState, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import type { MountainProblem } from "../types/mountain.js";
import { MountainBricks } from "./MountainBricks.js";
import { computeBrickPositions, normalizeExecutionCounts } from "../utils/mountainLayout.js";

interface MountainSceneProps {
  problems: MountainProblem[];
  onSelect: (problem: MountainProblem) => void;
}

function SceneContent({ problems, onSelect }: MountainSceneProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const positions = useMemo(() => computeBrickPositions(problems), [problems]);
  const glowMap = useMemo(() => normalizeExecutionCounts(problems), [problems]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[10, 20, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={100}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <directionalLight position={[-10, 10, -10]} intensity={0.4} />

      {/* Ground grid */}
      <Grid
        args={[60, 60]}
        cellSize={1}
        cellThickness={0.3}
        cellColor="#1e293b"
        sectionSize={5}
        sectionThickness={0.8}
        sectionColor="#334155"
        fadeDistance={50}
        fadeStrength={1}
        infiniteGrid={false}
        position={[0, -0.5, 0]}
      />

      {/* Bricks */}
      <MountainBricks
        problems={problems}
        positions={positions}
        glowMap={glowMap}
        hoveredId={hoveredId}
        onHover={setHoveredId}
        onSelect={onSelect}
      />

      {/* Camera controls */}
      <OrbitControls
        makeDefault
        minDistance={4}
        maxDistance={60}
        maxPolarAngle={Math.PI / 2.1}
        target={[0, 1, 0]}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

export function MountainScene({ problems, onSelect }: MountainSceneProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 14, 28], fov: 50, near: 0.1, far: 200 }}
      style={{ width: "100%", height: "100%" }}
      gl={{ antialias: true }}
    >
      <Suspense fallback={null}>
        <SceneContent problems={problems} onSelect={onSelect} />
      </Suspense>
    </Canvas>
  );
}
