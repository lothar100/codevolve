/**
 * DetailPanel
 *
 * Shows problem detail when a brick is clicked.
 * Displays aggregate data from the MountainProblem record.
 * A "View Problem" link points at the /problems/:id API endpoint
 * (detail-on-demand per DESIGN-04 rationale).
 */

import type { MountainProblem } from "../types/mountain.js";
import { STATUS_COLORS } from "../types/mountain.js";

interface DetailPanelProps {
  problem: MountainProblem;
  apiBaseUrl: string;
  onClose: () => void;
  onViewFullProblem: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 300,
    background: "rgba(15, 23, 42, 0.96)",
    border: "1px solid #1e293b",
    borderRadius: 10,
    padding: 20,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: 700,
    color: "#f1f5f9",
    lineHeight: 1.3,
  },
  closeButton: {
    background: "transparent",
    border: "none",
    color: "#64748b",
    cursor: "pointer",
    fontSize: 18,
    lineHeight: 1,
    padding: 2,
    flexShrink: 0,
  },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#94a3b8",
  },
  rowValue: {
    color: "#f1f5f9",
    fontWeight: 500,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#475569",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 4,
  },
  distributionBar: {
    display: "flex",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    gap: 1,
  },
  domains: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 4,
  },
  domainTag: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    color: "#94a3b8",
  },
  viewLink: {
    display: "block",
    textAlign: "center" as const,
    padding: "8px 12px",
    borderRadius: 6,
    background: "#1e40af",
    color: "#bfdbfe",
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    marginTop: 4,
    transition: "background 0.15s",
  },
  canonicalSection: {
    background: "#0f172a",
    borderRadius: 6,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const STATUS_BG: Record<string, string> = {
  unsolved: "#374151",
  partial: "#78350f",
  verified: "#1e3a8a",
  optimized: "#064e3b",
};

const STATUS_TEXT: Record<string, string> = {
  unsolved: "#9ca3af",
  partial: "#fbbf24",
  verified: "#93c5fd",
  optimized: "#6ee7b7",
};

export function DetailPanel({ problem, apiBaseUrl: _apiBaseUrl, onClose, onViewFullProblem }: DetailPanelProps) {
  const dist = problem.skill_status_distribution;
  const total =
    dist.unsolved + dist.partial + dist.verified + dist.optimized;

  const segments: Array<{ status: string; count: number; color: string }> = [
    { status: "optimized", count: dist.optimized, color: STATUS_COLORS.optimized },
    { status: "verified", count: dist.verified, color: STATUS_COLORS.verified },
    { status: "partial", count: dist.partial, color: STATUS_COLORS.partial },
    { status: "unsolved", count: dist.unsolved, color: STATUS_COLORS.unsolved },
  ];

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.name}>{problem.name}</div>
        <button style={styles.closeButton} onClick={onClose} aria-label="Close detail panel">
          ×
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{
            ...styles.badge,
            background: STATUS_BG[problem.dominant_status],
            color: STATUS_TEXT[problem.dominant_status],
          }}
        >
          {problem.dominant_status}
        </span>
        <span
          style={{
            ...styles.badge,
            background: "#1e293b",
            color: "#94a3b8",
          }}
        >
          {DIFFICULTY_LABEL[problem.difficulty]}
        </span>
      </div>

      {/* Domains */}
      {problem.domain.length > 0 && (
        <div style={styles.domains}>
          {problem.domain.map((d) => (
            <span key={d} style={styles.domainTag}>
              {d}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={styles.row}>
          <span>Skills</span>
          <span style={styles.rowValue}>{problem.skill_count}</span>
        </div>
        <div style={styles.row}>
          <span>Executions (30d)</span>
          <span style={styles.rowValue}>{problem.execution_count_30d.toLocaleString()}</span>
        </div>
      </div>

      {/* Skill distribution */}
      {total > 0 && (
        <div>
          <div style={styles.sectionLabel}>Skill distribution</div>
          <div style={styles.distributionBar}>
            {segments
              .filter((s) => s.count > 0)
              .map((s) => (
                <div
                  key={s.status}
                  style={{
                    flex: s.count / total,
                    background: s.color,
                  }}
                  title={`${s.status}: ${s.count}`}
                />
              ))}
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 6,
              flexWrap: "wrap",
              fontSize: 11,
              color: "#64748b",
            }}
          >
            {segments
              .filter((s) => s.count > 0)
              .map((s) => (
                <span key={s.status}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: s.color,
                      marginRight: 4,
                      verticalAlign: "middle",
                    }}
                  />
                  {s.status} ({s.count})
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Canonical skill */}
      {problem.canonical_skill && (
        <div>
          <div style={styles.sectionLabel}>Canonical skill</div>
          <div style={styles.canonicalSection}>
            <div style={styles.row}>
              <span>Language</span>
              <span style={styles.rowValue}>{problem.canonical_skill.language}</span>
            </div>
            <div style={styles.row}>
              <span>Confidence</span>
              <span style={styles.rowValue}>
                {(problem.canonical_skill.confidence * 100).toFixed(0)}%
              </span>
            </div>
            {problem.canonical_skill.latency_p50_ms !== null && (
              <div style={styles.row}>
                <span>Latency p50</span>
                <span style={styles.rowValue}>{problem.canonical_skill.latency_p50_ms}ms</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* View full problem */}
      <button
        onClick={onViewFullProblem}
        style={{ ...styles.viewLink, border: "none", cursor: "pointer" }}
      >
        View full problem
      </button>
    </div>
  );
}
