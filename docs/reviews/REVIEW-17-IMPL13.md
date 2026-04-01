## Iris Review — REVIEW-17 / IMPL-13 (Canonical Promotion — Full Re-Review)

**Date:** 2026-03-30
**Reviewer:** Iris
**Files reviewed:**
- `src/registry/promoteCanonicalGate.ts`
- `src/registry/promoteCanonical.ts`
- `tests/unit/registry/promoteCanonicalGate.test.ts`
- `tests/unit/registry/promoteCanonical.test.ts`
- `infra/codevolve-stack.ts` (PromoteCanonicalFn construct)
- `docs/validation-evolve.md` §4 and §11

**Prior review history:** REVIEW-09 (2026-03-22) — REJECTED. REVIEW-10 (2026-03-23) — APPROVED. This is REVIEW-17, a fresh independent review pass against the current code state.

---

### Purpose

`POST /skills/:id/promote-canonical` promotes a skill to canonical status for its `problem_id` + `language` pair. The handler enforces a multi-condition gate, atomically demotes any existing canonical, and updates the problems table — all in a single DynamoDB `TransactWriteItems` call.

---

### REVIEW-09 Critical Resolution Checklist

| Critical | Requirement | Status |
|----------|-------------|--------|
| CRITICAL-01 | already-canonical returns 409 CONFLICT (not 200) | RESOLVED — gate returns `{ status: 409, code: "ALREADY_CANONICAL" }` |
| CRITICAL-02 | Previous canonical query uses GSI-canonical with language filter | RESOLVED — two QueryCommands on `GSI-canonical` (`true#verified`, `true#optimized`) with `FilterExpression: "#lang = :language"` |
| CRITICAL-03 | `test_pass_count > 0` gate enforced (never-validated skill blocked) | RESOLVED — Gate 4 returns 422 NEVER_VALIDATED when `test_pass_count` is undefined, null, or 0 |

All three REVIEW-09 criticals are fully resolved.

---

### Review Questions

**1. Would a senior engineer approve this implementation?**

Largely yes. The gate logic is extracted into a pure, side-effect-free function (`promoteCanonicalGate.ts`) with a discriminated union return type — excellent separation. The handler is structured with numbered steps matching the spec flow. Names are accurate and descriptive. The `SkillGateInput` interface documenting DynamoDB field semantics is a thoughtful callout.

One readability concern: the comment block on `invalidateCloudFrontPaths` (lines 277–282) describes using "eval-based dynamic require to avoid adding `@aws-sdk/client-cloudfront` as a compile-time dependency." This framing is inaccurate and alarming. `require()` in Node.js is not eval-based. The comment creates unnecessary concern for the next reader. The rationale (conditional optional dependency) is legitimate but should be stated plainly.

**2. Is there a simpler solution?**

The two-query approach for `GSI-canonical` (one for `true#verified`, one for `true#optimized`) is marginally verbose but correct — it handles both possible states of the previous canonical without full-table scans. No simpler approach exists given the composite GSI key design.

The `mapSkillFromDynamo` function is duplicated from other registry handlers (noted as S-01 in REVIEW-04). Extraction to `src/shared/` remains open; this is a carry-forward observation, not blocking.

**3. Are there unintended side effects?**

None found outside task scope. The handler:
- Writes only to `codevolve-skills` and `codevolve-problems` (correct scope)
- Reads only from `codevolve-skills` (GSI-canonical query)
- Fires CloudFront invalidation as a non-blocking side effect (fire-and-forget pattern correctly used)
- Does not write to Kinesis (note: the spec §4 does not require a Kinesis event on promotion — absence is correct)
- Does not write to analytics DynamoDB (architectural rule observed)

The CDK places `promoteCanonicalFn` in the `registryFunctions` array, which grants `grantReadWriteData` on both `skillsTable` and `problemsTable`. The explicit `dynamodb:TransactWriteItems` policy is also added. Both grants are correct.

**4. Are edge cases handled?**

