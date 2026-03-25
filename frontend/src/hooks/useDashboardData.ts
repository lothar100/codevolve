import { useState, useEffect, useCallback } from "react";
import type { DashboardType, DashboardData } from "../types/dashboards";
import { useInterval } from "./useInterval";

const DEPLOYED_API_URL = "https://hra190v7x6.execute-api.us-east-2.amazonaws.com/v1";
/* eslint-disable @typescript-eslint/no-explicit-any */
const _meta = import.meta as any;
const API_BASE_URL: string =
  typeof _meta.env === "object" && _meta.env !== null
    ? ((_meta.env["VITE_API_URL"] as string | undefined) ?? DEPLOYED_API_URL)
    : DEPLOYED_API_URL;

const AUTO_REFRESH_MS = 30_000;

export interface UseDashboardDataResult<T extends DashboardData> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches dashboard data from GET /analytics/dashboards/{type}.
 * Auto-refreshes every 30 seconds.
 */
export function useDashboardData<T extends DashboardData>(
  type: DashboardType
): UseDashboardDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE_URL}/analytics/dashboards/${type}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json = (await response.json()) as T;
      setData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useInterval(fetchData, AUTO_REFRESH_MS);

  return { data, loading, error, refresh: fetchData };
}
