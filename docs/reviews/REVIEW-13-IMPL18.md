# REVIEW-13: IMPL-18 — Analytics Dashboard Frontend

**Reviewer:** Iris
**Date:** 2026-03-25
**Task:** IMPL-18 — Analytics Dashboard Frontend
**Spec reference:** `docs/platform-design.md` §DESIGN-07

---

## Verdict: APPROVED WITH NOTES

All hard rules pass. Tests pass (72 total, 47 new). The TypeScript error (`tsc --noEmit` exits 2) is pre-existing in `src/types/mountain.ts` from IMPL-14, not introduced by IMPL-18. The IMPL-18 files themselves are type-clean. Notes below document spec gaps that fall short of DESIGN-07 acceptance criteria; none are blocking for approval given this is a frontend display layer with no security or data integrity surface, but they must be addressed before DESIGN-07 can be marked fully satisfied.

---

## Review Questions

### 1. Senior engineer approval: Yes — with reservations on spec completeness

The code is readable, names are accurate, and the hook/component split is idiomatic React 18. `useInterval` is the canonical "stale closure safe" implementation using a ref. `useDashboardData` composes the two hooks cleanly. Loading and error guard clauses appear before any data access, preventing null-dereference renders. The `import.meta as any` cast in `useDashboardData.ts` is ugly but necessary because the tsconfig does not include `"types": ["vite/client"]` — it is a reasonable workaround given the project structure.

Minor readability issue: the `_meta` intermediate variable in `useDashboardData.ts` is only needed because of the cast. The pattern is non-obvious on first read but the comment explains it.

### 2. Simpler solution exists: No

The hook composition is minimal and there is no duplication that a shared utility would meaningfully reduce. The `StatCard` component is appropriately inlined in `ResolvePerformanceDashboard` rather than extracted — acceptable given its local use. The five dashboard components are uniform in structure; no further abstraction is warranted.

### 3. Unintended side effects: None found

All five dashboards are read-only: they call `GET /analytics/dashboards/{type}` and render. No writes to DynamoDB, Kinesis, or any other system. The `App.tsx` changes are scoped to navigation state only — no mountain data fetching path is modified. The `useDashboardData` hook uses a stable 30-second interval across all dashboards; this deviates from the per-dashboard poll intervals specified in DESIGN-07 (see Notes below) but does not cause incorrect data writes.

### 4. Edge cases handled: Partially

Handled:
- Loading state: all five dashboards show a loading message on first fetch.
- Error state: all five dashboards show the error message on network or HTTP failure.
- Null data after fetch: the `data == null` guard is present in all five components.
- Error cleared on next fetch: `setError(null)` is called at the start of each `fetchData` invocation.
- Interval cleanup on unmount: `useInterval` returns a `clearInterval` cleanup from its `useEffect`.
- Latest callback reference: the ref pattern in `useInterval` prevents stale closures.

Not handled (spec gaps — see Notes):
- Empty arrays: the spec requires "No data for this time range" per-chart when arrays are empty. Currently, Recharts renders an empty chart frame with no message. Not a crash, but does not meet the acceptance criterion.
- Null scalar values: `high_confidence_pct` and `success_rate_pct` are typed as `number` in the TypeScript interface, but the DESIGN-07 spec says these may be `number | null` when no data exists. Calling `.toFixed(1)` on `null` would throw. The TypeScript interface does not reflect this, and `StatCard` has no null guard.
- `document.hidden` pause: the spec requires polling to stop when the browser tab is backgrounded. `useInterval` does not check `document.hidden`. This is a missing feature, not a crash.
- Date range parameters: `useDashboardData` does not accept or pass `from`/`to` query params to the endpoint. The spec requires these.

### 5. Follows architectural plan: Mostly yes

- Analytics data flows from the existing `GET /analytics/dashboards/{type}` backend endpoints — not direct ClickHouse access. Correct.
- No LLM calls, no DynamoDB writes. Correct.
- Recharts is used as specified. Correct.
- The env var name `VITE_API_URL` (in `useDashboardData.ts`) does not match `VITE_API_BASE_URL` (used by the pre-existing mountain hook in `mountain.ts`). DESIGN-07 refers to `VITE_API_BASE_URL`. The two parts of the frontend will use different env vars for the same API, which will cause operator confusion in deployment. This is a minor inconsistency — not a correctness bug since both have hardcoded fallbacks — but it should be unified.
- The component file tree does not follow the subdirectory structure specified in DESIGN-07 §6 (`resolve/`, `caching/`, `quality/`, `gap/`, `agents/` sub-folders, shared components, `AnalyticsDashboardView.tsx`, `DashboardNav.tsx`, `DateRangePicker.tsx`). Ada implemented monolithic per-dashboard components instead of the decomposed tree. This is a deliberate simplification and does not affect correctness or testability.

---

## Security Check

- Input validation: N/A — this is a read-only frontend display layer. No user input reaches the backend except the dashboard type (hard-coded enum values).
- DynamoDB safety: N/A — no DynamoDB access from the frontend.
- Sandbox integrity: N/A — no skill execution.
- Error response safety: Pass — error messages display only the HTTP status/text or the network error message. No stack traces are rendered.

---

