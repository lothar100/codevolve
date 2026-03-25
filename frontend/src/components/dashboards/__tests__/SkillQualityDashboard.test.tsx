import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkillQualityDashboard } from "../SkillQualityDashboard";
import type { SkillQualityDashboard as DashboardData } from "../../../types/dashboards";

vi.mock("../../../hooks/useDashboardData", () => ({
  useDashboardData: vi.fn(),
}));

import { useDashboardData } from "../../../hooks/useDashboardData";
const mockUse = useDashboardData as ReturnType<typeof vi.fn>;

const SAMPLE_DATA: DashboardData = {
  test_pass_rates: [
    { skill_id: "skill-001", passed: 9, failed: 1, pass_rate_pct: 90.0 },
  ],
  confidence_over_time: [
    {
      skill_id: "skill-001",
      hour: "2026-01-01T00:00:00Z",
      avg_confidence: 0.88,
      min_confidence: 0.82,
    },
  ],
  failure_rates: [
    {
      skill_id: "skill-001",
      total_executions: 100,
      failures: 5,
      failure_rate_pct: 5.0,
    },
  ],
  competing_implementations: [
    {
      intent: "sort array",
      competing_skills: ["skill-001", "skill-002"],
      num_competitors: 2,
      best_confidence: 0.95,
      worst_confidence: 0.7,
    },
  ],
  confidence_degradation: [
    {
      skill_id: "skill-003",
      prior_conf: 0.9,
      recent_conf: 0.78,
      confidence_delta: -0.12,
    },
  ],
};

describe("SkillQualityDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<SkillQualityDashboard />);
    expect(screen.getByText(/loading skill quality/i)).toBeInTheDocument();
  });

  it("renders error state", () => {
    mockUse.mockReturnValue({ data: null, loading: false, error: "Server error", refresh: vi.fn() });
    render(<SkillQualityDashboard />);
    expect(screen.getByText(/error loading skill quality/i)).toBeInTheDocument();
  });

  it("renders dashboard heading when data is present", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<SkillQualityDashboard />);
    expect(screen.getByText("Skill Quality")).toBeInTheDocument();
  });

  it("renders competing implementations table", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<SkillQualityDashboard />);
    expect(screen.getByText("sort array")).toBeInTheDocument();
  });

  it("renders confidence degradation table with delta", () => {
    mockUse.mockReturnValue({ data: SAMPLE_DATA, loading: false, error: null, refresh: vi.fn() });
    render(<SkillQualityDashboard />);
    expect(screen.getByText("skill-003")).toBeInTheDocument();
  });

  it("calls useDashboardData with correct type and 60-minute interval", () => {
    mockUse.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() });
    render(<SkillQualityDashboard />);
    expect(mockUse).toHaveBeenCalledWith("skill-quality", 3_600_000);
  });
});
