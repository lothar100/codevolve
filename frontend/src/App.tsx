/**
 * App
 *
 * Root component for the codeVolve mountain visualization.
 *
 * Responsibilities:
 * - Manages active filters
 * - Fetches mountain data via useMountainData (5-min auto-refresh)
 * - Renders FilterSidebar, MountainScene, DetailPanel, LoadingOverlay
 */

import { useState, useMemo } from "react";
import type { MountainProblem, MountainFilters } from "./types/mountain.js";
import { API_BASE_URL } from "./types/mountain.js";
import { useMountainData } from "./hooks/useMountainData.js";
import { FilterSidebar } from "./components/FilterSidebar.js";
import { MountainScene } from "./components/MountainScene.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { LoadingOverlay } from "./components/LoadingOverlay.js";

export default function App() {
  const [filters, setFilters] = useState<MountainFilters>({
    domain: null,
    language: null,
    status: null,
  });
  const [selectedProblem, setSelectedProblem] = useState<MountainProblem | null>(null);

  const { data, loading, error, refetch } = useMountainData(filters);

  // Extract unique domains from current response for filter sidebar
  const domains = useMemo(() => {
    if (!data) return [];
    const domainSet = new Set<string>();
    for (const problem of data.problems) {
      for (const d of problem.domain) {
        domainSet.add(d);
      }
    }
    return Array.from(domainSet).sort();
  }, [data]);

  const handleSelect = (problem: MountainProblem) => {
    setSelectedProblem(problem);
  };

  const handleCloseDetail = () => {
    setSelectedProblem(null);
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#0f172a",
      }}
    >
      {/* Filter sidebar */}
      <FilterSidebar
        filters={filters}
        domains={domains}
        onFiltersChange={(f) => {
          setFilters(f);
          // Clear selected problem when filters change to avoid stale detail panel
          setSelectedProblem(null);
        }}
        totalProblems={data?.total_problems ?? 0}
        totalSkills={data?.total_skills ?? 0}
        generatedAt={data?.generated_at ?? null}
        cacheHit={data?.cache_hit ?? false}
      />

      {/* 3D canvas — offset left to account for sidebar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 240,
          right: 0,
          bottom: 0,
        }}
      >
        <MountainScene
          problems={data?.problems ?? []}
          onSelect={handleSelect}
        />
      </div>

      {/* Brick click detail panel */}
      {selectedProblem && (
        <DetailPanel
          problem={selectedProblem}
          apiBaseUrl={API_BASE_URL}
          onClose={handleCloseDetail}
        />
      )}

      {/* Loading / error overlay */}
      <LoadingOverlay loading={loading && !data} error={error} onRetry={refetch} />
    </div>
  );
}
