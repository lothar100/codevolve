# REVIEW-02: ARCH-01 / ARCH-02 Re-Review (REVIEW-01 Resolution Verification)

> Reviewer: Iris (review agent)
> Date: 2026-03-21
> Files reviewed: `docs/dynamo-schemas.md` (ARCH-01), `docs/api.md` (ARCH-02)
> References: `docs/reviews/REVIEW-01.md`, `CLAUDE.md`
> Purpose: Verify all REVIEW-01 findings are resolved; check for new issues; determine whether Ada may proceed with IMPL-01.

---

## 1. Summary

**Verdict: Approved**

All six REVIEW-01 critical issues are resolved. Both specs are now internally consistent and architecturally sound. The revisions are clean — they fix exactly what was broken without introducing new contradictions. Seven of ten non-critical issues are also resolved; the remaining three are documented below as open warnings. None of the open non-criticals block IMPL-01. Ada may proceed with project scaffolding.

One new minor inconsistency was introduced (N-NEW-01 below) — it does not require a spec revision before implementation starts, but should be addressed before IMPL-02.

---

## 2. Critical Issue Verification

### C-01: `is_archived` vs `status: "archived"` — RESOLVED

**Status: Resolved.**

- `api.md` line 40: `SkillStatus` enum now reads `z.enum(["unsolved", "partial", "verified", "optimized", "archived"])`. `"archived"` is present.
- `is_archived` field has been removed from the `Skill` schema entirely (lines 85-107). No trace remains.
- `POST /skills/:id/archive` side effects (line 493) now correctly read: "Set `status = "archived"`, set `archived_at`, update `updated_at`."
- `GET /skills` default behavior (line 387): `include_archived` boolean param replaces any previous `is_archived` filter. Listing correctly excludes archived by default.
- `dynamo-schemas.md` line 96: Skills table `status` attribute lists `"unsolved", "partial", "verified", "optimized", "archived"` — matches api.md exactly.
- GSI designs (`GSI-problem-status`, `GSI-status-updated`) use `status` as a key and therefore function correctly for archived filtering.

**Verdict: Clean resolution. No residual inconsistency.**

---

### C-02: Offset-based pagination — RESOLVED

**Status: Resolved.**

- `api.md` `PaginationMeta` (lines 139-142) is now:
  ```typescript
  const PaginationMeta = z.object({
    limit: z.number().int().positive(),
    next_token: z.string().nullable(),
  });
  ```
  `offset` and `total` are gone.
- The Pagination section (lines 208-221) documents `limit` + `next_token` as cursor-based. The note on line 219 explicitly calls out that DynamoDB does not support cheap total counts.
- All list endpoints (`GET /skills`, `GET /skills/:id/versions`, `GET /problems`) use `next_token`. No `offset` parameter exists anywhere in the file.
- `dynamo-schemas.md` access patterns consistently use `ExclusiveStartKey` semantics (via ScanIndexForward patterns), which map correctly to `next_token`.

**Verdict: Clean resolution.**

---

### C-03: Version parameter on `GET /skills/:id`, `/execute`, `/validate` — RESOLVED

**Status: Resolved.**

- `GET /skills/:id` now accepts an optional `version` integer query param (line 290). The "latest" behavior (descending sort, Limit 1) is documented.
- `GET /skills/:id/versions` endpoint is fully defined (lines 317-368), with its own `SkillVersionSummary` schema and cursor-based pagination. The "latest = highest version_number" definition is explicit (line 356).
- `POST /execute` `ExecuteRequest` (lines 727-733) includes `version: z.number().int().positive().optional()`.
- `POST /validate/:skill_id` `ValidateRequest` (lines 852-856) includes `version: z.number().int().positive().optional()`.
- Both endpoints document "when omitted, uses latest version" behavior.

**Verdict: Clean resolution. All three sub-requirements met.**

---

### C-04: Semver string sort key — RESOLVED

**Status: Resolved.**

- `dynamo-schemas.md` line 81: Sort key is now `version_number` of type `N` (numeric auto-incrementing integer starting at 1).
- The design note (line 83) explicitly explains the rationale: "`N` type sorts numerically," with `version_label` (semver display string) stored as a regular non-key attribute.
- `api.md` `Skill` schema (lines 90-91):
  ```typescript
  version: z.number().int().positive(),
  version_label: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  ```
  The integer `version` maps to `version_number` (DynamoDB SK); `version_label` is the display semver.
- `GET /skills/:id/versions` line 356: "Because `version_number` is a DynamoDB numeric sort key (`N`), descending sort is exact and correct (numeric ordering, not lexicographic)." This closes the issue precisely.

**Verdict: Clean resolution. Numeric SK is the right approach.**

---

### C-05: Missing `canonical_skill_id` and `skill_count` from Problem schema — RESOLVED

**Status: Resolved.**

- `api.md` `Problem` schema (lines 121-122):
  ```typescript
  canonical_skill_id: z.string().uuid().nullable(),
  skill_count: z.number().int().nonnegative(),
  ```
  Both fields are now present.
