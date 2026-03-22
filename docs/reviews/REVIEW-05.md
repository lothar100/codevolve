# REVIEW-05: IMPL-04 (Archive Mechanism)

**Reviewer:** Iris
**Date:** 2026-03-21
**Files reviewed:**
- `src/archive/archiveHandler.ts`
- `src/archive/archiveSkill.ts`
- `src/archive/unarchiveSkill.ts`
- `src/archive/archiveUtils.ts`
- `infra/codevolve-stack.ts`
- `src/shared/emitEvent.ts` (reference)
- `src/shared/kinesis.ts` (reference)
- `tests/unit/archive/archiveHandler.test.ts`
- `tests/unit/archive/archiveSkill.test.ts`
- `tests/unit/archive/unarchiveSkill.test.ts`
- `tests/unit/archive/archiveUtils.test.ts`

---

## Verdict: APPROVED WITH NOTES

The archive mechanism is well-structured and demonstrates strong attention to the properties that matter most in this module: no hard deletions, idempotency, canonical skill protection, correct event routing, and condition-expression-guarded writes. The previous REVIEW-03 warnings W-01 and W-03 are both resolved. All 43 archive unit tests pass. There are no blocking critical issues. Four non-critical issues and two suggestions are noted below.

---

## Summary

IMPL-04 delivers a three-surface archive system: an API handler for manual archive (`archiveSkill.ts`), an API handler for manual unarchive (`unarchiveSkill.ts`), and an SQS-triggered handler for automated Decision Engine messages (`archiveHandler.ts`), with shared logic in `archiveUtils.ts`. Every path uses `emitEvent` from `../shared/emitEvent.js` — fire-and-forget, as required. DynamoDB writes use `ConditionExpression` throughout to prevent double-processing. The SQS handler correctly returns `batchItemFailures` so that only genuinely failed messages are retried. The CDK stack has a dead-letter queue with `maxReceiveCount: 3`, appropriate visibility timeout, and scoped Bedrock permission (unarchive only). The `archiveHandlerFn` no longer carries the spurious Bedrock permission from REVIEW-03 W-03.

The issues found are all non-critical, but two (N-01, N-02) carry meaningful data-integrity risk and should be fixed before Phase 2 work touches the archive module.

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. Code is readable without excessive comments. Names are accurate (`processArchiveMessage`, `invalidateCacheForSkill`, `archiveProblemIfAllSkillsArchived`). The sequential steps within each handler are numbered and labeled clearly. The race condition handling in `archiveHandler.ts` (read → conditional write → re-query on `ConditionalCheckFailedException`) is explicit and correct. No unnecessary cleverness.

**2. Is there a simpler solution?**

No meaningful simplification exists. The archive flow is inherently multi-step (status update, cache invalidation, skill_count adjustment, audit record, event emission, problem auto-archive check). The shared `archiveUtils.ts` already factors out the repeated operations correctly. The conditional write + re-query pattern at `archiveHandler.ts:135-165` is the minimal safe implementation for this concurrency scenario.

**3. Are there unintended side effects?**

Two worth flagging:

- `archiveUtils.ts` exports `bedrockClient` at line 306 (`export { bedrockClient }`). This is unnecessary — the client is only needed internally by `generateEmbedding`. Exporting it creates an undocumented surface that callers could misuse. See N-03.
- The `skill_count` decrement in both `archiveSkill.ts` and `archiveHandler.ts` lacks a floor guard. If a bug causes double-archive followed by double-decrement (the condition expression prevents this in normal operation, but not across the API and SQS paths acting on the same skill concurrently), `skill_count` could go negative. DynamoDB allows negative numbers. See N-01.

**4. Are edge cases handled?**

Mostly yes. Specific gaps:

