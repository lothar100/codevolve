/**
 * Unit tests for src/shared/deepEqual.ts
 */

import { deepEqual } from "../../../src/shared/deepEqual.js";

describe("deepEqual", () => {
  // ---------------------------------------------------------------------------
  // Primitives — equal
  // ---------------------------------------------------------------------------

  describe("equal primitives", () => {
    it("returns true for identical numbers", () => {
      expect(deepEqual(42, 42)).toBe(true);
    });

    it("returns true for identical strings", () => {
      expect(deepEqual("hello", "hello")).toBe(true);
    });

    it("returns true for identical booleans", () => {
      expect(deepEqual(true, true)).toBe(true);
      expect(deepEqual(false, false)).toBe(true);
    });

    it("returns true for zero compared to zero", () => {
      expect(deepEqual(0, 0)).toBe(true);
    });

    it("returns true for empty string compared to empty string", () => {
      expect(deepEqual("", "")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Primitives — unequal
  // ---------------------------------------------------------------------------

  describe("unequal primitives", () => {
    it("returns false for different numbers", () => {
      expect(deepEqual(1, 2)).toBe(false);
    });

    it("returns false for different strings", () => {
      expect(deepEqual("a", "b")).toBe(false);
    });

    it("returns false for different boolean values", () => {
      expect(deepEqual(true, false)).toBe(false);
    });

    it("returns false for number vs string with same coercive value", () => {
      expect(deepEqual(1, "1")).toBe(false);
    });

    it("returns false for 0 vs false", () => {
      expect(deepEqual(0, false)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Null and undefined
  // ---------------------------------------------------------------------------

  describe("null and undefined handling", () => {
    it("returns true for null vs null", () => {
      expect(deepEqual(null, null)).toBe(true);
    });

    it("returns true for undefined vs undefined", () => {
      expect(deepEqual(undefined, undefined)).toBe(true);
    });

    it("returns false for null vs undefined", () => {
      expect(deepEqual(null, undefined)).toBe(false);
    });

    it("returns false for null vs 0", () => {
      expect(deepEqual(null, 0)).toBe(false);
    });

    it("returns false for null vs empty string", () => {
      expect(deepEqual(null, "")).toBe(false);
    });

    it("returns false for null vs object", () => {
      expect(deepEqual(null, {})).toBe(false);
    });

    it("returns false for object vs null", () => {
      expect(deepEqual({}, null)).toBe(false);
    });

    it("returns false for undefined vs object", () => {
      expect(deepEqual(undefined, {})).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Nested objects — equal (key-order-independent)
  // ---------------------------------------------------------------------------

  describe("equal nested objects — key-order-independent", () => {
    it("returns true for identical flat objects", () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    it("returns true for flat objects with different key order", () => {
      expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    });

    it("returns true for nested objects with different key order", () => {
      const a = { x: { foo: 1, bar: 2 }, y: 3 };
      const b = { y: 3, x: { bar: 2, foo: 1 } };
      expect(deepEqual(a, b)).toBe(true);
    });

    it("returns true for deeply nested equal objects", () => {
      const a = { a: { b: { c: { d: 42 } } } };
      const b = { a: { b: { c: { d: 42 } } } };
      expect(deepEqual(a, b)).toBe(true);
    });

    it("returns true for objects containing null values", () => {
      expect(deepEqual({ a: null, b: 1 }, { b: 1, a: null })).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Nested objects — unequal
  // ---------------------------------------------------------------------------

  describe("unequal nested objects", () => {
    it("returns false for objects with different values at the same key", () => {
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it("returns false for objects with different key sets", () => {
      expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    });

    it("returns false for objects with different key counts", () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    });

    it("returns false for nested objects with different deep values", () => {
      expect(deepEqual({ x: { a: 1 } }, { x: { a: 2 } })).toBe(false);
    });

    it("returns false when a nested key is missing in b", () => {
      expect(deepEqual({ x: { a: 1, b: 2 } }, { x: { a: 1 } })).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Arrays
  // ---------------------------------------------------------------------------

  describe("arrays", () => {
    it("returns true for equal empty arrays", () => {
      expect(deepEqual([], [])).toBe(true);
    });

    it("returns true for equal primitive arrays", () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it("returns true for equal nested arrays", () => {
      expect(deepEqual([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true);
    });

    it("returns true for arrays of equal objects", () => {
      expect(deepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
    });

    it("returns false for arrays with same elements in different order", () => {
      expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    });

    it("returns false for arrays of different lengths", () => {
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it("returns false for arrays with different element values", () => {
      expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it("returns false when comparing array to object", () => {
      expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed / edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("returns true for two empty objects", () => {
      expect(deepEqual({}, {})).toBe(true);
    });

    it("returns false for object vs primitive", () => {
      expect(deepEqual({}, 1)).toBe(false);
    });

    it("returns true for objects containing array values", () => {
      expect(deepEqual({ arr: [1, 2, 3] }, { arr: [1, 2, 3] })).toBe(true);
    });

    it("returns false for objects containing arrays with different order", () => {
      expect(deepEqual({ arr: [1, 2, 3] }, { arr: [3, 2, 1] })).toBe(false);
    });
  });
});
