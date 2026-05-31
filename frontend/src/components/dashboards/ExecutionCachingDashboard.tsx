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
import { displaySkillLabel } from "./skillLabels";

export function ExecutionCachingDashboard() {
  const { data, loading, error } =
    useDashboardData<DashboardType>("execution-caching", 300_000);

  if (loading) {
    return (
      <div className="dashboard-loading">Loading Reported Runs &amp; Caching...</div>
    );
  }

  if (error != null) {
    return (
      <div className="dashboard-error">
        Error loading Reported Runs &amp; Caching: {error}
      </div>
    );
  }

  if (data == null) {
    return <div className="dashboard-empty">No data available.</div>;
  }

  const statLabel =
    data.cache_hit_rate_pct != null ? "Cache Hit Rate" : "Intent Repetition Rate";
  const statValue = data.cache_hit_rate_pct ?? data.intent_repetition_rate_pct ?? 0;
  const cacheRateOverTime = data.cache_rate_over_time ?? [];
  const repetitionRateOverTime = data.repetition_rate_over_time ?? [];
  const hasCacheRateSeries = cacheRateOverTime.length > 0;
  const topSkillsChartData = data.top_skills.map((row) => ({
    ...row,
    chart_label: displaySkillLabel(row),
  }));

  return (
    <div className="dashboard execution-caching-dashboard">
      <h2>Reported Runs &amp; Caching</h2>
      <p className="dashboard-note">
        Run metrics on this screen come from optional caller reports to <code>/feedback</code> and may undercount real local usage.
      </p>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">{statLabel}</div>
          <div className="stat-value">
            {statValue.toFixed(1)}
            <span className="stat-unit">%</span>
          </div>
        </div>
      </div>

      <section>
        <h3>Most Reported Skills (Top 20)</h3>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart
            layout="vertical"
            data={topSkillsChartData}
            margin={{ left: 120 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis type="category" dataKey="chart_label" width={220} />
            <Tooltip />
            <Bar dataKey="execution_count" name="Reported Runs" fill="#3B82F6" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section>
        <h3>
          {hasCacheRateSeries
            ? "Cache Hit / Miss Rate Over Time"
            : "Intent Repetition Rate Over Time"}
        </h3>
        {hasCacheRateSeries ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={cacheRateOverTime}>
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
                fill="rgba(16,185,129,0.15)"
              />
              <Area
                type="monotone"
                dataKey="cache_misses"
                name="Cache Misses"
                stackId="a"
                stroke="#EF4444"
                fill="rgba(239,68,68,0.15)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={repetitionRateOverTime}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="minute" />
              <YAxis unit="%" domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="intent_repetition_rate_pct"
                name="Intent Repetition %"
                stroke="#8B5CF6"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <section>
        <h3>Reported Run Latency Over Time (p50 / p95)</h3>
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

      <section>
        <h3>Input Repetition Rate Per Skill</h3>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Total Reported Runs</th>
              <th>Unique Inputs</th>
              <th>Repeat Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.repetition_rates.length === 0 ? (
              <tr>
                <td colSpan={4} className="section-empty">
                  No reported runs recorded yet.
                </td>
              </tr>
            ) : (
              data.repetition_rates.map((row, i) => (
                <tr key={i}>
                  <td>{displaySkillLabel(row)}</td>
                  <td>{row.total_executions}</td>
                  <td>{row.unique_inputs}</td>
                  <td>{(row.input_repeat_rate * 100).toFixed(1)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Cache Candidates</h3>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Reported Runs</th>
              <th>Unique Inputs</th>
              <th>Repeat Rate</th>
              <th>p95 Latency</th>
            </tr>
          </thead>
          <tbody>
            {data.cache_candidates.length === 0 ? (
              <tr>
                <td colSpan={5} className="section-empty">
                  No cache candidates identified yet.
                </td>
              </tr>
            ) : (
              data.cache_candidates.map((row, i) => (
                <tr key={i}>
                  <td>{displaySkillLabel(row)}</td>
                  <td>{row.execution_count}</td>
                  <td>{row.unique_inputs}</td>
                  <td>{(row.input_repeat_rate * 100).toFixed(1)}%</td>
                  <td>{row.p95_ms.toFixed(0)} ms</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
