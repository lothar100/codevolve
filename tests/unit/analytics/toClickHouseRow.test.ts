import { toClickHouseRow } from "../../../src/analytics/toClickHouseRow.js";
import type { AnalyticsEvent } from "../../../src/shared/types.js";

const FULL_EVENT: AnalyticsEvent = {
  event_type: "execute",
  timestamp: "2026-03-22T10:00:00.000Z",
  skill_id: "550e8400-e29b-41d4-a716-446655440000",
  intent: "sort an array",
  latency_ms: 42,
  confidence: 0.95,
  cache_hit: true,
  input_hash: "abc123def456",
  success: true,
};

const EVENT_ID = "test-event-id-hex";

describe("toClickHouseRow", () => {
  it("maps a fully populated event to the correct ClickHouseRow shape", () => {
    const row = toClickHouseRow(FULL_EVENT, EVENT_ID);

    expect(row).toEqual({
      event_id: EVENT_ID,
      event_type: "execute",
      timestamp: "2026-03-22T10:00:00.000Z",
      skill_id: "550e8400-e29b-41d4-a716-446655440000",
      intent: "sort an array",
      latency_ms: 42,
      confidence: 0.95,
      cache_hit: 1,
      input_hash: "abc123def456",
      success: 1,
    });
  });

  it("maps null skill_id to empty string", () => {
    const event: AnalyticsEvent = { ...FULL_EVENT, skill_id: null };
    const row = toClickHouseRow(event, EVENT_ID);

    expect(row.skill_id).toBe("");
  });

  it("keeps confidence as null when null on the event", () => {
    const event: AnalyticsEvent = { ...FULL_EVENT, confidence: null };
    const row = toClickHouseRow(event, EVENT_ID);

    expect(row.confidence).toBeNull();
  });

  it("maps cache_hit: true to 1", () => {
    const event: AnalyticsEvent = { ...FULL_EVENT, cache_hit: true };
    const row = toClickHouseRow(event, EVENT_ID);

    expect(row.cache_hit).toBe(1);
  });

  it("maps cache_hit: false to 0", () => {
    const event: AnalyticsEvent = { ...FULL_EVENT, cache_hit: false };
    const row = toClickHouseRow(event, EVENT_ID);

    expect(row.cache_hit).toBe(0);
  });

  it("maps success: true to 1", () => {
    const event: AnalyticsEvent = { ...FULL_EVENT, success: true };
    const row = toClickHouseRow(event, EVENT_ID);

    expect(row.success).toBe(1);
  });

  it("maps success: false to 0", () => {
    const event: AnalyticsEvent = { ...FULL_EVENT, success: false };
    const row = toClickHouseRow(event, EVENT_ID);

    expect(row.success).toBe(0);
  });

  it("maps null intent to empty string", () => {
    const event: AnalyticsEvent = { ...FULL_EVENT, intent: null };
    const row = toClickHouseRow(event, EVENT_ID);

    expect(row.intent).toBe("");
  });

  it("maps null input_hash to empty string", () => {
    const event: AnalyticsEvent = { ...FULL_EVENT, input_hash: null };
    const row = toClickHouseRow(event, EVENT_ID);

    expect(row.input_hash).toBe("");
  });
});