- `GET /problems/:id` response (lines 601-605): `problem: Problem` inherits both fields. The separate `skill_count` top-level field that appeared in the old response is now part of `Problem` itself — the response still exposes `skill_count` at the top level via the `Problem` type. This is consistent.
- `dynamo-schemas.md` line 38-39 has had these fields all along; api.md now matches.

**Verdict: Clean resolution.**

---

### C-06: `POST /skills` does not increment `skill_count` — RESOLVED

**Status: Resolved.**

- `api.md` `POST /skills` side effects (line 270): "DynamoDB write (Problems table): Increments `skill_count` on the referenced problem."
- `dynamo-schemas.md` cross-table summary (line 287): "`POST /skills` — UpdateItem (increment `skill_count`)" in the codevolve-problems column.
- Both specs are now aligned on this side effect.

**Verdict: Clean resolution.**

---

## 3. Non-Critical Issue Verification

| ID | Issue | Status |
|----|-------|--------|
| N-01 | `version` param missing on `/execute` and `/validate` | **Resolved** (subsumed by C-03 fix) |
| N-02 | `sort_by` options don't map to GSIs | **Resolved** — api.md now restricts `sort_by` to `confidence` only in Phase 1, with an explicit `400 UNSUPPORTED_SORT_KEY` for other values (line 392) |
| N-03 | Default version `0.1.0` (api.md) vs `1.0.0` (dynamo-schemas.md) | **Resolved** — dynamo-schemas.md line 83 now reads "version_label defaults to `'0.1.0'`". Both specs agree on `0.1.0`. |
| N-04 | Conflict detection on `(problem_id, name, language, version)` — no supporting GSI | **Resolved** — api.md Errors table for `POST /skills` (line 265) now reads "Skill with same `skill_id` + `version` already exists (PK uniqueness)." The constraint is now what DynamoDB naturally enforces. |
| N-05 | SQS reference in `/evolve` contradicts ADR-001 | **Resolved** — `POST /evolve` side effects (line 1195) now read "Emits evolve request to `codevolve-events` Kinesis stream." SQS reference is gone. |
| N-06 | Evolve job record references non-existent table | **Resolved** — api.md `POST /evolve` Phase 4 note (line 1183) explicitly defers the `codevolve-evolve-jobs` table to Phase 4. `dynamo-schemas.md` Section "Phase 4 — Future Tables" (line 331) documents the deferred table with rationale. The `/evolve` response no longer includes a `poll_url`. |
| N-07 | `examples` missing from Problem API schema | **Resolved** — `Problem` schema (lines 117-120) now includes `examples: z.array(...).optional().default([])`. |
| N-08 | Cache write policy inconsistency | **Resolved** — api.md `POST /execute` side effects (line 765) now reads "Only when the Decision Engine has flagged this skill for caching." dynamo-schemas.md cache table (line 198) uses identical language. Both specs agree on cache-on-demand. |
| N-09 | Rate limits not defined | **Resolved** — api.md now has a full Rate Limits section (lines 190-204) with per-endpoint limits. |
| N-10 | No `GET /problems` list endpoint | **Resolved** — `GET /problems` is now fully defined (lines 621-657) with domain/difficulty/status filters and cursor-based pagination. |

**All ten non-critical issues from REVIEW-01 are resolved.**

---

## 4. New Issues Introduced

### N-NEW-01: Cache table `skill_version` field stores semver string but skills table now uses integer `version_number`

**Severity: Medium**
**File: dynamo-schemas.md, line 179**

The `codevolve-cache` table has a `skill_version` attribute of type `S` described as "Semver of the skill version that produced this result." Now that the canonical version identifier is `version_number` (N, integer), this field is inconsistent. The cache key is `(skill_id, input_hash)`, not `(skill_id, version_number, input_hash)` — so the version stored on a cache entry is for informational/invalidation use only. However, the cache invalidation rule (dynamo-schemas.md line 223) says: "all cache entries for that `skill_id` with a different `skill_version` are invalidated." If `skill_version` stores a semver string (`"0.1.0"`) but the skills table uses integer version numbers, the stream consumer must translate between the two, which is fragile.

**Recommendation**: Change `skill_version` in the cache table from a semver string to a `version_number` integer (`N` type). This makes the invalidation logic straightforward: compare `skill_version` (now stored as the integer `version_number`) to the current version and delete if different. No type translation needed. This can be fixed before IMPL-02 — it does not block IMPL-01.

---

### N-NEW-02: `status_distribution` in `skill-quality` dashboard omits `"archived"` from enum

**Severity: Low**
**File: api.md, lines 1051-1056**

The `status_distribution` object in `SkillQualityData` enumerates `unsolved`, `partial`, `verified`, `optimized` — but not `archived`. Now that `"archived"` is a valid `SkillStatus`, the analytics dashboard will silently miss archived skill counts in the distribution.

This is not a blocking issue (the dashboard is Phase 3), but it should be added for consistency. If the intent is to exclude archived skills from the quality dashboard, that policy should be documented.

