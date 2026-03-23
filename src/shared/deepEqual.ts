/**
 * Deep equality comparison for arbitrary values.
 *
 * Rules (per §2.6):
 *   - Primitives: strict ===
 *   - null === null is true; undefined is always a mismatch
 *   - Arrays: same length + each element recursively equal at the same index
 *   - Objects (non-null, non-array): same keys (order-independent) + each
 *     value recursively equal
 *   - Number precision: exact (no epsilon tolerance)
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  // Strict primitive / reference equality covers: numbers, strings, booleans,
  // null === null, and same-reference objects.
  if (a === b) return true;

  // At this point a !== b. If either is null or not an object/function,
  // they can't be structurally equal (primitives are already covered above).
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  // Both are non-null objects. Differentiate arrays from plain objects.
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);

  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    // Cast is safe: we checked Array.isArray above.
    const aArr = a as unknown[];
    const bArr = b as unknown[];
    if (aArr.length !== bArr.length) return false;
    for (let i = 0; i < aArr.length; i++) {
      if (!deepEqual(aArr[i], bArr[i])) return false;
    }
    return true;
  }

  // Both are plain objects.
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    // Key must exist in b and values must be recursively equal.
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}
