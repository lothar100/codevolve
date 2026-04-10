/**
 * CategoriesPage
 *
 * Displays all domains as interwoven clickable chips.
 * Clicking a chip navigates to the registry filtered by that domain.
 */

import { useMemo, useState } from "react";
import { useMountainData } from "../hooks/useMountainData.js";
import { STATUS_COLORS } from "../types/mountain.js";
import type { DominantStatus } from "../types/mountain.js";

const NO_FILTERS = { domain: null, language: null, status: null };

interface DomainSummary {
  name: string;
  problemCount: number;
  dominantStatus: DominantStatus;
}

interface CategoriesPageProps {
  onSelectDomain: (domain: string) => void;
}

export function CategoriesPage({ onSelectDomain }: CategoriesPageProps) {
  const { data, loading, error } = useMountainData(NO_FILTERS);
  const [hovered, setHovered] = useState<string | null>(null);

  const domains = useMemo<DomainSummary[]>(() => {
    if (!data) return [];

    const map = new Map<string, { count: number; statusCounts: Record<DominantStatus, number> }>();

    for (const problem of data.problems) {
      for (const domain of problem.domain) {
        let entry = map.get(domain);
        if (!entry) {
          entry = { count: 0, statusCounts: { optimized: 0, verified: 0, partial: 0, unsolved: 0 } };
          map.set(domain, entry);
        }
        entry.count += 1;
        entry.statusCounts[problem.dominant_status] += 1;
      }
    }

    return Array.from(map.entries())
      .map(([name, { count, statusCounts }]) => {
        const dominant = (["optimized", "verified", "partial", "unsolved"] as DominantStatus[])
          .find((s) => statusCounts[s] > 0) ?? "unsolved";
        return { name, problemCount: count, dominantStatus: dominant };
      })
      .sort((a, b) => b.problemCount - a.problemCount);
  }, [data]);

  if (loading) return <div className="dashboard-loading">Loading categories…</div>;
  if (error != null) return <div className="dashboard-error">{error}</div>;

  return (
    <div style={{ padding: "32px 40px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", marginBottom: 6, letterSpacing: "-0.02em" }}>
        Categories
      </div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 28 }}>
        {domains.length} domains · click to filter the registry
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {domains.map((domain) => {
          const color = STATUS_COLORS[domain.dominantStatus];
          const isHovered = hovered === domain.name;
          return (
            <button
              key={domain.name}
              onMouseEnter={() => setHovered(domain.name)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectDomain(domain.name)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 13px",
                borderRadius: 20,
                border: `1px solid ${isHovered ? color : "#2e3348"}`,
                background: isHovered ? `${color}18` : "#1a1d27",
                color: isHovered ? "#f1f5f9" : "#94a3b8",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.12s ease",
                textTransform: "capitalize",
                letterSpacing: "0.01em",
              }}
            >
              <span style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
                opacity: isHovered ? 1 : 0.6,
              }} />
              {domain.name}
              <span style={{ fontSize: 11, color: isHovered ? "#94a3b8" : "#475569", marginLeft: 1 }}>
                {domain.problemCount}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
