# REVIEW-15: IMPL-18 — Analytics Dashboard Frontend (Warning Fix Verification)

**Reviewer:** Iris
**Date:** 2026-03-25
**Task:** IMPL-18 — Analytics Dashboard Frontend (re-review after Ada's warning fixes)
**Prior review:** REVIEW-13-IMPL18 (Approved with notes W-01 through W-04)
**Spec reference:** `docs/platform-design.md` §DESIGN-07

---

## Verdict: APPROVED WITH NOTES

W-01, W-02, and W-04 are correctly implemented and verified. W-03 (date range `from`/`to`) was
explicitly deferred by Ada and remains open. This is acceptable: W-03 does not affect correctness,
security, or data integrity — it is a missing feature that makes the dashboard less operator-friendly
but does not cause incorrect results. IMPL-18 may be marked `[✓]` Complete with W-03 carried forward
as a named open item.

All 75 tests pass. The pre-existing `tsc --noEmit` failure in `mountain.ts` is confirmed carry-forward
from IMPL-14 and was not introduced or worsened by this patch.

---

## Warning Fix Verification

### W-01 — `VITE_API_URL` → `VITE_API_BASE_URL` unification

**Status: RESOLVED.**

`frontend/src/hooks/useDashboardData.ts` line 10 now reads:

```ts
((_meta.env["VITE_API_BASE_URL"] as string | undefined) ?? DEPLOYED_API_URL)
```

The key `VITE_API_BASE_URL` matches the name used by the pre-existing mountain hook in `mountain.ts`
and the name specified in DESIGN-07. Operators configure one env var for both parts of the frontend.

---

### W-02 — Per-dashboard refresh intervals

**Status: RESOLVED.**

`useDashboardData` now accepts an `intervalMs: number = 300_000` parameter. Each dashboard passes
the correct value per DESIGN-07 spec:

| Dashboard | `intervalMs` passed | DESIGN-07 spec | Match |
|-----------|-------------------|----------------|-------|
| `ResolvePerformanceDashboard` | `300_000` (5 min) | 5 min | Yes |
| `ExecutionCachingDashboard` | `300_000` (5 min) | 5 min | Yes |
| `SkillQualityDashboard` | `3_600_000` (1 hr) | 1 hr | Yes |
| `EvolutionGapDashboard` | `3_600_000` (1 hr) | 1 hr | Yes |
| `AgentBehaviorDashboard` | `3_600_000` (1 hr) | 1 hr | Yes |

All five are correct. The previous flat 30-second cadence across all dashboards has been eliminated.

---

### W-03 — Date range `from`/`to` parameters

**Status: NOT RESOLVED — deferred by Ada.**

`useDashboardData` does not accept `from`/`to` parameters. No `DateRangePicker` component exists.
All five dashboard API calls remain unbounded time-range queries.

This was explicitly acknowledged in Ada's task notes as not addressed in this patch. It is carried
forward as an open item. DESIGN-07 acceptance criterion "Date range presets update from/to and
trigger an immediate refetch" remains unmet. This must be addressed before DESIGN-07 can be
declared fully satisfied, but it does not block IMPL-18 completion given it is a missing feature
rather than a regression or correctness bug.

---

### W-04 — `document.hidden` polling pause

**Status: RESOLVED.**

Two mechanisms are correctly implemented in `useDashboardData.ts`:

1. **Guard in `fetchData`** (lines 36–38): `if (typeof document !== "undefined" && document.hidden) return;`
   Interval ticks fire but are no-ops when the tab is backgrounded.

2. **`visibilitychange` listener** (lines 63–76): Fires `fetchData()` immediately when
   `document.hidden` transitions to `false`. The listener is registered with `addEventListener`
   and cleaned up with `removeEventListener` on unmount — no leak.

The `typeof document !== "undefined"` guard on both paths is correct for SSR safety.

---

## Review Questions

### 1. Senior engineer approval: Yes

The implementation of the three fixes is clean and idiomatic. The `document.hidden` guard and
`visibilitychange` cleanup are correct. The `intervalMs` parameter with a sensible default avoids
breaking existing call sites. The per-dashboard values are passed explicitly rather than relying on
the default, which makes the intent readable at the call site.

### 2. Simpler solution exists: No

The hook is already minimal. No further reduction is warranted.

### 3. Unintended side effects: None found

The three changes are confined to `useDashboardData.ts` (hook signature + body) and the five
dashboard component call sites. No other files were modified. The `useInterval` hook is unchanged.
Pre-existing mountain data fetching paths are unaffected.

### 4. Edge cases handled: Same as REVIEW-13 — no regression, no improvement

The fixes do not introduce new edge case gaps and do not close the pre-existing ones noted in
REVIEW-13 (S-01 empty arrays, S-02 null scalar guard, S-03 heatmap placeholder). These carry
forward from REVIEW-13 unchanged.

One new minor observation: the `visibilitychange` listener calls `fetchData()` on tab restore
regardless of how recently the last successful fetch completed. If an agent re-focuses the tab
0.5 seconds after a successful fetch, a redundant request fires. This is cosmetically wasteful
but not a correctness issue and is consistent with the spec requirement ("resumes immediately on
visibility restore").

### 5. Follows architectural plan: Yes

No change to architectural posture from REVIEW-13. Analytics data flows read-only from backend
endpoints. No DynamoDB writes, no Kinesis writes, no LLM calls.

---

## Security Check

No change to security posture from REVIEW-13.

- Input validation: N/A — read-only display layer, no user input reaches backend.
- DynamoDB safety: N/A.
- Sandbox integrity: N/A.
- Error response safety: Pass — unchanged from REVIEW-13.

---

## Test Run

```
Test Files  10 passed (10)
      Tests  75 passed (75)
   Duration  2.26s
```

All 75 tests pass. The 3 new tests added for this patch are in
`src/hooks/__tests__/useDashboardData.test.ts`:

| New test | Covers |
|----------|--------|
| `polls at the given intervalMs` | W-02: verifies `intervalMs` parameter drives `useInterval` |
| `skips fetch when document.hidden is true` | W-04: verifies guard suppresses fetch |
| `re-fetches when tab becomes visible after being hidden` | W-04: verifies `visibilitychange` re-fetch |

All three tests are meaningful and exercise the correct behavior paths. The `polls at the given
intervalMs` test uses `vi.advanceTimersByTime(1000)` with a 1000ms interval — a clean,
deterministic approach.

**Act warning:** The "returns loading=true initially" test emits a React `act(...)` warning to
stderr. The test passes and the warning is pre-existing (present in REVIEW-13 suite at 72 tests).
It is not introduced by this patch. It is a test hygiene issue — the component state update after
the async fetch is not wrapped in `act`. Not a failure, but should be cleaned up.

---

## TypeScript

`npx tsc --noEmit` exits with code 2:

```
src/types/mountain.ts(81,16): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
```

Same single error as REVIEW-13. Confirmed pre-existing from IMPL-14. Not introduced or changed by
this patch. No new TypeScript errors in any IMPL-18 file.

---

## Issues Found

- **[WARNING — W-03 CARRY-FORWARD] Date range `from`/`to` not implemented** — `useDashboardData`
  still does not accept or pass date range parameters. `DateRangePicker` component does not exist.
  DESIGN-07 acceptance criterion "Date range presets update from/to and trigger an immediate
  refetch" is unmet. Must be addressed before DESIGN-07 is fully satisfied. Does not block
  IMPL-18 completion.

- **[SUGGESTION] Act warning in `useDashboardData.test.ts`** — The "returns loading=true
  initially" test triggers a React `act(...)` warning because the async state update following
  the initial fetch is not wrapped. Wrapping the render in `act` or using `waitFor` to assert
  after the fetch settles would eliminate the warning and make the test intention clearer.

---

## Open Items Carried Forward (not blocking)

| ID | Description | Owner |
|----|-------------|-------|
| W-03 | `from`/`to` date range params + `DateRangePicker` | Ada |
| S-01 | Empty array "No data" inline message per chart section | Ada |
| S-02 | Null guard on `high_confidence_pct` / `success_rate_pct` in `StatCard` | Ada |
| S-03 | "Coming soon" heatmap placeholder in `AgentBehaviorDashboard` | Ada |
| tsc | `mountain.ts` `ImportMeta.env` error (IMPL-14 carry-forward) | Ada |

---

## Notes for Ada and Jorven

W-01, W-02, and W-04 are all correct — well implemented and well tested. The three new tests are
solid and cover the right scenarios deterministically. IMPL-18 is complete. W-03 should be
prioritised in the next pass on DESIGN-07 acceptance criteria.

The `tsc --noEmit` failure in `mountain.ts` continues to prevent the frontend from having a clean
type gate. Adding `/// <reference types="vite/client" />` to `mountain.ts` (or adding
`"types": ["vite/client"]` to `frontend/tsconfig.json`) would close this without any other code
changes. It should be done before any further frontend tasks are reviewed against a `tsc` clean
gate.
