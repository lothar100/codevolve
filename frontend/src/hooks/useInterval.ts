import { useEffect, useRef } from "react";

/**
 * Calls `callback` repeatedly at the given `intervalMs`.
 * Cleaned up automatically on unmount or when deps change.
 * Pass `null` to pause the interval.
 */
export function useInterval(
  callback: () => void,
  intervalMs: number | null
): void {
  const savedCallback = useRef<() => void>(callback);

  // Keep ref up-to-date so the interval always calls the latest version.
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (intervalMs === null) return;
    const id = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