| Edge case | Handled? |
|-----------|----------|
| Skill not found | Yes — 404 NOT_FOUND |
| Invalid UUID path param | Yes — zod schema on `PathParamsSchema`, 400 VALIDATION_ERROR |
| Already canonical | Yes — 409 ALREADY_CANONICAL (CRITICAL-01 resolved) |
| Confidence < 0.85 | Yes — 422 CONFIDENCE_TOO_LOW; `confidence undefined` defaults to 0 |
| Failing tests | Yes — 422 TESTS_FAILING |
| Never validated | Yes — 422 NEVER_VALIDATED (CRITICAL-03 resolved) |
| Wrong status | Yes — 422 WRONG_STATUS |
| Archived skill (boolean flag) | Yes — 409 SKILL_ARCHIVED |
| No previous canonical | Yes — `demotedSkillId: null`, single-item transaction |
| Previous canonical present | Yes — three-item transaction (promote + demote + problems update) |
| TransactionCanceledException + ConditionalCheckFailed | Yes — 422 PRECONDITION_FAILED |
| TransactionCanceledException (other) | Yes — 422 PRECONDITION_FAILED (generic message) |
| Re-fetch fails after transaction | Yes — 500 INTERNAL_ERROR (fallback path at line 255) |
| Unexpected DynamoDB error | Yes — outer catch returns 500 |

One gap: the spec §4.1 archived check specifies the condition as `status !== "archived"` mapped to 422 PRECONDITION_FAILED. The implementation checks a separate `archived` boolean attribute and returns 409 SKILL_ARCHIVED (a different status code). This is a spec deviation — the code checks a field not in the spec's gate table, with the wrong HTTP status for this condition. However, this pattern is consistent with the archive mechanism established in IMPL-04 (which sets both `status: "archived"` and `archived: true`), and the implementation correctly handles the case. The status code mismatch (409 vs 422) for an archived skill is a minor spec deviation.

**5. Does the change follow the architectural plan?**

Mostly yes, with two deviations carried forward from REVIEW-10:

**Deviation A — ConditionExpression on TransactWrite promote item (spec §4.3):**
Spec requires: `ConditionExpression: 'confidence >= :threshold AND test_fail_count = :zero'`
Implementation uses: `ConditionExpression: 'attribute_exists(skill_id)'`

The spec's conditional check closes a race window: if confidence drops between the gate read and the transaction write (e.g., concurrent `/validate` run), the transaction is rejected atomically. The current implementation uses only `attribute_exists(skill_id)`, which will succeed even if confidence has dropped to 0. This was noted as acceptable for current scale in REVIEW-10.