- **`archiveProblemIfAllSkillsArchived` is not paginated.** The single `QueryCommand` at `archiveUtils.ts:105-114` does not iterate `LastEvaluatedKey`. For a problem with more than 1 MB of projected skill data (roughly 1,000+ skills per problem at typical item sizes), the query silently returns a partial result page, `every()` sees only the first page, and the problem could be incorrectly auto-archived when non-archived skills exist on later pages. See N-02.
- **`previous_status` fallback in `unarchiveSkill.ts:64`.** If a skill is archived but has no `previous_status` attribute (e.g., data pre-dates this field, or was archived by a different code path), the fallback is `"verified"`. This is documented in the code but could silently restore a skill to the wrong status. See N-04.
- `is_canonical` is not restored on unarchive. This is correct by design — canonical status should not be auto-restored — but there is no test or comment confirming this is intentional. See S-01.
- The `skill_count` decrement in `archiveHandler.ts:180-200` is silently swallowed on failure (`console.error`, no re-throw). This is explicitly noted in the comment at line 199 and is acceptable for a counter that is informational. No action needed.

**5. Does the change follow the architectural plan?**

Yes. No hard deletions anywhere — only `status` updates. Analytics events flow to Kinesis via `emitEvent.ts`, not to DynamoDB. No LLM calls anywhere in the archive module (Bedrock is used only for embedding vector generation, which is an embedding operation, not a reasoning operation). The SQS handler does not call OpenSearch, consistent with Phase 1 scope. The CDK stack grants only the tables each function legitimately needs.

---

## Security Check

- **Input validation:** Pass. Both API handlers validate the path parameter with a `zod` `z.string().uuid()` schema via the shared `validate()` helper before any DynamoDB access.
- **DynamoDB safety:** Pass. All writes use parameterized `ExpressionAttributeValues` and `ExpressionAttributeNames`. No string concatenation in query expressions.
- **Sandbox integrity:** N/A — no skill execution in this module.
- **Error response safety:** Pass. No stack traces, table names, or internal error structures are returned to API callers. The `archiveSkill` and `unarchiveSkill` handlers `throw err` for unexpected DynamoDB errors, which will surface as a 500 from API Gateway without leaking internal detail.

---

## REVIEW-03 Warnings Status

**W-01** — Archive module must import `emitEvent` from `../shared/emitEvent.js`, not `../shared/kinesis.js`.
**Status: RESOLVED.** All four archive files import from `../shared/emitEvent.js`. Confirmed at `archiveHandler.ts:12`, `archiveSkill.ts:15`, `unarchiveSkill.ts:15`, `archiveUtils.ts:25`.

**W-02** — `healthFn` over-granted (ReadWriteData on all tables + Kinesis Write).
**Status: RESOLVED.** The stack at `infra/codevolve-stack.ts:580` has the comment "healthFn needs no DynamoDB or Kinesis access — it returns a static response" and grants no permissions to `healthFn`. The grant loop at line 584 only covers `registryFunctions`, which does not include `healthFn`.

**W-03** — `archiveHandlerFn` has unnecessary Bedrock permission.
**Status: RESOLVED.** The Bedrock `InvokeModel` permission at `infra/codevolve-stack.ts:610-617` is granted only to `unarchiveSkillFn`. `archiveHandlerFn` has no Bedrock permission. Confirmed.

---

## Critical Issues

None.

---

## Non-Critical Issues

**N-01** — `skill_count` decrement has no floor guard
**Files:** `src/archive/archiveSkill.ts:140-155`, `src/archive/archiveHandler.ts:180-200`
**Detail:** The `UpdateExpression` `SET #skill_count = #skill_count - :one` will produce a negative value if `skill_count` is already 0. This cannot happen in normal single-path operation (the condition expression prevents double-archive from the same path), but the API and SQS handler are independent paths that could race on the same skill if the Decision Engine sends a message concurrently with a manual API call. The skill-level condition expression prevents double status change, but the problem-level `skill_count` decrement has no condition guard (`ConditionExpression: "#skill_count > :zero"` or `MAX(#skill_count - :one, :zero)`).
**Required fix:** Add a `ConditionExpression` or use `max(skill_count - 1, 0)` semantics on the Problems table decrement, or document this as accepted risk with reasoning.

**N-02** — `archiveProblemIfAllSkillsArchived` does not paginate the skills query
**File:** `src/archive/archiveUtils.ts:101-114`
**Detail:** A single `QueryCommand` without `ExclusiveStartKey` loop is issued. DynamoDB returns at most 1 MB per page. A problem with many skill versions could have results spanning multiple pages. If non-archived skills exist on page 2+, the `every()` check at line 119 passes on the first page alone and incorrectly triggers problem archival. This is a data-correctness bug, not merely a theoretical concern, as the skills table uses `(skill_id, version_number)` as the primary key, and the GSI query is on `problem_id` — every version of every skill counts as a separate item.
**Required fix:** Wrap the query in a pagination loop over `LastEvaluatedKey`, accumulating all items before evaluating `every()`. The `invalidateCacheForSkill` function in the same file already demonstrates the correct pattern.

