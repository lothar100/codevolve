import { useState, useEffect, useMemo } from "react";
import { ResolvePerformanceDashboard } from "./components/dashboards/ResolvePerformanceDashboard";
import { ExecutionCachingDashboard } from "./components/dashboards/ExecutionCachingDashboard";
import { SkillQualityDashboard } from "./components/dashboards/SkillQualityDashboard";
import { EvolutionGapDashboard } from "./components/dashboards/EvolutionGapDashboard";
import { AgentBehaviorDashboard } from "./components/dashboards/AgentBehaviorDashboard";
import { Mountain2D } from "./components/Mountain2D";
import { DetailPanel } from "./components/DetailPanel";
import { ProblemDetailModal } from "./components/ProblemDetailModal";
import { DocsPage } from "./components/DocsPage";
import { CategoriesPage } from "./components/CategoriesPage";
import { useMountainData } from "./hooks/useMountainData";
import type { MountainProblem, MountainFilters } from "./types/mountain";
import { API_BASE_URL } from "./types/mountain";

// Stable empty filters used at the App level to fetch registry totals for the header.
// Declared outside the component so the object reference never changes between renders.
const EMPTY_FILTERS: MountainFilters = { domain: null, language: null, status: null };

type TabId = "registry" | "analytics" | "docs" | "categories";
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
  if (hash === "docs") return "docs";
  if (hash === "categories") return "categories";
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

interface MountainViewProps {
  activeDomain: string | null;
  onClearDomain: () => void;
}

function MountainView({ activeDomain, onClearDomain }: MountainViewProps) {
  const filters = useMemo<MountainFilters>(
    () => ({ domain: activeDomain, language: null, status: null }),
    [activeDomain]
  );
  const [selected, setSelected] = useState<MountainProblem | null>(null);
  const [modalProblemId, setModalProblemId] = useState<string | null>(null);
  const { data, loading, error } = useMountainData(filters);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {activeDomain != null && (
        <div style={{
          position: "absolute",
          top: 12,
          left: 16,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{
            fontSize: 12,
            color: "#94a3b8",
            background: "#1a1d27",
            border: "1px solid #3b82f6",
            borderRadius: 16,
            padding: "4px 12px",
            textTransform: "capitalize",
          }}>
            {activeDomain}
          </span>
          <button
            onClick={onClearDomain}
            style={{
              fontSize: 11,
              color: "#64748b",
              background: "transparent",
              border: "1px solid #2e3348",
              borderRadius: 16,
              padding: "4px 10px",
              cursor: "pointer",
              transition: "color 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
          >
            ✕ clear filter
          </button>
        </div>
      )}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
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
  const [activeDomain, setActiveDomain] = useState<string | null>(null);

  // Fetch registry totals once at the App level so the header counter is always visible.
  const { data: registryData } = useMountainData(EMPTY_FILTERS);
  const totalProblems = registryData?.total_problems ?? null;
  const totalSkills = registryData?.total_skills ?? null;

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
          <button
            className={tab === "categories" ? "active" : ""}
            onClick={() => navigateTo("categories")}
          >
            Categories
          </button>
          <button
            className={tab === "docs" ? "active" : ""}
            onClick={() => navigateTo("docs")}
          >
            Docs
          </button>
        </nav>
        {totalProblems !== null && totalSkills !== null && (
          <div className="header-registry-counter">
            <span className="header-registry-counter__item">
              <span className="header-registry-counter__value">{totalProblems}</span>
              {" problems"}
            </span>
            <span className="header-registry-counter__sep">·</span>
            <span className="header-registry-counter__item">
              <span className="header-registry-counter__value">{totalSkills}</span>
              {" skills"}
            </span>
          </div>
        )}
      </header>

      <main>
        {tab === "registry" && (
          <section style={{ height: "100%", overflow: "hidden" }}>
            <MountainView
              activeDomain={activeDomain}
              onClearDomain={() => {
                setActiveDomain(null);
                navigateTo("categories");
              }}
            />
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

        {tab === "categories" && (
          <section style={{ height: "100%", overflowY: "auto" }}>
            <CategoriesPage
              onSelectDomain={(domain) => {
                setActiveDomain(domain);
                navigateTo("registry");
              }}
            />
          </section>
        )}

        {tab === "docs" && (
          <section style={{ height: "100%", overflowY: "auto" }}>
            <DocsPage />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
