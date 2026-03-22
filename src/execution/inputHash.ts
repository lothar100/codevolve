/**
 * Canonical JSON serialization and SHA-256 input hashing.
 *
 * Used by the /execute handler to derive a deterministic cache key
 * from the caller's inputs regardless of key insertion order.
 *
 * Rules:
 * - Object keys are sorted recursively (at all depths).
 * - Arrays are preserved as-is (element order is significant).
 * - Primitives and null are passed through JSON.stringify unchanged.
 */

import { createHash } from "node:crypto";

/**
 * Produce a deterministic JSON string by sorting object keys at every depth.
 * Arrays are not reordered — only object keys within the array elements are sorted.
 */
/**
 * Sort object keys recursively. Arrays are preserved as-is; only object keys are sorted.
 */
function sortObjectKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortObjectKeys(obj[key]);
      return acc;
    }, {});
}

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortObjectKeys(obj));
}

/**
 * Compute SHA-256 hash of the canonical JSON representation of inputs.
 * Returns a lowercase 64-character hex string.
 */
export function computeInputHash(inputs: Record<string, unknown>): string {
  const canonical = canonicalJson(inputs);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
