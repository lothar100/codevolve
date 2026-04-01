import { useState, useEffect, useMemo } from "react";
import { ResolvePerformanceDashboard } from "./components/dashboards/ResolvePerformanceDashboard";
import { ExecutionCachingDashboard } from "./components/dashboards/ExecutionCachingDashboard";
import { SkillQualityDashboard } from "./components/dashboards/SkillQualityDashboard";
import { EvolutionGapDashboard } from "./components/dashboards/EvolutionGapDashboard";
import { AgentBehaviorDashboard } from "./components/dashboards/AgentBehaviorDashboard";
import { Mountain2D } from "./components/Mountain2D";
import { FilterSidebar } from "./components/FilterSidebar";
import { DetailPanel } from "./components/DetailPanel";
import { ProblemDetailModal } from "./components/ProblemDetailModal";
import { useMountainData } from "./hooks/useMountainData";
import type { MountainProblem, MountainFilters } from "./types/mountain";
import { API_BASE_URL } from "./types/mountain";

type TabId = "registry" | "analytics";
type AnalyticsTabId =
  | "resolve-performance"
  | "execution-caching"
  | "skill-quality"
  | "evolution-gap"
  | "agent-behavior";

const ANALYTICS_TABS: { id: AnalyticsTabId; label: string }[] = [
  { id: "resolve-performance", label: "Resolve Performance" },
  { id: "execution-caching", label: "Execution & Caching" },
  { id: "skill-quality", label: "Skill Quality" },
  { id: "evolution-gap", label: "Evolution / Gap" },
  { id: "agent-behavior", label: "Agent Behavior" },
];

function getTabFromHash(): TabId {
  const hash = window.location.hash.replace("#", "");
  if (hash === "analytics" || hash.startsWith("analytics/")) return "analytics";
  return "registry";
}

function getAnalyticsTabFromHash(): AnalyticsTabId {
  const hash = window.location.hash.replace("#analytics/", "").replace("#analytics", "");
  const valid: AnalyticsTabId[] = [
    "resolve-performance",
    "execution-caching",
    "skill-quality",
    "evolution-gap",
    "agent-behavior",
  ];
  if (valid.includes(hash as AnalyticsTabId)) return hash as AnalyticsTabId;
  return "execution-caching";
}

function MountainView() {
  const [filters, setFilters] = useState<MountainFilters>({
    domain: null,
    language: null,
    status: null,
  });
  const [selected, setSelected] = useState<MountainProblem | null>(null);
  const [modalProblemId, setModalProblemId] = useState<string | null>(null);
  const { data, loading, error } = useMountainData(filters);

  const domains = useMemo(
    () =>
      data
        ? Array.from(new Set(data.problems.flatMap((p) => p.domain))).sort()
        : [],
    [data],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <FilterSidebar
        filters={filters}
        domains={domains}
        onFiltersChange={setFilters}
        totalProblems={data?.total_problems ?? 0}
        totalSkills={data?.total_skills ?? 0}
        generatedAt={data?.generated_at ?? null}
        cacheHit={data?.cache_hit ?? false}
      />

      <div style={{ position: "absolute", inset: 0, left: 220, overflow: "hidden" }}>
        {loading && (
          <div className="dashboard-loading">Loading registry…</div>
        )}
        {error != null && !loading && (
          <div className="dashboard-error">{error}</div>
        )}
        {data != null && (
          <Mountain2D problems={data.problems} onSelect={setSelected} />
        )}
      </div>

      {selected != null && (
        <DetailPanel
          problem={selected}
          apiBaseUrl={API_BASE_URL}
          onClose={() => setSelected(null)}
          onViewFullProblem={() => {
            setModalProblemId(selected.problem_id);
            setSelected(null);
          }}
        />
      )}

      {modalProblemId != null && (
        <ProblemDetailModal
          problemId={modalProblemId}
          problemName={
            data?.problems.find((p) => p.problem_id === modalProblemId)?.name ?? ""
          }
          onClose={() => setModalProblemId(null)}
        />
      )}
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<TabId>(getTabFromHash);
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTabId>(
    getAnalyticsTabFromHash
  );

  useEffect(() => {
    const onHashChange = () => {
      setTab(getTabFromHash());
      setAnalyticsTab(getAnalyticsTabFromHash());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigateTo = (newTab: TabId, sub?: AnalyticsTabId) => {
    if (newTab === "analytics") {
      const subPath = sub ?? analyticsTab;
      window.location.hash = `analytics/${subPath}`;
    } else {
      window.location.hash = newTab;
    }
    setTab(newTab);
    if (sub != null) setAnalyticsTab(sub);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>codeVolve</h1>
        <nav className="main-nav">
          <button
            className={tab === "registry" ? "active" : ""}
            onClick={() => navigateTo("registry")}
          >
            Registry
          </button>
          <button
            className={tab === "analytics" ? "active" : ""}
            onClick={() => navigateTo("analytics")}
          >
            Analytics
          </button>
        </nav>
      </header>

      <main>
        {tab === "registry" && (
          <section style={{ height: "100%", overflow: "hidden" }}>
            <MountainView />
          </section>
        )}

        {tab === "analytics" && (
          <section className="analytics-view">
            <nav className="analytics-tabs">
              {ANALYTICS_TABS.map((t) => (
                <button
                  key={t.id}
                  className={analyticsTab === t.id ? "active" : ""}
                  onClick={() => navigateTo("analytics", t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="analytics-content">
              {analyticsTab === "resolve-performance" && (
                <ResolvePerformanceDashboard />
              )}
              {analyticsTab === "execution-caching" && (
                <ExecutionCachingDashboard />
              )}
              {analyticsTab === "skill-quality" && <SkillQualityDashboard />}
              {analyticsTab === "evolution-gap" && <EvolutionGapDashboard />}
              {analyticsTab === "agent-behavior" && <AgentBehaviorDashboard />}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
