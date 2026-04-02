/**
 * Mountain2D
 *
 * Problems are stacked into a pyramid. The bottom rows hold optimized
 * (green) problems — the proven base. Rows rise through verified → partial
 * → unsolved, narrowing toward the peak. Within each status tier, easy
 * problems sit lower and hard problems climb higher.
 *
 * The result: a mountain whose colour layers read like geological strata,
 * with the most-solved work forming a wide green foundation and open
 * challenges forming the grey summit.
 */

import { useState, useMemo } from "react";
import type { MountainProblem, DominantStatus } from "../types/mountain.js";
import { STATUS_COLORS } from "../types/mountain.js";

interface Mountain2DProps {
  problems: MountainProblem[];
  onSelect: (problem: MountainProblem) => void;
}

type Difficulty = "easy" | "medium" | "hard";

const STATUS_ORDER: DominantStatus[] = ["optimized", "verified", "partial", "unsolved"];
const DIFFICULTY_ORDER: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

const STATUS_LABEL: Record<DominantStatus, string> = {
  optimized: "Optimized",
  verified: "Verified",
  partial: "Partial",
  unsolved: "Unsolved",
};

// Sort so optimized-easy lands at the bottom and unsolved-hard at the peak.
function sortForPyramid(problems: MountainProblem[]): MountainProblem[] {
  return [...problems].sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.dominant_status);
    const sb = STATUS_ORDER.indexOf(b.dominant_status);
    if (sa !== sb) return sa - sb;
    return (
      DIFFICULTY_ORDER[a.difficulty as Difficulty] -
      DIFFICULTY_ORDER[b.difficulty as Difficulty]
    );
  });
}

const PAGE_SIZE = 500;

// Brick dimensions and row decrement step scale with problem count.
function getBrickConfig(count: number): { w: number; h: number; gap: number; step: number } {
  if (count <= 100) return { w: 44, h: 22, gap: 3, step: 2 };
  if (count <= 200) return { w: 28, h: 14, gap: 2, step: 3 };
  if (count <= 350) return { w: 18, h: 10, gap: 2, step: 4 };
  return { w: 12, h: 8, gap: 1, step: 5 }; // up to 500
}

// Compute row widths (widest first = bottom) to contain `total` bricks.
// Row decrement step scales with count for a proportional mountain shape.
function computeRowWidths(total: number, step: number): number[] {
  for (let base = step; base <= 200; base += step) {
    const rows: number[] = [];
    let sum = 0;
    for (let w = base; w >= 1; w -= step) {
      rows.push(w);
      sum += w;
      if (sum >= total) return rows; // rows[0] = widest (bottom)
    }
  }
  return [total];
}

interface Tooltip {
  problem: MountainProblem;
  x: number;
  y: number;
}