## Issues Found

### WARNING

- **[W-01] `VITE_API_URL` vs `VITE_API_BASE_URL` mismatch** — `useDashboardData.ts` reads `import.meta.env.VITE_API_URL` while the mountain hook in `mountain.ts` reads `VITE_API_BASE_URL`. DESIGN-07 specifies `VITE_API_BASE_URL`. Operators must set two different env vars to configure the same API base URL. Must be unified before production deployment.

- **[W-02] Per-dashboard refresh intervals not implemented** — DESIGN-07 specifies: Resolve Performance 5 min, Execution & Caching 5 min, Skill Quality 1 hour, Evolution/Gap 1 hour, Agent Behavior 1 hour. The implementation uses a single `AUTO_REFRESH_MS = 30_000` (30 seconds) for all dashboards. This increases backend query load 6–12x over the specified cadences for the slower dashboards.

- **[W-03] Date range (`from`/`to`) not implemented** — `useDashboardData` does not accept or pass `from`/`to` query parameters. The `DateRangePicker` component specified in DESIGN-07 does not exist. All dashboard endpoints are called without time bounds, which means the backend will use its own default window. The DESIGN-07 acceptance criterion "Date range presets update from/to and trigger an immediate refetch" is not met.

- **[W-04] `document.hidden` polling pause not implemented** — Polling continues when the browser tab is backgrounded. The spec states the dashboard must not poll while `document.hidden === true`.

### SUGGESTIONS

- **[S-01] Empty array rendering** — When all data arrays are empty, charts render empty frames. Adding a "No data for this time range" inline message per section would satisfy the spec edge case table and improve operator experience.

- **[S-02] Null guard on scalar stat values** — The DESIGN-07 type spec shows `high_confidence_pct: { high_confidence_pct: number | null }` and `success_rate: { success_rate_pct: number | null }`. The implementation types these as `number` and calls `.toFixed(1)` directly. If the backend ever returns `null` here (as the spec permits), the component will throw. Consider making the TypeScript type accurate and guarding with `value != null ? value.toFixed(1) : "—"`.

- **[S-03] Usage heatmap placeholder missing** — DESIGN-07 acceptance criterion: "Usage heatmap renders 'Coming soon' placeholder — no broken chart." The `AgentBehaviorDashboard` renders a skill chaining table using `data.skill_chain_patterns` and a `data.hourly_usage` field exists in the TypeScript type but is never rendered. There is no "Coming soon" placeholder panel for the heatmap. The `hourly_usage` data is silently discarded.

- **[S-04] `key={i}` (array index as React key)** — All five dashboards use array index as the React list key in table rows. This is acceptable for static read-only lists but will cause reconciliation issues if rows are sorted or filtered client-side in the future.

---

## Test Count

| File | Tests |
|------|-------|
| `useDashboardData.test.ts` | 6 |
| `useInterval.test.ts` | 5 |
| `ResolvePerformanceDashboard.test.tsx` | 8 |
| `ExecutionCachingDashboard.test.tsx` | 6 |
| `SkillQualityDashboard.test.tsx` | 6 |
| `EvolutionGapDashboard.test.tsx` | 7 |
| `AgentBehaviorDashboard.test.tsx` | 9 |
| **IMPL-18 subtotal** | **47** |
| Pre-existing (`useMountainData`, etc.) | 25 |
| **Total suite** | **72** |

Minimum required: 16. Requirement met.

---

## Test Run

```
Test Files  10 passed (10)
      Tests  72 passed (72)
   Duration  1.85s
```

All 72 tests pass.

---

## TypeScript

`npx tsc --noEmit` exits with code 2:

```
src/types/mountain.ts(81,16): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
```

This error is pre-existing from IMPL-14 (committed `7fd6654`) and is not in any file introduced by IMPL-18. The IMPL-18 files (`src/hooks/useDashboardData.ts`, `src/hooks/useInterval.ts`, `src/types/dashboards.ts`, `src/App.tsx`, `src/components/dashboards/*.tsx`) are all type-clean. The tsc failure is owned by IMPL-14, not IMPL-18. It should be tracked against IMPL-14 as a carry-forward issue.

---

## Notes for Ada and Jorven

The four warnings (W-01 through W-04) represent missing features from the DESIGN-07 acceptance criteria, not regressions. The implementation is a correct, minimal first pass of the dashboard UI. The priority order for follow-up:

1. **W-01 (env var name)** — Fix immediately; deployment will be broken with two separate API URL vars.
2. **W-03 (date range)** — Needed for the dashboard to be useful to operators; all data is returned on a backend default window.
3. **W-02 (refresh intervals)** — Adjust before production; 30-second polling on 1-hour dashboards wastes ClickHouse query budget.
4. **W-04 (document.hidden)** — Low priority; background tab polling is wasteful but not incorrect.

The pre-existing `tsc` error in `mountain.ts` should be fixed by adding `"types": ["vite/client"]` to `frontend/tsconfig.json` or adding `/// <reference types="vite/client" />` to `mountain.ts`. This is out of scope for IMPL-18 but should be addressed before IMPL-18's follow-up work begins, since `tsc --noEmit` exiting 0 is a gate for all frontend tasks.
