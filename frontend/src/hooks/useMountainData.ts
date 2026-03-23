/**
 * useMountainData hook.
 *
 * Fetches data from GET /analytics/dashboards/mountain and re-fetches
 * every 5 minutes (REFRESH_INTERVAL_MS) per DESIGN-04.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { MountainResponse, MountainFilters } from "../types/mountain.js";
import { API_BASE_URL, REFRESH_INTERVAL_MS } from "../types/mountain.js";

export interface UseMountainDataResult {
  data: MountainResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function buildQueryString(filters: MountainFilters): string {
  const params = new URLSearchParams();
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.language) params.set("language", filters.language);
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useMountainData(filters: MountainFilters): UseMountainDataResult {
  const [data, setData] = useState<MountainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track whether the component is still mounted to prevent stale state updates
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    const qs = buildQueryString(filters);
    const url = `${API_BASE_URL}/analytics/dashboards/mountain${qs}`;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json = (await response.json()) as MountainResponse;
      if (mountedRef.current) {
        setData(json);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [filters.domain, filters.language, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();

    // Refresh every 5 minutes per DESIGN-04 spec
    intervalRef.current = setInterval(() => {
      void fetchData();
    }, REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refetch: () => void fetchData(),
  };
}
