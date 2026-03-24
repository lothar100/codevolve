/**
 * Recursive deep equality utility.
 *
 * Rules:
 *   - Primitives: compared with ===
 *   - null / undefined: compared with ===
 *   - Arrays: order-sensitive element-wise comparison
 *   - Objects: key-order-independent, all keys from both sides must match
 *
 * No JSON.stringify. No external dependencies.
 */

export function deepEqual(a: unknown, b: unknown): boolean {
  // Identical references or primitives
  if (a === b) return true;

  // One is null/undefined, other is not (a !== b already ruled out above)
  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }

  // Different types
  if (typeof a !== typeof b) return false;

  // Non-object primitives that passed === already — cannot be equal
  if (typeof a !== "object") return false;

  // Both are objects from here on

  // Array check — both must be arrays or both must be plain objects
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);

  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    // Both are arrays — order-sensitive
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Both are plain objects — key-order-independent
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}
