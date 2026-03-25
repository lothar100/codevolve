import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInterval } from "../useInterval";

describe("useInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls callback after the interval elapses", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 1000));

    expect(cb).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("calls callback repeatedly for each interval", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 500));

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(cb).toHaveBeenCalledTimes(5);
  });

  it("does not call callback when intervalMs is null", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, null));

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("clears interval on unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useInterval(cb, 1000));

    act(() => {
      vi.advanceTimersByTime(500);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("always calls the latest callback reference", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    let currentCb = cb1;

    const { rerender } = renderHook(() => useInterval(currentCb, 1000));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cb1).toHaveBeenCalledTimes(1);

    currentCb = cb2;
    rerender();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb1).toHaveBeenCalledTimes(1); // not called again
  });
});
