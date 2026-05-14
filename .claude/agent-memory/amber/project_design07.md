---
name: DESIGN-07 Analytics Dashboard Frontend
description: DESIGN-07 analytics dashboard frontend spec: navigation approach, chart library choice (Recharts), component tree, type file location, open questions about skill name resolution and mobile breakpoint
type: project
---

## DESIGN-07: Analytics Dashboard Frontend

**Status:** Complete. Appended to `docs/platform-design.md`. IMPL-18 row added to `tasks/todo.md` (Phase 3, Ada, unblocked).

**Completed:** 2026-03-23

### Key decisions made

- **Navigation:** Hash-based (`#mountain` / `#analytics`) tab bar in a new 48px `TopNav` component. No React Router — only two views, a full router is overhead.
- **Chart library:** Recharts (`^2.13.0`). Zero existing chart deps in `frontend/package.json`. Recharts chosen for bundle size (~130KB), React-native API, and full TypeScript support.
- **Heatmap:** Agent Behavior dashboard (D5) usage heatmap is a "Coming soon" placeholder — `agent-behavior` endpoint does not return hourly heatmap data. Deferred to a follow-up.
- **Skill name labels:** Bar charts display truncated UUID (last 8 chars + "…") because no batch skill-name endpoint exists. Full UUID in tooltip. Batch resolver deferred.
- **Polling:** Stops when `document.hidden === true`. Resumes on focus with immediate refetch if data is older than 2x the refresh interval.

### Component structure

All new files under `frontend/src/components/dashboards/`. Shared types at `frontend/src/types/dashboards.ts`. Hooks: `useDashboardData.ts`, `useInterval.ts` in `frontend/src/hooks/`.

### Open questions for IMPL-18

1. Batch skill name resolver — UUID labels acceptable for now; resolver deferred.
2. "Data as of X" stale-data warning for 1hr-refresh dashboards — Ada's judgment call.
3. Mobile breakpoint — analytics is desktop-only for IMPL-18.