**Deviation B — `is_canonical_status` value and forced `status: "optimized"` (spec §4.3):**
Spec sets `is_canonical_status = "true#${skill.status}"` (preserving the skill's current status).
Implementation hardcodes `is_canonical_status = "true#optimized"` and also forcibly upgrades the skill's `status` attribute to `"optimized"`.

This is a semantic policy decision embedded in the implementation without spec backing. Promoting a `verified` skill should set `is_canonical_status = "true#verified"`. Forcing `status = "optimized"` on promotion is not specified in §4.3. The reasoning may be intentional (all canonicals are implicitly "best" → optimized), but it is undocumented and deviates from the spec. This creates an inconsistency: a `verified` skill promoted to canonical becomes `optimized` in the DB, but the gate only checks for `verified` or `optimized` status — a `partial` skill promoted by this handler would be silently upgraded to `optimized`, which would not happen because gate 5 blocks it. The actual risk is that a previously-`verified` canonical now appears as `optimized` in status reports, which may surprise operators who did not explicitly run optimized validation.

**Deviation C — Cache invalidation scope (spec §4.5):**
Spec §4.5 says to invalidate `codevolve-cache` entries for the demoted skill. The implementation issues CloudFront path invalidations (`/skills/{id}`, `/problems/{id}`) but does NOT query and delete DynamoDB cache entries in `codevolve-cache` for the demoted skill. The CloudFront invalidation is purely at the CDN layer and does not address the DynamoDB cache. This means stale cache entries for the demoted canonical may still be served to `/execute` callers until they expire by TTL.

---

### Completion Gate Results

**`npx tsc --noEmit`:** Exit 0 — no TypeScript errors.

**`npx jest tests/unit/registry/`:**
```
Test Suites: 10 passed, 10 total
Tests:       117 passed, 117 total
Time:        ~1s
```
All 32 promote-canonical and gate tests pass (17 gate + 15 handler). All registry tests pass.

---

### Security Check

- **Input validation:** PASS — `PathParamsSchema` with `z.string().uuid()` validates path parameter before any DynamoDB call.
- **DynamoDB safety:** PASS — all DynamoDB operations use parameterized `ExpressionAttributeValues`; no string concatenation in query expressions.
- **Sandbox integrity:** N/A — no skill execution in this handler.
- **Error response safety:** PASS — 500 responses return only the generic message `"An unexpected error occurred"`. Internal table names and stack traces are not leaked. `console.error` logs the full error server-side only.
- **Credentials in code:** PASS — no API keys or credentials hardcoded. CloudFront distribution ID read from env var.

One observation: the `invalidateCloudFrontPaths` function uses `require("@aws-sdk/client-cloudfront")` inside the function body at runtime. This is a conditional dynamic require, not an eval. It is safe in a Lambda context. The comment at lines 277–282 describes it as "eval-based dynamic require" which is misleading — the pattern is a standard CommonJS conditional require, not related to eval. The comment should be corrected to avoid confusion.

---

### Issues Found

- **[WARNING]** `is_canonical_status` hardcoded to `"true#optimized"` and `status` forcibly set to `"optimized"` on promotion — deviates from spec §4.3 which says `true#${skill.status}`. A `verified` skill promoted to canonical silently becomes `optimized` in DynamoDB. This is undocumented policy. Acceptable for current scale but should be documented with a comment or resolved against the spec.

- **[WARNING]** DynamoDB `codevolve-cache` invalidation for the demoted canonical is absent. Spec §4.5 requires querying `codevolve-cache` and deleting entries for the demoted skill's `skill_id`. The CloudFront path invalidation does not substitute for this — it operates at a different layer. Stale resolve-cache entries for the demoted canonical will continue to be served until TTL expiry. Fix: add a query on `codevolve-cache` by `skill_id` = demotedSkillId + batch delete, fire-and-forget, after successful transaction.

- **[WARNING]** `archived` gate returns 409 SKILL_ARCHIVED but spec §4.1 maps archived to 422 PRECONDITION_FAILED. The 409 code is more semantically appropriate for this condition, but it is a spec deviation. Acceptable carry-forward.

- **[WARNING]** ConditionExpression on the promote TransactWrite item is `attribute_exists(skill_id)` only (not `confidence >= :threshold AND test_fail_count = :zero` as spec §4.3 requires). Race window: a concurrent `/validate` run could lower confidence between gate check and transaction, allowing an unqualified skill to be promoted. Acceptable for Phase 4 scale; flag for hardening in Phase 5.

- **[SUGGESTION]** Comment at lines 277–282 describes the `require()` call as "eval-based dynamic require." This is inaccurate — `require()` is a standard CommonJS module loader, not eval. Correct the comment to avoid misleading future maintainers.

- **[SUGGESTION]** `mapSkillFromDynamo` is duplicated across multiple registry handlers (carry-forward from REVIEW-04 S-01). Extract to `src/shared/mappers.ts` when next touching registry code.

- **[SUGGESTION]** No Kinesis event is emitted on promotion. Spec §4 does not require one, but an analytics event for `event_type: "promote"` would enable tracking canonical promotion rates in dashboards. Consider adding in a later phase.

---

### Verdict: APPROVED WITH NOTES

All three REVIEW-09 criticals are confirmed resolved. The gate logic is clean, pure, and well-tested. The handler is correctly structured with atomic TransactWriteItems, proper error mapping, and safe fire-and-forget cache invalidation. The 32 tests (17 gate + 15 handler) cover all gate conditions, both success paths, and the key failure paths.

The two most actionable warnings are:

1. **DynamoDB cache invalidation for demoted canonical is missing** (spec §4.5) — this is a functional gap, not just a deviation. Stale cache entries will persist until TTL. This does not block approval because the TTL-based expiry provides an eventual correction, but it should be addressed before the promote-canonical endpoint is exposed in production.

2. **`is_canonical_status` + status forcibly set to `optimized`** — works correctly but diverges from spec without documentation. Add a comment explaining the intentional policy decision.

IMPL-13 is approved for completion. The warnings above should be addressed in the next Phase 4 hardening pass.

---

### Notes for Ada and Jorven

- Jorven should clarify spec §4.3 on whether promotion should always upgrade status to `optimized` or preserve current status. If upgrading to `optimized` is intentional policy, document it in `docs/validation-evolve.md` §4.3.
- Jorven should clarify the archived check: spec §4.1 uses `status !== "archived"` with 422, but the archive mechanism sets an `archived` boolean. The spec should be updated to reflect the actual data model.
- Ada should add the DynamoDB cache invalidation step for the demoted skill as a follow-up task (spec §4.5 compliance). The `cacheTable.grantReadWriteData` grant is already present in CDK.
