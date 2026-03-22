# REVIEW-04: IMPL-02 (CRUD API) + IMPL-03 (Event Emission)

**Reviewer:** Iris
**Date:** 2026-03-21
**Scope:** `src/registry/` (8 handlers), `src/shared/` (validation, types, dynamo, response, emitEvent, eventBuilders, kinesis), `src/analytics/emitEvents.ts`, all tests in `tests/unit/registry/` and `tests/unit/shared/`

---

## Verdict: APPROVED WITH NOTES

All hard rules are satisfied. No critical blockers were found. The implementation is correct, clean, and well-tested (128 tests, all passing). Three non-critical issues require attention before or during IMPL-04: a missing `examples` field in `mapProblemFromDynamo`, a `createProblem` uniqueness check that is susceptible to a TOCTOU race, and a minor pagination correctness flaw in the scan path of `listSkills`. A silent `q` search bug is also flagged. Prior-review open items N-NEW-01, N-NEW-02, and W-01 are addressed below.

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. All eight handlers follow the same clear structure: parse body, validate with Zod, execute DynamoDB operation(s), map to response shape. Names are accurate (`mapSkillFromDynamo`, `buildEmbeddingText`, `partitionKey`). The `emitEvent` / `kinesis` split with explicit `@internal` warnings is well-documented. The code is readable without superfluous commentary.

**2. Is there a simpler solution?**

The `mapSkillFromDynamo` function is duplicated verbatim across `getSkill.ts`, `getProblem.ts`, `listSkills.ts`, and `promoteCanonical.ts`. This is a `src/shared/` extraction opportunity. Not blocking, but the duplication means a field change will need to be made in four places.

**3. Are there unintended side effects?**

None found in IMPL-02/03 scope. The CRUD handlers do not touch `codevolve-cache` or `codevolve-archive`. `createSkill` correctly increments `skill_count` on the Problems table. `promoteCanonical` correctly updates `canonical_skill_id` on the Problems table. No analytics events are written to DynamoDB.

**4. Are edge cases handled?**

Mostly yes. Specific gaps:

- `mapProblemFromDynamo` in `listProblems.ts` does not include the `examples` field. The `Problem` schema in `docs/api.md` defines `examples` as `z.array(...).optional().default([])`, so it should be present in the response.
- The `q` (free-text search) filter in `listSkills.ts` pushes a filter expression onto `filterParts`, then immediately pops it and pushes a corrected version. This works at runtime but the dead code path (`filterParts.pop()`) is a maintenance hazard and signals that the logic was not fully resolved.
- `promoteCanonical` has a known TOCTOU race (flagged as O-03 in prior reviews) — the read-check-write is not atomic. No `TransactWriteItems` is used. This is an existing carry-forward observation; see O-03 in Notes.

**5. Does the change follow the architectural plan?**

Yes. All analytics events are routed through Kinesis (`emitEvent.ts` / `emitEvents.ts`). No LLM calls are present in any of the reviewed files. The `/events` handler writes nothing to DynamoDB. DynamoDB queries use parameterized expressions throughout. `promoteCanonical` correctly enforces `confidence >= 0.85`, `tests.length > 0`, and `status in [verified, optimized]` before setting `is_canonical = true`.

---

## Security Check

- **Input validation:** Pass — every handler validates inputs with Zod before any DynamoDB call. `emitEvents.ts` independently validates each event against `AnalyticsEventSchema`.
- **DynamoDB safety:** Pass — all expressions use parameterized `ExpressionAttributeValues`. No string concatenation in expression paths.
- **Sandbox integrity:** N/A — no skill execution in this scope.
- **Error response safety:** Pass — 500 responses return only `"An unexpected error occurred"`. Internal table names and stack traces are logged to CloudWatch only, not returned to callers.

---

## Critical Issues

None.

---

## Non-Critical Issues

**N-01 — `mapProblemFromDynamo` missing `examples` field**
File: `src/registry/listProblems.ts`, `mapProblemFromDynamo` function (line 156–172)

The `Problem` schema in `docs/api.md` declares `examples: z.array(...).optional().default([])`. The `mapProblemFromDynamo` helper in `listProblems.ts` does not include `examples` in the returned object, so every `GET /problems` response will be missing this field. The `mapProblemFromDynamo` in `getProblem.ts` does not exist — that handler uses the raw DynamoDB item spread — so `GET /problems/:id` includes `examples` correctly via the spread, but `GET /problems` does not.

Required fix: Add `examples: (item.examples as Problem["examples"]) ?? []` to `mapProblemFromDynamo` in `listProblems.ts`.

---

**N-02 — `createProblem` name-uniqueness check is a table scan with TOCTOU exposure**
File: `src/registry/createProblem.ts`, lines 35–43

The `POST /problems` handler checks name uniqueness via `ScanCommand` with a `FilterExpression`. This has two weaknesses:

1. **Race condition (TOCTOU):** Two concurrent requests with the same name can both pass the scan check before either writes, resulting in duplicate problem names. For a low-volume admin endpoint this is acceptable today, but the API contract promises `409 CONFLICT` on duplicate names and cannot currently guarantee it.
2. **Performance:** A full table scan on every problem creation will degrade as the Problems table grows.

The correct fix is to add a `name` GSI (or use a condition expression on a secondary uniqueness record keyed by name). This is a design issue that should be tracked and addressed before the Problems table is seeded with production data.

---

**N-03 — `listSkills` pagination is incorrect in the scan path when deduplication is active**
File: `src/registry/listSkills.ts`, lines 228–264

