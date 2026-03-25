/**
 * Unit tests for src/analytics/eventId.ts
 *
 * Verifies:
 * - NULL_FIELD_SENTINEL is the string "null" (not empty string)
 * - computeEventId produces a 64-char hex SHA-256 digest
 * - computeEventId is deterministic
 * - computeEventId varies with each input field
 * - null fields use the "null" sentinel, not empty string
 */

import { computeEventId, NULL_FIELD_SENTINEL } from "../../../src/analytics/eventId.js";

describe("NULL_FIELD_SENTINEL", () => {
  it("is the string literal 'null' (not empty string)", () => {
    expect(NULL_FIELD_SENTINEL).toBe("null");
    expect(NULL_FIELD_SENTINEL).not.toBe("");
  });
});

describe("computeEventId", () => {
  const TS = "2026-03-23T00:00:00.000Z";
  const SKILL_ID = "11111111-1111-1111-1111-111111111111";
  const INTENT = "sort an array";
  const INPUT_HASH = "abc123def456";

  it("returns a 64-character hex string (SHA-256)", () => {
    const id = computeEventId("resolve", TS, SKILL_ID, INTENT, INPUT_HASH);
    expect(id).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(id)).toBe(true);
  });

  it("is deterministic — same inputs produce same output", () => {
    const id1 = computeEventId("resolve", TS, SKILL_ID, INTENT, INPUT_HASH);
    const id2 = computeEventId("resolve", TS, SKILL_ID, INTENT, INPUT_HASH);
    expect(id1).toBe(id2);
  });

  it("varies with event_type", () => {
    const id1 = computeEventId("resolve", TS, SKILL_ID, INTENT, INPUT_HASH);
    const id2 = computeEventId("execute", TS, SKILL_ID, INTENT, INPUT_HASH);
    expect(id1).not.toBe(id2);
  });

  it("varies with timestamp", () => {
    const id1 = computeEventId("resolve", TS, SKILL_ID, INTENT, INPUT_HASH);
    const id2 = computeEventId("resolve", "2026-03-23T00:01:00.000Z", SKILL_ID, INTENT, INPUT_HASH);
    expect(id1).not.toBe(id2);
  });

  it("varies with skill_id", () => {
    const id1 = computeEventId("resolve", TS, SKILL_ID, INTENT, INPUT_HASH);
    const id2 = computeEventId("resolve", TS, "22222222-2222-2222-2222-222222222222", INTENT, INPUT_HASH);
    expect(id1).not.toBe(id2);
  });

  it("varies with intent", () => {
    const id1 = computeEventId("resolve", TS, SKILL_ID, INTENT, INPUT_HASH);
    const id2 = computeEventId("resolve", TS, SKILL_ID, "different intent", INPUT_HASH);
    expect(id1).not.toBe(id2);
  });

  it("varies with input_hash", () => {
    const id1 = computeEventId("resolve", TS, SKILL_ID, INTENT, INPUT_HASH);
    const id2 = computeEventId("resolve", TS, SKILL_ID, INTENT, "different_hash");
    expect(id1).not.toBe(id2);
  });

  it("null skill_id uses 'null' sentinel — differs from empty string", () => {
    const withNull = computeEventId("resolve", TS, null, INTENT, INPUT_HASH);
    const withEmpty = computeEventId("resolve", TS, "", INTENT, INPUT_HASH);
    const withSentinel = computeEventId("resolve", TS, "null", INTENT, INPUT_HASH);
    // null uses "null" sentinel which equals passing "null" string explicitly
    expect(withNull).toBe(withSentinel);
    // null should NOT equal empty string
    expect(withNull).not.toBe(withEmpty);
  });

  it("null intent uses 'null' sentinel — differs from empty string", () => {
    const withNull = computeEventId("resolve", TS, SKILL_ID, null, INPUT_HASH);
    const withEmpty = computeEventId("resolve", TS, SKILL_ID, "", INPUT_HASH);
    expect(withNull).not.toBe(withEmpty);
  });

  it("null input_hash uses 'null' sentinel — differs from empty string", () => {
    const withNull = computeEventId("resolve", TS, SKILL_ID, INTENT, null);
    const withEmpty = computeEventId("resolve", TS, SKILL_ID, INTENT, "");
    expect(withNull).not.toBe(withEmpty);
  });

  it("all null fields produce a deterministic ID (no crash)", () => {
    const id = computeEventId("fail", TS, null, null, null);
    expect(id).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(id)).toBe(true);
  });
});
