import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useDashboardData } from "../../hooks/useDashboardData";
import type { AgentBehaviorDashboard as DashboardType } from "../../types/dashboards";

export function AgentBehaviorDashboard() {
  const { data, loading, error } =
    useDashboardData<DashboardType>("agent-behavior", 3_600_000);

  if (loading) {
    return <div className="dashboard-loading">Loading Agent Behavior...</div>;
  }

  if (error != null) {
    return (
      <div className="dashboard-error">
        Error loading Agent Behavior: {error}
      </div>
    );
  }

  if (data == null) {
    return <div className="dashboard-empty">No data available.</div>;
  }

  const funnelData = [
    { stage: "Resolves", count: data.total_resolves },
    { stage: "Executes", count: data.total_executes },
  ];

  return (
    <div className="dashboard agent-behavior-dashboard">
      <h2>Agent Behavior</h2>

      {/* 5a single stat */}
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">Resolve&#x2192;Execute Conversion</div>
          <div className="stat-value">
            {data.conversion_rate_pct.toFixed(1)}
            <span className="stat-unit">%</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Resolves</div>
          <div className="stat-value">{data.total_resolves}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Executes</div>
          <div className="stat-value">{data.total_executes}</div>
        </div>
      </div>

      {/* 5a: Funnel chart (horizontal bar chart) */}
      <section>
        <h3>Resolve &rarr; Execute Funnel</h3>
        {data.total_resolves === 0 ? (
          <p className="section-empty">No agent activity recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart layout="vertical" data={funnelData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="stage" width={80} />
              <Tooltip />
              <Bar dataKey="count" name="Count" fill="#3B82F6" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* 5a: Conversion rate over time */}
      <section>
        <h3>Conversion Rate Over Time</h3>
        {data.conversion_over_time.length === 0 ? (
          <p className="section-empty">No agent activity recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.conversion_over_time}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis unit="%" domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="conversion_rate_pct"
                name="Conversion Rate %"
                stroke="#10B981"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* 5b: Repeated resolves */}
      <section>
        <h3>Repeated Resolves (Agent Confusion Signals)</h3>
        {data.repeated_resolves.length === 0 ? (
          <p className="section-empty">No repeated resolves detected yet.</p>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Intent</th>
                <th>Resolve Count</th>
                <th>Distinct Skills</th>
                <th>Avg Confidence</th>
              </tr>
            </thead>
            <tbody>
              {data.repeated_resolves.map((row, i) => (
                <tr key={i}>
                  <td>{row.intent}</td>
                  <td>{row.resolve_count}</td>
                  <td>{row.distinct_skills_returned}</td>
                  <td>{row.avg_confidence.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 5c: Abandoned executions */}
      <section>
        <h3>Abandoned Executions</h3>
        {data.abandoned_executions.length === 0 ? (
          <p className="section-empty">No abandoned executions detected yet.</p>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Intent</th>
                <th>Resolves</th>
                <th>Executes</th>
                <th>Abandoned</th>
              </tr>
            </thead>
            <tbody>
              {data.abandoned_executions.map((row, i) => (
                <tr key={i}>
                  <td>{row.intent}</td>
                  <td>{row.resolve_count}</td>
                  <td>{row.execute_count}</td>
                  <td>{row.abandoned_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 5d: Skill chaining patterns */}
      <section>
        <h3>Skill Chaining Patterns</h3>
        {data.skill_chain_patterns.length === 0 ? (
          <p className="section-empty">No skill chains recorded yet.</p>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>From Skill</th>
                <th>To Skill</th>
                <th>Chain Count</th>
              </tr>
            </thead>
            <tbody>
              {data.skill_chain_patterns.map((row, i) => (
                <tr key={i}>
                  <td>{row.from_skill}</td>
                  <td>{row.to_skill}</td>
                  <td>{row.chain_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
