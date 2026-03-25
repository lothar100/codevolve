import { useState, useEffect } from "react";
import { ResolvePerformanceDashboard } from "./components/dashboards/ResolvePerformanceDashboard";
import { ExecutionCachingDashboard } from "./components/dashboards/ExecutionCachingDashboard";
import { SkillQualityDashboard } from "./components/dashboards/SkillQualityDashboard";
import { EvolutionGapDashboard } from "./components/dashboards/EvolutionGapDashboard";
import { AgentBehaviorDashboard } from "./components/dashboards/AgentBehaviorDashboard";

type TabId = "mountain" | "analytics";
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
  if (hash === "analytics") return "analytics";
  return "mountain";
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
            className={tab === "mountain" ? "active" : ""}
            onClick={() => navigateTo("mountain")}
          >
            Mountain
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
        {tab === "mountain" && (
          <section className="mountain-view">
            <h2>Mountain Visualization</h2>
            <p>
              Three.js mountain view — implemented in IMPL-14. This placeholder
              renders when the <code>#mountain</code> hash is active.
            </p>
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
