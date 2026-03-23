/**
 * Unit tests for useMountainData hook.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMountainData } from "../src/hooks/useMountainData.js";
import type { MountainFilters, MountainResponse } from "../src/types/mountain.js";

const MOCK_RESPONSE: MountainResponse = {
  generated_at: "2026-03-23T12:00:00Z",
  cache_hit: true,
  total_problems: 1,
  total_skills: 2,
  problems: [
    {
      problem_id: "p1",
      name: "Binary Search",
      difficulty: "easy",
      domain: ["searching"],
      skill_count: 2,
      dominant_status: "optimized",
      skill_status_distribution: {
        unsolved: 0,
        partial: 0,
        verified: 0,
        optimized: 2,
        archived: 0,
      },
      execution_count_30d: 500,
      canonical_skill: {
        skill_id: "s1",
        language: "python",
        confidence: 0.95,
        latency_p50_ms: 12,
      },
    },
  ],
};

const NO_FILTERS: MountainFilters = {
  domain: null,
  language: null,
  status: null,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMountainData", () => {
  it("returns data on successful fetch", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response);

    const { result } = renderHook(() => useMountainData(NO_FILTERS));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(MOCK_RESPONSE);
    expect(result.current.error).toBeNull();
  });

  it("sets error when fetch returns non-ok status", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    const { result } = renderHook(() => useMountainData(NO_FILTERS));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toMatch(/500/);
    expect(result.current.data).toBeNull();
  });

  it("sets error when fetch throws a network error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => useMountainData(NO_FILTERS));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network failure");
  });

  it("starts in loading state", () => {
    const fetchMock = vi.mocked(fetch);
    // Never resolves — we just check the initial state
    fetchMock.mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useMountainData(NO_FILTERS));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("appends domain query param when filter is set", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response);

    const filters: MountainFilters = {
      domain: "sorting",
      language: null,
      status: null,
    };

    renderHook(() => useMountainData(filters));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("domain=sorting");
  });

  it("appends language query param when filter is set", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response);

    const filters: MountainFilters = {
      domain: null,
      language: "python",
      status: null,
    };

    renderHook(() => useMountainData(filters));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("language=python");
  });

  it("appends status query param when filter is set", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response);

    const filters: MountainFilters = {
      domain: null,
      language: null,
      status: "optimized",
    };

    renderHook(() => useMountainData(filters));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("status=optimized");
  });

  it("does not append empty query string when no filters set", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response);

    renderHook(() => useMountainData(NO_FILTERS));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("?");
  });
});
