import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useDashboardData } from "../../hooks/useDashboardData";
import type { EvolutionGapDashboard as DashboardType } from "../../types/dashboards";

export function EvolutionGapDashboard() {
  const { data, loading, error } =
    useDashboardData<DashboardType>("evolution-gap", 3_600_000);

  if (loading) {
    return <div className="dashboard-loading">Loading Evolution / Gap...</div>;
  }

  if (error != null) {
    return (
      <div className="dashboard-error">
        Error loading Evolution / Gap: {error}
      </div>
    );
  }

  if (data == null) {
    return <div className="dashboard-empty">No data available.</div>;
  }

  return (
    <div className="dashboard evolution-gap-dashboard">
      <h2>Evolution / Gap</h2>

      {/* 4a: Unresolved intents table */}
      <section>
        <h3>Unresolved Intents (No Skill Match)</h3>
        {data.unresolved_intents.length === 0 ? (
          <p className="section-empty">No unresolved intents recorded yet.</p>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Intent</th>
                <th>Occurrences</th>
                <th>First Seen</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {data.unresolved_intents.map((row, i) => (
                <tr key={i}>
                  <td>{row.intent}</td>
                  <td>{row.occurrences}</td>
                  <td>{new Date(row.first_seen).toLocaleString()}</td>
                  <td>{new Date(row.last_seen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 4b: Low-confidence resolve volume over time */}
      <section>
        <h3>Low-Confidence Resolve Volume Over Time</h3>
        {data.low_confidence_volume.length === 0 ? (
          <p className="section-empty">No resolve events recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.low_confidence_volume}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="low_confidence_count"
                name="Low-Confidence"
                stroke="#F59E0B"
                fill="rgba(245,158,11,0.15)"
              />
              <Area
                type="monotone"
                dataKey="total_resolves"
                name="Total Resolves"
                stroke="#3B82F6"
                fill="rgba(59,130,246,0.15)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* 4c: Failed executions table */}
      <section>
        <h3>Failed Executions</h3>
        {data.failed_executions.length === 0 ? (
          <p className="section-empty">No execution failures recorded yet.</p>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Skill ID</th>
                <th>Total Executions</th>
                <th>Failures</th>
                <th>Failure Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.failed_executions.map((row, i) => (
                <tr key={i}>
                  <td>{row.skill_id}</td>
                  <td>{row.total_executions}</td>
                  <td>{row.failures}</td>
                  <td>{row.failure_rate_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 4d: Domain coverage gaps — bar chart */}
      <section>
        <h3>Domain Coverage Gaps</h3>
        {data.domain_coverage_gaps.length === 0 ? (
          <p className="section-empty">No coverage gaps detected yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.domain_coverage_gaps}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="domain" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="unresolved_count"
                name="Unresolved"
                fill="#EF4444"
              />
              <Bar
                dataKey="low_confidence_count"
                name="Low Confidence"
                fill="#F59E0B"
              />
              <Bar
                dataKey="execution_failures"
                name="Exec Failures"
                fill="#8B5CF6"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* 4e: Evolution pipeline status */}
      <section>
        <h3>Evolution Pipeline Status</h3>
        {data.evolve_pipeline.length === 0 ? (
          <p className="section-empty">No skills queued for evolution.</p>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Intent</th>
                <th>Fail Count</th>
                <th>First Failure</th>
                <th>Latest Failure</th>
              </tr>
            </thead>
            <tbody>
              {data.evolve_pipeline.map((row, i) => (
                <tr key={i}>
                  <td>{row.intent}</td>
                  <td>{row.fail_count}</td>
                  <td>{new Date(row.first_failure).toLocaleString()}</td>
                  <td>{new Date(row.latest_failure).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