When no `language` or `problem_id` filter is supplied, the handler falls back to `ScanCommand` with `Limit: params.limit`. DynamoDB applies `Limit` to the number of items evaluated *before* filtering, not the number returned. Combined with the post-query deduplication step (keeping only the latest `version_number` per `skill_id`), a page of `limit=20` may yield significantly fewer than 20 items, and the `next_token` returned may not represent a meaningful "20 items seen" boundary. This is a known limitation of DynamoDB scan + filter patterns and is acceptable in Phase 1, but callers may receive unexpectedly short pages.

No immediate fix required; the behaviour should be documented in the API reference for the fallback scan case.

---

**N-04 — Dead code in `listSkills.ts` free-text search filter construction**
File: `src/registry/listSkills.ts`, lines 152–165

The `q` parameter block pushes a filter expression, then immediately calls `filterParts.pop()` and pushes a replacement. The pop-then-push pattern indicates the original expression was written, found to be wrong, and patched in place. The intermediate expression referencing `#sk_name_lower` and `#sk_desc_lower` attributes (which do not exist in DynamoDB) is built into memory even though it is immediately discarded. This is harmless but confusing.

Required fix: Remove the dead expression push and pop. Keep only the final `"(contains(#sk_name, :q) OR contains(description, :q))"` line.

---

**N-05 — `emitEvents.ts` (POST /events handler) creates its own `KinesisClient` instead of reusing the singleton from `emitEvent.ts`**
File: `src/analytics/emitEvents.ts`, lines 20–24

The `POST /events` Lambda handler constructs a new `KinesisClient` directly rather than importing the exported `kinesisClient` singleton from `src/shared/emitEvent.ts`. This creates a second client in the same Lambda process when both modules are loaded. It also bypasses the `emitEvent` / `emitEvents` fire-and-forget wrappers (the `POST /events` handler intentionally throws to return `500` on Kinesis failure, which is the correct behaviour for this endpoint). The duplication of stream name constant (`EVENTS_STREAM`) is a minor DRY concern.

Not blocking. If the `POST /events` handler's intentional-throw pattern is the design intent (it is appropriate for a dedicated event-submission endpoint), document the reason clearly in a comment so future readers understand why it is not using the fire-and-forget wrappers.

---

## Open Items from Prior Reviews

**N-NEW-01 — `skill_version` field in `codevolve-cache` table: semver string vs integer `version_number`**

Status: **Not addressed in IMPL-02/03.** The `codevolve-archive` DynamoDB schema (`docs/dynamo-schemas.md` §3) still defines `skill_version` as `S` (semver string). None of the IMPL-02/03 handlers write to the cache table, so this does not affect the current deliverable. However, the misalignment with the integer `version_number` sort key on the Skills table remains open. Must be resolved in IMPL-05 (cache layer) before any code reads or writes `skill_version` from `codevolve-cache`.

**N-NEW-02 — `status_distribution` in `skill-quality` dashboard omits `"archived"`**

Status: **Not addressed in IMPL-02/03.** The `SkillQualityData` schema in `docs/api.md` (line 1051–1056) still omits `archived` from `status_distribution`. No analytics/dashboard handler was implemented in this batch, so this remains dormant. Must be corrected in the `docs/api.md` schema before IMPL-07 (analytics dashboards) ships.

**W-01 — Archive module importing `emitEvent` from `kinesis.ts` (throws) instead of `emitEvent.ts` (fire-and-forget)**

Status: **RESOLVED.** All four archive module files (`archiveHandler.ts`, `archiveSkill.ts`, `unarchiveSkill.ts`, `archiveUtils.ts`) now correctly import `emitEvent` from `../shared/emitEvent.js`. The throwing import from `kinesis.ts` is no longer present in any production code path.

---

## Suggestions

**S-01 — Extract `mapSkillFromDynamo` to `src/shared/`**

The function is identical across `getSkill.ts`, `getProblem.ts`, `listSkills.ts`, and `promoteCanonical.ts`. Moving it to `src/shared/dynamo.ts` or a new `src/shared/mappers.ts` file would eliminate the duplication and make future field additions a single-point change.

**S-02 — `createProblem` response still includes `status` and `domain_primary` exclusion via destructuring**

The current approach (`const { domain_primary, status, ...problemResponse } = problem`) is correct but fragile: if a new internal field is added to the DynamoDB item, it will leak into the response unless the destructuring is updated. Consider an explicit allow-list mapper (like `mapProblemFromDynamo` in `listProblems.ts`) for consistency and safety.

**S-03 — `emitEvent.ts` exports `kinesisClient`**

`src/shared/emitEvent.ts` re-exports `kinesisClient` (line 129). This weakens the intended encapsulation: callers can bypass the fire-and-forget wrapper by calling `kinesisClient.send(...)` directly. Consider removing the re-export and keeping `kinesisClient` entirely internal. The only legitimate consumer of the raw client should be `kinesis.ts` (which is already `@internal`).

---

## Notes for Ada and Jorven

- **O-03 carry-forward (promoteCanonical race):** The promote-canonical handler reads the current canonical skill, conditionally demotes it, then promotes the new one — all in three separate DynamoDB operations with no transaction. If two concurrent promote-canonical calls race on the same `problem_id + language`, both could read "no existing canonical" and both would succeed, leaving two canonical skills. This is a Phase 2/3 concern (low traffic today), but should be addressed with `TransactWriteItems` before traffic scales. Tracked as O-03.
- **`POST /events` Kinesis failure returns 500:** This is correct and intentional for the dedicated event-submission endpoint. The fire-and-forget pattern in `emitEvent.ts` is only appropriate for side-effect emissions within other handlers, not for a handler whose sole purpose is event submission.
- **Test coverage:** All 128 tests pass. Coverage is meaningful — happy path, 400/404/409/422/500 paths, pagination, deduplication, and archive filtering are all exercised. The absence of tests for the `q` free-text search path is a minor gap (the dead-code pop makes this path suspicious) but not blocking.
