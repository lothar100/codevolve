/**
 * ProblemDetailModal
 *
 * Full-screen overlay that fetches and renders a complete problem record
 * from GET /problems/:id, including skills list.
 */

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../types/mountain.js";

interface Skill {
  skill_id: string;
  name: string;
  language: string;
  status: string;
  confidence: number;
  is_canonical: boolean;
  version_label?: string;
  latency_p50_ms: number | null;
}

interface FullProblem {
  problem_id: string;
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  domain: string[];
  tags: string[];
  constraints?: string;
  canonical_skill_id: string | null;
  skill_count: number;
  created_at: string;
}

interface ProblemDetailResponse {
  problem: FullProblem;
  skills: Skill[];
  skill_count: number;
}

interface Props {
  problemId: string;
  problemName: string;
  onClose: () => void;
}

const DIFFICULTY_COLOR = { easy: "#059669", medium: "#d97706", hard: "#7c3aed" };
const STATUS_COLOR: Record<string, string> = {
  optimized: "#10b981",
  verified: "#3b82f6",
  partial: "#f59e0b",
  unsolved: "#6b7280",
  archived: "#374151",
};

export function ProblemDetailModal({ problemId, problemName, onClose }: Props) {
  const [data, setData] = useState<ProblemDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/problems/${problemId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ProblemDetailResponse>;
      })
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load problem")
      )
      .finally(() => setLoading(false));
  }, [problemId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const prob = data?.problem;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f1117",
          border: "1px solid #1e293b",
          borderRadius: 12,
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid #1e293b",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#f1f5f9",
                lineHeight: 1.3,
                marginBottom: 8,
              }}
            >
              {prob?.name ?? problemName}
            </h2>
            {prob && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Badge
                  label={prob.difficulty}
                  color={DIFFICULTY_COLOR[prob.difficulty]}
                />
                {prob.domain.map((d) => (
                  <Badge key={d} label={d} color="#1e293b" textColor="#94a3b8" />
                ))}
                {prob.tags.map((t) => (
                  <Badge key={t} label={`#${t}`} color="#0f172a" textColor="#475569" />
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              padding: "2px 4px",
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {loading && (
            <p style={{ color: "#64748b", textAlign: "center", padding: 40 }}>
              Loading…
            </p>
          )}
          {error && (
            <p style={{ color: "#ef4444", textAlign: "center", padding: 40 }}>
              {error}
            </p>
          )}

          {prob && (
            <>
              {/* Description */}
              <Section label="Description">
                <p style={{ color: "#cbd5e1", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {prob.description}
                </p>
              </Section>

              {/* Constraints */}
              {prob.constraints && (
                <Section label="Constraints">
                  <p style={{ color: "#cbd5e1", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {prob.constraints}
                  </p>
                </Section>
              )}

              {/* Stats row */}
              <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                <StatCard label="Skills" value={String(data!.skill_count)} />
                <StatCard
                  label="Created"
                  value={new Date(prob.created_at).toLocaleDateString()}
                />
                {prob.canonical_skill_id && (
                  <StatCard label="Canonical skill" value="Yes" />
                )}
              </div>

              {/* Skills */}
              {data!.skills.length > 0 && (
                <Section label={`Skills (${data!.skills.length})`}>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {data!.skills.map((skill) => (
                      <SkillRow
                        key={skill.skill_id}
                        skill={skill}
                        isCanonical={skill.is_canonical}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {data!.skills.length === 0 && (
                <p style={{ color: "#475569", fontStyle: "italic" }}>
                  No skills yet. Be the first to submit one.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#475569",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {label}
      </h3>
      {children}
    </div>
  );
}

function Badge({
  label,
  color,
  textColor,
}: {
  label: string;
  color: string;
  textColor?: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: color,
        color: textColor ?? "#f1f5f9",
        textTransform: "capitalize",
      }}
    >
      {label}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#1a1d27",
        border: "1px solid #1e293b",
        borderRadius: 8,
        padding: "10px 16px",
        flex: 1,
      }}
    >
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>{value}</div>
    </div>
  );
}

function SkillRow({ skill, isCanonical }: { skill: Skill; isCanonical: boolean }) {
  return (
    <div
      style={{
        background: "#1a1d27",
        border: `1px solid ${isCanonical ? "#1e40af" : "#1e293b"}`,
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, color: "#f1f5f9", fontSize: 13 }}>
            {skill.name}
          </span>
          {isCanonical && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: "#1e3a8a",
                color: "#93c5fd",
                padding: "1px 6px",
                borderRadius: 3,
                letterSpacing: "0.05em",
              }}
            >
              CANONICAL
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {skill.language}
          {skill.version_label ? ` · v${skill.version_label}` : ""}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {/* Status badge */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: STATUS_COLOR[skill.status] ?? "#6b7280",
            textTransform: "capitalize",
          }}
        >
          {skill.status}
        </span>

        {/* Confidence bar */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
            {(skill.confidence * 100).toFixed(0)}%
          </div>
          <div
            style={{
              width: 60,
              height: 4,
              background: "#1e293b",
              borderRadius: 2,
              marginTop: 2,
            }}
          >
            <div
              style={{
                width: `${skill.confidence * 100}%`,
                height: "100%",
                background: STATUS_COLOR[skill.status] ?? "#6b7280",
                borderRadius: 2,
              }}
            />
          </div>
        </div>

        {/* Latency */}
        {skill.latency_p50_ms !== null && (
          <div style={{ fontSize: 11, color: "#64748b", textAlign: "right" }}>
            <div style={{ color: "#94a3b8" }}>{skill.latency_p50_ms}ms</div>
            <div>p50</div>
          </div>
        )}
      </div>
    </div>
  );
}
