import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionCachingDashboard } from "../ExecutionCachingDashboard";
import type { ExecutionCachingDashboard as DashboardData } from "../../../types/dashboards";

vi.mock("../../../hooks/useDashboardData", () => ({
  useDashboardData: vi.fn(),
}));

import { useDashboardData } from "../../../hooks/useDashboardData";
const mockUse = useDashboardData as ReturnType<typeof vi.fn>;

const SAMPLE_DATA: DashboardData = {
  top_skills: [{ skill_id: "skill-001", execution_count: 420 }],
  repetition_rates: [
    {
      skill_id: "skill-001",
      total_executions: 420,
      unique_inputs: 42,
      input_repeat_rate: 0.9,
    },
  ],
  cache_hit_rate_pct: 72.5,
  cache_rate_over_time: [
    {
      minute: "2026-01-01T00:00:00Z",
      cache_hits: 100,
      cache_misses: 38,
      hit_rate_pct: 72.5,
    },
  ],
  execution_latency_over_time: [
    { minute: "2026-01-01T00:00:00Z", p50_ms: 55, p95_ms: 210 },
  ],
  cache_candidates: [
    {
      skill_id: "skill-001",
      execution_count: 420,
      unique_inputs: 42,
      input_repeat_rate: 0.9,
      p95_ms: 210,
    },
  ],
};

describe("ExecutionCachingDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<ExecutionCachingDashboard />);
    expect(screen.getByText(/loading execution/i)).toBeInTheDocument();
  });

  it("renders error state", () => {
    mockUse.mockReturnValue({ data: null, loading: false, error: "Timeout", refresh: vi.fn() });
    render(<ExecutionCachingDashboard />);
    expect(screen.getByText(/error loading execution/i)).toBeInTheDocument();
  });

  it("renders dashboard heading when data is present", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<ExecutionCachingDashboard />);
    expect(screen.getByText(/execution.*caching/i)).toBeInTheDocument();
  });

  it("renders cache hit rate stat card", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<ExecutionCachingDashboard />);
    expect(screen.getByText(/cache hit rate/i)).toBeInTheDocument();
  });

  it("renders repetition rate table with skill data", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<ExecutionCachingDashboard />);
    // skill-001 appears in multiple tables
    const cells = screen.getAllByText("skill-001");
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it("calls useDashboardData with correct type and 5-minute interval", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<ExecutionCachingDashboard />);
    expect(mockUse).toHaveBeenCalledWith("execution-caching", 300_000);
  });
});
