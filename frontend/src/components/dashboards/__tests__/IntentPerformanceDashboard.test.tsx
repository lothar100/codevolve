import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntentPerformanceDashboard } from "../IntentPerformanceDashboard";
import type { ResolvePerformanceDashboard as DashboardData } from "../../../types/dashboards";

// Mock the hook so we control data state without real fetch calls
vi.mock("../../../hooks/useDashboardData", () => ({
  useDashboardData: vi.fn(),
}));

import { useDashboardData } from "../../../hooks/useDashboardData";
const mockUse = useDashboardData as ReturnType<typeof vi.fn>;

const SAMPLE_DATA: DashboardData = {
  latency_over_time: [
    { minute: "2026-01-01T00:00:00Z", p50_ms: 42, p95_ms: 98 },
  ],
  latency_histogram: [{ bucket_ms: 50, request_count: 10 }],
  high_confidence_pct: 88.5,
  high_confidence_over_time: [
    { minute: "2026-01-01T00:00:00Z", high_confidence_pct: 88.5 },
  ],
  success_rate_pct: 97.2,
  low_confidence_resolves: [
    {
      intent: "find shortest path",
      confidence: 0.55,
      skill_id: "skill-001",
      timestamp: "2026-01-01T00:00:00Z",
    },
  ],
};

describe("IntentPerformanceDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<IntentPerformanceDashboard />);
    expect(screen.getByText(/loading intent performance/i)).toBeInTheDocument();
  });

  it("renders error state", () => {
    mockUse.mockReturnValue({ data: null, loading: false, error: "Network error", refresh: vi.fn() });
    render(<IntentPerformanceDashboard />);
    expect(screen.getByText(/intent performance is taking a little nap/i)).toBeInTheDocument();
    expect(screen.getByText(/charts will be back soon/i)).toBeInTheDocument();
    expect(screen.getByText(/routing latency over time/i)).toBeInTheDocument();
  });

  it("renders degraded state from API payload", () => {
    mockUse.mockReturnValue({
      data: { ...SAMPLE_DATA, degraded: true, degraded_reason: "clickhouse_unavailable" },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    render(<IntentPerformanceDashboard />);
    expect(screen.getByText(/intent performance is taking a little nap/i)).toBeInTheDocument();
    expect(screen.getByText("find shortest path")).toBeInTheDocument();
  });

  it("renders empty state when data is null and not loading", () => {
    mockUse.mockReturnValue({ data: null, loading: false, error: null, refresh: vi.fn() });
    render(<IntentPerformanceDashboard />);
    expect(screen.getByText(/no data available/i)).toBeInTheDocument();
  });

  it("renders dashboard heading when data is present", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<IntentPerformanceDashboard />);
    expect(screen.getByText("Intent Performance")).toBeInTheDocument();
  });

  it("renders high-confidence stat card", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<IntentPerformanceDashboard />);
    expect(screen.getByText(/high-confidence resolves/i)).toBeInTheDocument();
  });

  it("renders success rate stat card", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<IntentPerformanceDashboard />);
    expect(screen.getByText(/intent success rate/i)).toBeInTheDocument();
  });

  it("renders low-confidence intents table with data", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<IntentPerformanceDashboard />);
    expect(screen.getByText("find shortest path")).toBeInTheDocument();
    expect(screen.getByText("skill-001")).toBeInTheDocument();
  });

  it("calls useDashboardData with correct type and 5-minute interval", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<IntentPerformanceDashboard />);
    expect(mockUse).toHaveBeenCalledWith("resolve-performance", 300_000);
  });
});
