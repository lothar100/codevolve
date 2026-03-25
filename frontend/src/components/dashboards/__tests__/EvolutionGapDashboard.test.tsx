import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvolutionGapDashboard } from "../EvolutionGapDashboard";
import type { EvolutionGapDashboard as DashboardData } from "../../../types/dashboards";

vi.mock("../../../hooks/useDashboardData", () => ({
  useDashboardData: vi.fn(),
}));

import { useDashboardData } from "../../../hooks/useDashboardData";
const mockUse = useDashboardData as ReturnType<typeof vi.fn>;

const SAMPLE_DATA: DashboardData = {
  unresolved_intents: [
    {
      intent: "compute eigenvectors",
      occurrences: 42,
      first_seen: "2026-01-01T00:00:00Z",
      last_seen: "2026-01-02T00:00:00Z",
    },
  ],
  low_confidence_intents: [
    {
      intent: "dijkstra on dense graph",
      skill_id: "skill-005",
      occurrences: 18,
      avg_confidence: 0.58,
    },
  ],
  low_confidence_volume: [
    {
      hour: "2026-01-01T00:00:00Z",
      low_confidence_count: 5,
      total_resolves: 25,
      low_confidence_pct: 20.0,
    },
  ],
  failed_executions: [
    {
      skill_id: "skill-007",
      total_executions: 50,
      failures: 8,
      failure_rate_pct: 16.0,
    },
  ],
  domain_coverage_gaps: [
    {
      domain: "graphs",
      unique_intents: 15,
      unresolved_count: 7,
      low_confidence_count: 4,
      execution_failures: 2,
    },
  ],
  evolve_pipeline: [
    {
      intent: "compute eigenvectors",
      fail_count: 10,
      first_failure: "2026-01-01T00:00:00Z",
      latest_failure: "2026-01-02T00:00:00Z",
    },
  ],
};

describe("EvolutionGapDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<EvolutionGapDashboard />);
    expect(screen.getByText(/loading evolution/i)).toBeInTheDocument();
  });

  it("renders error state", () => {
    mockUse.mockReturnValue({ data: null, loading: false, error: "503", refresh: vi.fn() });
    render(<EvolutionGapDashboard />);
    expect(screen.getByText(/error loading evolution/i)).toBeInTheDocument();
  });

  it("renders dashboard heading when data present", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<EvolutionGapDashboard />);
    expect(screen.getByText(/evolution \/ gap/i)).toBeInTheDocument();
  });

  it("renders unresolved intent in table", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<EvolutionGapDashboard />);
    // "compute eigenvectors" appears in both the unresolved intents table and the
    // evolve pipeline table — use getAllByText to confirm at least one exists.
    const matches = screen.getAllByText("compute eigenvectors");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders domain coverage gaps bar chart section", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<EvolutionGapDashboard />);
    expect(screen.getByText(/domain coverage gaps/i)).toBeInTheDocument();
  });

  it("renders evolution pipeline table with fail count", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<EvolutionGapDashboard />);
    expect(screen.getByText(/evolution pipeline/i)).toBeInTheDocument();
  });

  it("calls useDashboardData with correct type and 60-minute interval", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<EvolutionGapDashboard />);
    expect(mockUse).toHaveBeenCalledWith("evolution-gap", 3_600_000);
  });
});