**Recommendation**: Either add `archived: z.number().int()` to `status_distribution`, or add a comment explicitly stating that archived skills are excluded from the skill-quality dashboard.

---

## 5. Observations Carried Forward

The following REVIEW-01 observations remain unresolved, as expected (they are not blocking):

- **O-01** (embedding load cost at scale) — still valid. No mitigation added, but ADR-004 migration trigger at p95 > 100ms stands.
- **O-02** (DynamoDB Streams vs direct Kinesis — potential duplicate events) — still valid. Not resolved, but the stream consumer / direct emit split is mentioned in dynamo-schemas.md §2 (stream consumer) and api.md (handler-level Kinesis). A clear written policy (O-02's recommendation) would help Ada implement correctly. Recommend Jorven add one note before IMPL-02.
- **O-03** (promote-canonical race condition via TransactWriteItems) — still valid. The API spec does not specify a transaction or condition expression. This should be addressed in ARCH-02 or during IMPL-13.
- **O-07** (auth mechanism undefined) — still valid and expected at this phase. Auth is deferred.

---

## 6. Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. The revised specs are readable and precise. The `version_number` (N) / `version_label` (S) split is idiomatic for DynamoDB versioning. The cursor-based pagination section is clear and correctly explains the DynamoDB constraint. The `status: "archived"` unification is clean throughout. Names are accurate and consistent between the two documents.

**2. Is there a simpler solution?**

No simpler solution is needed for the core fixes. The `version_number` integer approach is the standard DynamoDB pattern for this use case, and the cursor-based pagination is the minimum viable correct approach. The `/evolve` Phase 4 deferral is the right pragmatic choice.

**3. Are there unintended side effects?**

One: the `skill_version` semver string in the cache table (N-NEW-01) is now type-mismatched against the integer-based version system. This could cause a silent bug in cache invalidation logic during IMPL-06 if not caught.

**4. Are edge cases handled?**

- Archived skill returned by `GET /skills/:id`: documented (line 309, "status field will be `'archived'`"). Correct.
- Archive on already-archived skill: `409 CONFLICT` documented (line 489). Correct.
- Unarchive on non-archived skill: `409 CONFLICT` documented (line 529). Correct.
- Empty test array on `/validate`: `422 PRECONDITION_FAILED` (line 904). Correct.
- No match from `/resolve`: explicit empty-result contract (line 711). Correct.
- `confidence` undefined / NaN: Zod schemas use `.min(0).max(1)` throughout. NaN is not a valid number in Zod — input validation would reject it.
- Version not found on `GET /skills/:id?version=N`: `404 NOT_FOUND` documented (line 307). Correct.

**5. Does the change follow the architectural plan?**

Yes. Analytics events go to Kinesis, never DynamoDB (explicitly stated in `POST /events` side effects, line 961-962). No LLM calls exist outside `POST /evolve` (which is in `src/evolve/`). The `/resolve` path uses DynamoDB + client-side cosine similarity per ADR-004. The Problem and Skill table structures match CLAUDE.md's core data models.

---

## 7. Security Check

These specs are design documents, not implementation. Security enforcement falls on implementation review (REVIEW-03 and later). However, the following spec-level observations apply:

- **Input validation**: Zod schemas are defined for every endpoint. All required fields have explicit types, min/max constraints, and regex patterns where relevant. Pass.
- **DynamoDB safety**: All access patterns use key-based operations (GetItem, Query, UpdateItem with PK/SK). No scan-based patterns are specified for user-facing endpoints. FilterExpressions on GSIs are documented as parameterized patterns. Pass.
- **Sandbox integrity**: Not yet applicable at spec stage (sandbox design is ARCH-06).
- **Error response safety**: Error shapes use machine-readable codes and human messages. No schema mentions stack traces in responses — the `422 EXECUTION_FAILED` error (line 759) allows `details` to contain "error message and stack trace," which is a potential information leak in production. Flagged as a concern for REVIEW-06 when `/execute` is implemented.

---

## 8. Issues Summary

| ID | Severity | Summary | Blocks |
|----|----------|---------|--------|
| N-NEW-01 | Medium | Cache table `skill_version` is semver string; skills table now uses integer `version_number` | IMPL-06 (not IMPL-01) |
| N-NEW-02 | Low | `status_distribution` omits `"archived"` status from skill-quality dashboard schema | IMPL-09 (Phase 3) |
| O-02 (open) | Low | DynamoDB Streams vs direct Kinesis emit policy not documented; potential duplicate events | IMPL-02, IMPL-03 |
| O-03 (open) | Low | promote-canonical race condition — no TransactWriteItems or ConditionExpression specified | IMPL-13 |

---

## 9. Verdict

**Approved. Ada may proceed with IMPL-01 (project scaffold).**

All six REVIEW-01 critical issues are resolved correctly. The two new issues (N-NEW-01, N-NEW-02) do not block scaffolding or IMPL-01. N-NEW-01 must be fixed in the spec before IMPL-02 begins, as it could cause a silent cache invalidation bug. O-02 (event duplication policy) should be clarified before IMPL-03.

---

*Reviewed by Iris — REVIEW-02 complete.*
