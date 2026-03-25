import {
  BarChart,
  Bar,
  AreaChart,
  Area,
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
import type { ExecutionCachingDashboard as DashboardType } from "../../types/dashboards";

export function ExecutionCachingDashboard() {
  const { data, loading, error } =
    useDashboardData<DashboardType>("execution-caching", 300_000);

  if (loading) {
    return (
      <div className="dashboard-loading">Loading Execution &amp; Caching...</div>
    );
  }

  if (error != null) {
    return (
      <div className="dashboard-error">
        Error loading Execution &amp; Caching: {error}
      </div>
    );
  }

  if (data == null) {
    return <div className="dashboard-empty">No data available.</div>;
  }

  return (
    <div className="dashboard execution-caching-dashboard">
      <h2>Execution &amp; Caching</h2>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">Cache Hit Rate</div>
          <div className="stat-value">
            {data.cache_hit_rate_pct.toFixed(1)}
            <span className="stat-unit">%</span>
          </div>
        </div>
      </div>

      {/* 2a: Most executed skills — horizontal bar chart */}
      <section>
        <h3>Most Executed Skills (Top 20)</h3>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart
            layout="vertical"
            data={data.top_skills}
            margin={{ left: 120 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis type="category" dataKey="skill_id" width={120} />
            <Tooltip />
            <Bar dataKey="execution_count" name="Executions" fill="#3B82F6" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* 2c: Cache hit/miss rate — stacked area chart */}
      <section>
        <h3>Cache Hit / Miss Rate Over Time</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data.cache_rate_over_time}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="minute" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Area
              type="monotone"
              dataKey="cache_hits"
              name="Cache Hits"
              stackId="a"
              stroke="#10B981"
              fill="#D1FAE5"
            />
            <Area
              type="monotone"
              dataKey="cache_misses"
              name="Cache Misses"
              stackId="a"
              stroke="#EF4444"
              fill="#FEE2E2"
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* 2e: Global execution latency p50/p95 */}
      <section>
        <h3>Execution Latency Over Time (p50 / p95)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.execution_latency_over_time}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="minute" />
            <YAxis unit="ms" />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="p50_ms"
              name="p50 ms"
              stroke="#3B82F6"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="p95_ms"
              name="p95 ms"
              stroke="#EF4444"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* 2b: Input repetition rate per skill */}
      <section>
        <h3>Input Repetition Rate Per Skill</h3>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Skill ID</th>
              <th>Total Executions</th>
              <th>Unique Inputs</th>
              <th>Repeat Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.repetition_rates.map((row, i) => (
              <tr key={i}>
                <td>{row.skill_id}</td>
                <td>{row.total_executions}</td>
                <td>{row.unique_inputs}</td>
                <td>{(row.input_repeat_rate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 2f: Cache candidates */}
      <section>
        <h3>Cache Candidates</h3>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Skill ID</th>
              <th>Executions</th>
              <th>Unique Inputs</th>
              <th>Repeat Rate</th>
              <th>p95 Latency</th>
            </tr>
          </thead>
          <tbody>
            {data.cache_candidates.map((row, i) => (
              <tr key={i}>
                <td>{row.skill_id}</td>
                <td>{row.execution_count}</td>
                <td>{row.unique_inputs}</td>
                <td>{(row.input_repeat_rate * 100).toFixed(1)}%</td>
                <td>{row.p95_ms.toFixed(0)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