**N-03** — `bedrockClient` is unnecessarily exported from `archiveUtils.ts`
**File:** `src/archive/archiveUtils.ts:306`
**Detail:** `export { bedrockClient }` exposes the internal Bedrock client instance. No other module needs this export; it exists in none of the four handler files. Exporting an SDK client from a utility module allows callers to bypass `generateEmbedding` and make raw Bedrock calls, defeating the abstraction.
**Required fix:** Remove the export. Keep the client module-private.

**N-04** — `previous_status` fallback to `"verified"` in `unarchiveSkill.ts` is undocumented behavior
**File:** `src/archive/unarchiveSkill.ts:64`
**Detail:** `const previousStatus = (skill.previous_status as string) ?? "verified"` silently restores a skill to `"verified"` if the attribute is absent. Skills archived before this field was introduced, or archived by any code path that omitted it, would be silently upgraded in status on unarchive. There is no test covering this fallback path, and the comment does not explain why `"verified"` was chosen over `"unsolved"` or an explicit error.
**Required fix:** Either (a) return a 422 if `previous_status` is missing and require a `target_status` body parameter, or (b) keep the fallback but add a test that explicitly asserts the `"verified"` default and a comment explaining the rationale (e.g., skills with no `previous_status` were likely `verified` at minimum since they were in production rotation).

---

## Suggestions

**S-01** — Add a comment and test asserting that `is_canonical` is intentionally NOT restored on unarchive
**File:** `src/archive/unarchiveSkill.ts`
**Detail:** The unarchive update expression sets `#status = :restored_status` and `#embedding = :embedding` but does not restore `is_canonical`. This is architecturally correct (canonical promotion must be an explicit, confidence-verified act). However, the response object at line 184 echoes the stale pre-archive `is_canonical` value from the original query (`skill.is_canonical`), which is `false` for any archived skill that was demoted before archiving — so the response is accurate. Adding a comment and a test case ("unarchiving a skill does not restore canonical status") would make the intent explicit for future contributors.

**S-02** — `archiveHandler.ts` does not validate the SQS message shape with zod
**File:** `src/archive/archiveHandler.ts:38`
**Detail:** `JSON.parse(record.body)` casts directly to `ArchiveMessage` with no runtime validation. A malformed Decision Engine message (e.g., missing `skill_id`) would throw at the `const { skill_id } = message` destructure and be returned as a `batchItemFailure` for retry — which is safe behavior. However, a message that is valid JSON but has the wrong schema (e.g., wrong `action`, missing `problem_id`) would be retried indefinitely until DLQ. A `zod` parse before `processArchiveMessage` would catch these immediately and either DLQ or skip them deterministically. This is a quality improvement, not a hard rule violation, since the SQS source is internal and not a user-facing API input.

---

## Notes for Ada and Jorven

1. **Phase 2 readiness:** With N-01 and N-02 addressed, the archive module is safe for Phase 2. N-01 is a data-integrity edge case that requires concurrent SQS + API traffic on the same skill, which will not occur in Phase 1 seeding. N-02 is a correctness bug for problems with >~500 skill versions; given the current bootstrap target of ~100 problems, this will not trigger in practice either. Both should be fixed before the archive module is exercised under load.

2. **S-04 from REVIEW-03** (flagged for IMPL-02): `archive` and `unarchive` event types have been added to `EventTypeSchema` in `src/shared/validation.ts:23-30`. This item is resolved.

3. **OpenSearch removal on archive** is not implemented (the embedding field is nullified in DynamoDB, but no OpenSearch document deletion is issued). This is correct and expected — OpenSearch is not in scope until Phase 2 (>5K skills). No gap to flag at this phase.

4. **Kinesis shard retention** remains at 24 hours (`infra/codevolve-stack.ts:153`). This was flagged as an ongoing observation in REVIEW-03 and remains unresolved. Must be increased to 7+ days before production.
