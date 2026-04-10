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
import type { SkillQualityDashboard as DashboardType } from "../../types/dashboards";

export function SkillQualityDashboard() {
  const { data, loading, error } =
    useDashboardData<DashboardType>("skill-quality", 3_600_000);

  if (loading) {
    return <div className="dashboard-loading">Loading Skill Quality...</div>;
  }

  if (error != null) {
    return (
      <div className="dashboard-error">
        Error loading Skill Quality: {error}
      </div>
    );
  }

  if (data == null) {
    return <div className="dashboard-empty">No data available.</div>;
  }

  return (
    <div className="dashboard skill-quality-dashboard">
      <h2>Skill Quality</h2>

      {/* 3a: Test pass rate per skill — bar chart sorted ascending */}
      <section>
        <h3>Test Pass Rate Per Skill</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.test_pass_rates}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="skill_id" />
            <YAxis unit="%" domain={[0, 100]} />
            <Tooltip />
            <Legend />
            <Bar dataKey="pass_rate_pct" name="Pass Rate %" fill="#10B981" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* 3b: Confidence over time — multi-line time series */}
      <section>
        <h3>Confidence Over Time</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.confidence_over_time}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" />
            <YAxis domain={[0, 1]} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="avg_confidence"
              name="Avg Confidence"
              stroke="#3B82F6"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="min_confidence"
              name="Min Confidence"
              stroke="#F59E0B"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* 3c: Real-world failure rate */}
      <section>
        <h3>Real-World Failure Rate Per Skill</h3>
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
            {data.failure_rates.length === 0 ? (
              <tr>
                <td colSpan={4} className="section-empty">No execution failures recorded yet.</td>
              </tr>
            ) : (
              data.failure_rates.map((row, i) => (
                <tr key={i}>
                  <td>{row.skill_id}</td>
                  <td>{row.total_executions}</td>
                  <td>{row.failures}</td>
                  <td>{row.failure_rate_pct.toFixed(1)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* 3d: Competing implementations */}
      <section>
        <h3>Competing Implementations</h3>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Intent</th>
              <th>Competitors</th>
              <th>Best Confidence</th>
              <th>Worst Confidence</th>
            </tr>
          </thead>
          <tbody>
            {data.competing_implementations.length === 0 ? (
              <tr>
                <td colSpan={4} className="section-empty">No competing implementations detected yet.</td>
              </tr>
            ) : (
              data.competing_implementations.map((row, i) => (
                <tr key={i}>
                  <td>{row.intent}</td>
                  <td>{row.num_competitors}</td>
                  <td>{row.best_confidence.toFixed(3)}</td>
                  <td>{row.worst_confidence.toFixed(3)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* 3e: Confidence degradation */}
      <section>
        <h3>Confidence Degradation (Skills Trending Down)</h3>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Skill ID</th>
              <th>Prior Confidence</th>
              <th>Recent Confidence</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {data.confidence_degradation.length === 0 ? (
              <tr>
                <td colSpan={4} className="section-empty">No confidence degradation detected.</td>
              </tr>
            ) : (
              data.confidence_degradation.map((row, i) => (
                <tr key={i}>
                  <td>{row.skill_id}</td>
                  <td>{row.prior_conf.toFixed(3)}</td>
                  <td>{row.recent_conf.toFixed(3)}</td>
                  <td style={{ color: "#EF4444" }}>
                    {row.confidence_delta.toFixed(3)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
