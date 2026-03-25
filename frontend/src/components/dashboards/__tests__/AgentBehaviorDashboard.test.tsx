import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentBehaviorDashboard } from "../AgentBehaviorDashboard";
import type { AgentBehaviorDashboard as DashboardData } from "../../../types/dashboards";

vi.mock("../../../hooks/useDashboardData", () => ({
  useDashboardData: vi.fn(),
}));

import { useDashboardData } from "../../../hooks/useDashboardData";
const mockUse = useDashboardData as ReturnType<typeof vi.fn>;

const SAMPLE_DATA: DashboardData = {
  total_resolves: 1000,
  total_executes: 750,
  conversion_rate_pct: 75.0,
  conversion_over_time: [
    {
      hour: "2026-01-01T00:00:00Z",
      resolves: 100,
      executes: 75,
      conversion_rate_pct: 75.0,
    },
  ],
  repeated_resolves: [
    {
      intent: "sort array",
      resolve_count: 15,
      distinct_skills_returned: 3,
      avg_confidence: 0.65,
    },
  ],
  abandoned_executions: [
    {
      intent: "compute hash",
      resolve_count: 20,
      execute_count: 8,
      abandoned_count: 12,
    },
  ],
  skill_chain_patterns: [
    { from_skill: "skill-001", to_skill: "skill-002", chain_count: 45 },
  ],
  hourly_usage: [{ day_of_week: 1, hour_of_day: 9, event_count: 300 }],
};

describe("AgentBehaviorDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(screen.getByText(/loading agent behavior/i)).toBeInTheDocument();
  });

  it("renders error state", () => {
    mockUse.mockReturnValue({ data: null, loading: false, error: "Fetch failed", refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(screen.getByText(/error loading agent behavior/i)).toBeInTheDocument();
  });

  it("renders dashboard heading when data present", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(screen.getByText("Agent Behavior")).toBeInTheDocument();
  });

  it("renders conversion rate stat card", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(screen.getByText(/resolve.*execute conversion/i)).toBeInTheDocument();
  });

  it("renders total resolves stat", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(screen.getByText("1000")).toBeInTheDocument();
  });

  it("renders repeated resolves table with intent", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(screen.getByText("sort array")).toBeInTheDocument();
  });

  it("renders skill chaining patterns table", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(screen.getByText(/skill chaining patterns/i)).toBeInTheDocument();
    expect(screen.getByText("skill-001")).toBeInTheDocument();
  });

  it("renders abandoned executions table", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(screen.getByText("compute hash")).toBeInTheDocument();
  });

  it("calls useDashboardData with correct type and 60-minute interval", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<AgentBehaviorDashboard />);
    expect(mockUse).toHaveBeenCalledWith("agent-behavior", 3_600_000);
  });
});
