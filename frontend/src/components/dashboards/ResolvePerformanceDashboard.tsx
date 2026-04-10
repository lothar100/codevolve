import {
  LineChart,
  Line,
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
import type { ResolvePerformanceDashboard as DashboardType } from "../../types/dashboards";

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value.toFixed(1)}
        {unit != null ? <span className="stat-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

export function ResolvePerformanceDashboard() {
  const { data, loading, error } =
    useDashboardData<DashboardType>("resolve-performance", 300_000);

  if (loading) {
    return <div className="dashboard-loading">Loading Resolve Performance...</div>;
  }

  if (error != null) {
    return (
      <div className="dashboard-error">
        Error loading Resolve Performance: {error}
      </div>
    );
  }

  if (data == null) {
    return <div className="dashboard-empty">No data available.</div>;
  }

  return (
    <div className="dashboard resolve-performance-dashboard">
      <h2>Resolve Performance</h2>

      <div className="stat-row">
        <StatCard
          label="High-Confidence Resolves"
          value={data.high_confidence_pct}
          unit="%"
        />
        <StatCard
          label="Resolve Success Rate"
          value={data.success_rate_pct}
          unit="%"
        />
      </div>

      {/* 1a: Routing latency p50/p95 over time */}
      <section>
        <h3>Routing Latency Over Time (p50 / p95)</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.latency_over_time}>
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

      {/* 1b: Embedding search time histogram */}
      <section>
        <h3>Latency Distribution (Histogram)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.latency_histogram}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket_ms" unit="ms" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="request_count" name="Requests" fill="#6366F1" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* 1c: High-confidence resolve % over time */}
      <section>
        <h3>High-Confidence Resolve % Over Time</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data.high_confidence_over_time}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="minute" />
            <YAxis unit="%" domain={[0, 100]} />
            <Tooltip />
            <Area
              type="monotone"
              dataKey="high_confidence_pct"
              name="High-Confidence %"
              stroke="#10B981"
              fill="rgba(16,185,129,0.15)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* 1e: Low-confidence resolves table */}
      <section>
        <h3>Low-Confidence Resolves (confidence &lt; 0.7)</h3>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Intent</th>
              <th>Confidence</th>
              <th>Skill ID</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {data.low_confidence_resolves.length === 0 ? (
              <tr>
                <td colSpan={4} className="section-empty">No low-confidence resolves recorded yet.</td>
              </tr>
            ) : (
              data.low_confidence_resolves.map((row, i) => (
                <tr key={i}>
                  <td>{row.intent}</td>
                  <td>{row.confidence.toFixed(3)}</td>
                  <td>{row.skill_id}</td>
                  <td>{new Date(row.timestamp).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