export function Mountain2D({ problems, onSelect }: Mountain2DProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [page, setPage] = useState(0);

  const { rows, brickConfig, totalPages, pageProblems } = useMemo(() => {
    const sorted = sortForPyramid(problems);
    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    const pageProblems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const brickConfig = getBrickConfig(pageProblems.length);
    const widths = computeRowWidths(pageProblems.length, brickConfig.step);

    const rows: MountainProblem[][] = [];
    let idx = 0;
    for (const width of widths) {
      rows.push(pageProblems.slice(idx, idx + width));
      idx += width;
    }
    return { rows, brickConfig, totalPages, pageProblems };
  }, [problems, page]);

  const { w: BRICK_W, h: BRICK_H, gap: GAP } = brickConfig;

  // rows[0] = bottom (widest), rows[last] = top (narrowest)
  // Render top-to-bottom in DOM but visually bottom-anchored via column-reverse
  const maxWidth = rows[0]?.length ?? 0;
  const mountainWidth = maxWidth * (BRICK_W + GAP) - GAP;

  const handleMouseMove = (
    problem: MountainProblem,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    setHovered(problem.problem_id);
    setTooltip({
      problem,
      x: e.clientX + 14,
      y: e.clientY - 8,
    });
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "auto",
        scrollbarGutter: "stable",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: 40,
        paddingTop: 24,
      }}
    >
      {/* Mountain pyramid */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: GAP,
          width: mountainWidth,
        }}
      >
        {/* Render bottom row first in DOM, pile up */}
        {[...rows].reverse().map((row, reversedIdx) => {
          const rowIdx = rows.length - 1 - reversedIdx;
          return (
            <div
              key={rowIdx}
              style={{
                display: "flex",
                gap: GAP,
                justifyContent: "center",
              }}
            >
              {row.map((problem) => {
                const isHovered = hovered === problem.problem_id;
                const color = STATUS_COLORS[problem.dominant_status];

                return (
                  <div
                    key={problem.problem_id}
                    onMouseMove={(e) => handleMouseMove(problem, e)}
                    onMouseLeave={() => {
                      setHovered(null);
                      setTooltip(null);
                    }}
                    onClick={() => onSelect(problem)}
                    style={{
                      width: BRICK_W,
                      height: BRICK_H,
                      background: isHovered
                        ? lighten(color, 0.25)
                        : color,
                      borderRadius: 3,
                      cursor: "pointer",
                      transition: "transform 0.08s ease, background 0.08s ease",
                      transform: isHovered ? "scaleY(1.18)" : "none",
                      transformOrigin: "bottom center",
                      boxShadow: isHovered ? `0 0 10px ${color}99` : "none",
                      flexShrink: 0,
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Ground line */}
      <div
        style={{
          width: mountainWidth + 40,
          height: 2,
          background: "#1e293b",
          marginTop: 8,
          borderRadius: 1,
        }}
      />

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 16,
          display: "flex",
          gap: 14,
          fontSize: 11,
          color: "#64748b",
          alignItems: "center",
        }}
      >
        {STATUS_ORDER.map((status) => (
          <span key={status} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: 2,
                background: STATUS_COLORS[status],
              }}
            />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>

      {/* Stats + pagination */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 16,
          fontSize: 11,
          color: "#334155",
          textAlign: "right",
          lineHeight: 1.7,
        }}
      >
        <div>
          {totalPages > 1
            ? `${pageProblems.length} of ${problems.length} problems (page ${page + 1}/${totalPages})`
            : `${problems.length} problems`}
        </div>
        <div style={{ color: "#1e293b" }}>base → peak: optimized → unsolved</div>
        {totalPages > 1 && (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid #334155",
                background: "transparent",
                color: page === 0 ? "#334155" : "#94a3b8",
                cursor: page === 0 ? "default" : "pointer",
                fontSize: 11,
              }}
            >
              ← prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid #334155",
                background: "transparent",
                color: page === totalPages - 1 ? "#334155" : "#94a3b8",
                cursor: page === totalPages - 1 ? "default" : "pointer",
                fontSize: 11,
              }}
            >
              next →
            </button>
          </div>
        )}
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            background: "rgba(15,23,42,0.97)",
            border: "1px solid #1e293b",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
            color: "#f1f5f9",
            pointerEvents: "none",
            zIndex: 100,
            maxWidth: 240,
            lineHeight: 1.6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {tooltip.problem.name}
          </div>
          <div style={{ color: "#94a3b8" }}>
            {tooltip.problem.difficulty} · {tooltip.problem.dominant_status}
          </div>
          <div style={{ color: "#64748b", fontSize: 11, marginTop: 1 }}>
            {tooltip.problem.domain.join(", ")}
            {tooltip.problem.skill_count > 0
              ? ` · ${tooltip.problem.skill_count} skill${tooltip.problem.skill_count !== 1 ? "s" : ""}`
              : ""}
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 10,
              color: "#3b82f6",
              letterSpacing: "0.04em",
            }}
          >
            Click to view details
          </div>
        </div>
      )}
    </div>
  );
}

// Lighten a hex color by mixing it toward white
function lighten(hex: string, amount: number): string {
  const c = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) + (255 - ((c >> 16) & 0xff)) * amount));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) + (255 - ((c >> 8) & 0xff)) * amount));
  const b = Math.min(255, Math.round((c & 0xff) + (255 - (c & 0xff)) * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
