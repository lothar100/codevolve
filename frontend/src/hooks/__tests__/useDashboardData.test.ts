import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDashboardData } from "../useDashboardData";

const MOCK_DATA = {
  high_confidence_pct: 90,
  success_rate_pct: 98,
  latency_over_time: [],
  latency_histogram: [],
  high_confidence_over_time: [],
  low_confidence_resolves: [],
};

describe("useDashboardData", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns loading=true initially", () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_DATA),
    });

    const { result } = renderHook(() =>
      useDashboardData("resolve-performance")
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("returns data on successful fetch", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_DATA),
    });

    const { result } = renderHook(() =>
      useDashboardData("resolve-performance")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(MOCK_DATA);
    expect(result.current.error).toBeNull();
  });

  it("returns error when fetch fails with non-ok status", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const { result } = renderHook(() =>
      useDashboardData("execution-caching")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain("500");
    expect(result.current.data).toBeNull();
  });

  it("returns error when fetch throws network error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network offline")
    );

    const { result } = renderHook(() =>
      useDashboardData("skill-quality")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Network offline");
    expect(result.current.data).toBeNull();
  });

  it("calls correct API endpoint for the given type", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_DATA),
    });

    const { result } = renderHook(() =>
      useDashboardData("evolution-gap")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("evolution-gap");
  });

  it("exposes a refresh function that re-fetches data", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_DATA),
    });

    const { result } = renderHook(() =>
      useDashboardData("agent-behavior")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const fetchCallsBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(fetchCallsBefore);
  });
});
