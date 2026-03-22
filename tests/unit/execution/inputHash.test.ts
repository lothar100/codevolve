/**
 * Unit tests for src/execution/inputHash.ts
 */

import { canonicalJson, computeInputHash } from "../../../src/execution/inputHash.js";

describe("canonicalJson", () => {
  it("produces identical output for same keys in different order", () => {
    const a = canonicalJson({ b: 2, a: 1 });
    const b = canonicalJson({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("sorts nested object keys recursively", () => {
    const result = canonicalJson({ z: { y: 2, x: 1 }, a: "hello" });
    // 'a' before 'z', 'x' before 'y' inside nested
    expect(result).toBe('{"a":"hello","z":{"x":1,"y":2}}');
  });

  it("preserves array element order (does not sort arrays)", () => {
    const result = canonicalJson({ nums: [3, 1, 2] });
    expect(result).toBe('{"nums":[3,1,2]}');
  });

  it("handles null values correctly", () => {
    expect(canonicalJson(null)).toBe("null");
  });

  it("handles primitives (number, string, boolean)", () => {
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hello")).toBe('"hello"');
    expect(canonicalJson(true)).toBe("true");
  });

  it("handles top-level arrays without sorting elements", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("sorts keys in objects inside arrays", () => {
    const result = canonicalJson([{ b: 2, a: 1 }, { d: 4, c: 3 }]);
    expect(result).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  it("handles empty object", () => {
    expect(canonicalJson({})).toBe("{}");
  });

  it("handles nested arrays without modification", () => {
    const result = canonicalJson({ arr: [[3, 2, 1]] });
    expect(result).toBe('{"arr":[[3,2,1]]}');
  });
});

describe("computeInputHash", () => {
  it("returns a 64-character hex string", () => {
    const hash = computeInputHash({ a: 1, b: 2 });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces identical hash for same keys in different order", () => {
    const hash1 = computeInputHash({ b: 2, a: 1 });
    const hash2 = computeInputHash({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different values", () => {
    const hash1 = computeInputHash({ a: 1 });
    const hash2 = computeInputHash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it("canonicalizes nested objects recursively before hashing", () => {
    const hash1 = computeInputHash({ nested: { b: 2, a: 1 } });
    const hash2 = computeInputHash({ nested: { a: 1, b: 2 } });
    expect(hash1).toBe(hash2);
  });

  it("does NOT sort arrays (different array order produces different hash)", () => {
    const hash1 = computeInputHash({ nums: [1, 2, 3] });
    const hash2 = computeInputHash({ nums: [3, 2, 1] });
    expect(hash1).not.toBe(hash2);
  });

  it("produces a deterministic hash for empty inputs", () => {
    const hash1 = computeInputHash({});
    const hash2 = computeInputHash({});
    expect(hash1).toBe(hash2);
  });
});
