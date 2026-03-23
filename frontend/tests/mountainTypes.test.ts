/**
 * Unit tests for mountain type constants.
 */

import { describe, it, expect } from "vitest";
import {
  STATUS_COLORS,
  DIFFICULTY_HEIGHT,
  REFRESH_INTERVAL_MS,
} from "../src/types/mountain.js";

describe("STATUS_COLORS", () => {
  it("defines a color for every dominant_status", () => {
    expect(STATUS_COLORS.unsolved).toBe("#6B7280");
    expect(STATUS_COLORS.partial).toBe("#F59E0B");
    expect(STATUS_COLORS.verified).toBe("#3B82F6");
    expect(STATUS_COLORS.optimized).toBe("#10B981");
  });

  it("all colors are valid hex strings", () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const [, color] of Object.entries(STATUS_COLORS)) {
      expect(color).toMatch(hexPattern);
    }
  });
});

describe("DIFFICULTY_HEIGHT", () => {
  it("easy < medium < hard", () => {
    expect(DIFFICULTY_HEIGHT.easy).toBeLessThan(DIFFICULTY_HEIGHT.medium);
    expect(DIFFICULTY_HEIGHT.medium).toBeLessThan(DIFFICULTY_HEIGHT.hard);
  });

  it("easy is 1, medium is 2, hard is 3", () => {
    expect(DIFFICULTY_HEIGHT.easy).toBe(1);
    expect(DIFFICULTY_HEIGHT.medium).toBe(2);
    expect(DIFFICULTY_HEIGHT.hard).toBe(3);
  });
});

describe("REFRESH_INTERVAL_MS", () => {
  it("is exactly 5 minutes in milliseconds", () => {
    expect(REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});
