import { deriveEventId } from '../../../src/analytics/eventId.js';
import { AnalyticsEvent } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    event_type: 'execute',
    timestamp: '2026-03-22T12:00:00.000Z',
    skill_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    intent: 'sort a list',
    latency_ms: 42,
    confidence: 0.95,
    cache_hit: false,
    input_hash: 'abc123',
    success: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveEventId', () => {
  it('returns the same hash for identical inputs (deterministic)', () => {
    const event = makeEvent();
    expect(deriveEventId(event)).toBe(deriveEventId(event));
  });

  it('returns a different hash when skill_id differs', () => {
    const a = makeEvent({ skill_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    const b = makeEvent({ skill_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
    expect(deriveEventId(a)).not.toBe(deriveEventId(b));
  });

  it('returns a different hash when event_type differs', () => {
    const a = makeEvent({ event_type: 'execute' });
    const b = makeEvent({ event_type: 'resolve' });
    expect(deriveEventId(a)).not.toBe(deriveEventId(b));
  });

  it('returns a different hash when timestamp differs', () => {
    const a = makeEvent({ timestamp: '2026-03-22T12:00:00.000Z' });
    const b = makeEvent({ timestamp: '2026-03-22T13:00:00.000Z' });
    expect(deriveEventId(a)).not.toBe(deriveEventId(b));
  });

  it('returns a different hash when input_hash differs', () => {
    const a = makeEvent({ input_hash: 'abc123' });
    const b = makeEvent({ input_hash: 'def456' });
    expect(deriveEventId(a)).not.toBe(deriveEventId(b));
  });

  it('does not crash when skill_id is null (uses "null" string)', () => {
    const event = makeEvent({ skill_id: null });
    expect(() => deriveEventId(event)).not.toThrow();
    expect(typeof deriveEventId(event)).toBe('string');
  });

  it('null input_hash does not crash and does not collide with a non-null input_hash', () => {
    const withNull = makeEvent({ input_hash: null });
    const withValue = makeEvent({ input_hash: 'somevalue' });
    expect(() => deriveEventId(withNull)).not.toThrow();
    expect(deriveEventId(withNull)).not.toBe(deriveEventId(withValue));
  });
});
