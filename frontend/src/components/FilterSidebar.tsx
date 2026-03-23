/**
 * FilterSidebar
 *
 * Renders domain, language, and status filter controls.
 * Filters are applied as query params on the mountain endpoint —
 * no page reload needed (DESIGN-04 §1).
 */

import type { MountainFilters, DominantStatus } from "../types/mountain.js";
import { STATUS_COLORS } from "../types/mountain.js";

interface FilterSidebarProps {
  filters: MountainFilters;
  domains: string[];
  onFiltersChange: (filters: MountainFilters) => void;
  totalProblems: number;
  totalSkills: number;
  generatedAt: string | null;
  cacheHit: boolean;
}

const STATUSES: DominantStatus[] = ["unsolved", "partial", "verified", "optimized"];
const STATUS_LABELS: Record<DominantStatus, string> = {
  unsolved: "Unsolved",
  partial: "Partial",
  verified: "Verified",
  optimized: "Optimized",
};

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 240,
    height: "100%",
    background: "rgba(15, 23, 42, 0.92)",
    borderRight: "1px solid #1e293b",
    padding: 16,
    overflowY: "auto",
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  heading: {
    fontSize: 18,
    fontWeight: 700,
    color: "#f1f5f9",
    marginBottom: 4,
    letterSpacing: "-0.02em",
  },
  meta: {
    fontSize: 11,
    color: "#64748b",
    lineHeight: 1.6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 8,
  },
  filterButton: {
    display: "block",
    width: "100%",
    textAlign: "left" as const,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid transparent",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 2,
    transition: "background 0.15s, color 0.15s",
  },
  filterButtonActive: {
    background: "#1e293b",
    color: "#f1f5f9",
    borderColor: "#334155",
  },
  clearButton: {
    marginTop: "auto",
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid #334155",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "center" as const,
  },
  statusDot: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    marginRight: 8,
    verticalAlign: "middle",
  },
  statsRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#94a3b8",
  },
  statsValue: {
    color: "#f1f5f9",
    fontWeight: 600,
  },
};

export function FilterSidebar({
  filters,
  domains,
  onFiltersChange,
  totalProblems,
  totalSkills,
  generatedAt,
  cacheHit,
}: FilterSidebarProps) {
  const setDomain = (domain: string | null) => {
    onFiltersChange({ ...filters, domain });
  };

  const setStatus = (status: DominantStatus | null) => {
    onFiltersChange({ ...filters, status });
  };

  const clearAll = () => {
    onFiltersChange({ domain: null, language: null, status: null });
  };

  const formattedTime = generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div style={styles.sidebar}>
      <div>
        <div style={styles.heading}>codeVolve</div>
        <div style={styles.meta}>Mountain View</div>
      </div>

      {/* Stats */}
      <div>
        <div style={styles.sectionLabel}>Registry</div>
        <div style={styles.statsRow}>
          <span>Problems</span>
          <span style={styles.statsValue}>{totalProblems}</span>
        </div>
        <div style={{ ...styles.statsRow, marginTop: 4 }}>
          <span>Skills</span>
          <span style={styles.statsValue}>{totalSkills}</span>
        </div>
        {formattedTime && (
          <div style={{ ...styles.meta, marginTop: 8 }}>
            Updated {formattedTime}
            {cacheHit ? " (cached)" : " (live)"}
          </div>
        )}
      </div>

      {/* Status filter */}
      <div>
        <div style={styles.sectionLabel}>Status</div>
        {STATUSES.map((status) => {
          const isActive = filters.status === status;
          return (
            <button
              key={status}
              style={{
                ...styles.filterButton,
                ...(isActive ? styles.filterButtonActive : {}),
              }}
              onClick={() => setStatus(isActive ? null : status)}
            >
              <span
                style={{
                  ...styles.statusDot,
                  background: STATUS_COLORS[status],
                }}
              />
              {STATUS_LABELS[status]}
            </button>
          );
        })}
      </div>

      {/* Domain filter */}
      {domains.length > 0 && (
        <div>
          <div style={styles.sectionLabel}>Domain</div>
          {domains.map((domain) => {
            const isActive = filters.domain === domain;
            return (
              <button
                key={domain}
                style={{
                  ...styles.filterButton,
                  ...(isActive ? styles.filterButtonActive : {}),
                }}
                onClick={() => setDomain(isActive ? null : domain)}
              >
                {domain}
              </button>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div>
        <div style={styles.sectionLabel}>Legend</div>
        <div style={{ ...styles.meta, lineHeight: 2 }}>
          <div>
            <span style={{ ...styles.statusDot, background: STATUS_COLORS.optimized }} />
            Optimized
          </div>
          <div>
            <span style={{ ...styles.statusDot, background: STATUS_COLORS.verified }} />
            Verified
          </div>
          <div>
            <span style={{ ...styles.statusDot, background: STATUS_COLORS.partial }} />
            Partial
          </div>
          <div>
            <span style={{ ...styles.statusDot, background: STATUS_COLORS.unsolved }} />
            Unsolved
          </div>
          <div style={{ marginTop: 8 }}>Glow = activity (30d)</div>
          <div>Height = difficulty</div>
        </div>
      </div>

      <button style={styles.clearButton} onClick={clearAll}>
        Clear filters
      </button>
    </div>
  );
}
