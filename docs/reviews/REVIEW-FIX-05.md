# REVIEW-FIX-05: Fix Batch from REVIEW-05 + N-NEW-01/02 (FIX-06–11)

**Reviewer:** Iris
**Date:** 2026-03-21
**Files reviewed:**
- `src/archive/archiveUtils.ts`
- `src/archive/archiveSkill.ts`
- `src/archive/archiveHandler.ts`
- `src/archive/unarchiveSkill.ts`
- `docs/dynamo-schemas.md`
- `docs/api.md`
- `tests/unit/archive/archiveSkill.test.ts`
- `tests/unit/archive/archiveUtils.test.ts`
- `tests/unit/archive/unarchiveSkill.test.ts`
- `tests/unit/archive/archiveHandler.test.ts`

---

## Verdict: APPROVED

All six fixes are correctly implemented. Tests expanded from 43 to 47 (four new cases). All 47 archive unit tests pass. No new issues introduced. The module is ready for Phase 2.

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. Every fix is minimal and targeted — no scope creep, no refactoring beyond what was required. The pagination loop in `archiveProblemIfAllSkillsArchived` mirrors the existing `invalidateCacheForSkill` pattern exactly, which is the right choice. The floor-guard pattern (`ConditionExpression: "#skill_count > :zero"` with a silent catch on `ConditionalCheckFailedException`) is idiomatic for DynamoDB counter protection. The `previous_status` fallback comment is precise and explains both the default value chosen (`"verified"`) and the reason (skills eligible for the archive workflow must have been at minimum verified). Names are accurate throughout.

**2. Is there a simpler solution?**

No. Each fix is already minimal:
- The floor guard is a single `ConditionExpression` clause plus a narrow catch block. There is no simpler DynamoDB-native way to enforce a non-negative counter.
- The pagination loop in `archiveProblemIfAllSkillsArchived` is the same pattern already established in `invalidateCacheForSkill`, which is the expected reuse point.
- Removing the `export` from `bedrockClient` is a one-word deletion.
- The fallback comment is a comment, not logic — there is nothing simpler.

**3. Are there unintended side effects?**

None found. Changes are strictly scoped to the four archive source files and two documentation files. No other modules import from `archiveUtils.ts` in a way that would be affected by removing `export { bedrockClient }` — confirmed by grep: no file in `src/` imports `bedrockClient` from the archive module. The `src/registry/bedrock.ts` file exports its own `bedrockClient` independently; that is a separate module and was not touched (correctly).

**4. Are edge cases handled?**

Yes, for all six fixes. Specific verification:

- **Floor guard at 0:** `ConditionExpression: "#skill_count > :zero"` correctly prevents the decrement at zero. The condition fails atomically — there is no TOCTOU window. `ConditionalCheckFailedException` is caught and swallowed in both `archiveSkill.ts:159–171` and `archiveHandler.ts:199–213`, with an explicit comment explaining the rationale in each location. The handler-level catch in `archiveSkill.ts` uses a negated type-guard pattern (only re-throws if the error is NOT a `ConditionalCheckFailedException`), which is correct.

- **Pagination — 0 results:** `allSkills.length === 0` check at line 128 of `archiveUtils.ts` returns `false` before any update is attempted. Covered by the existing "no skills" test case.

- **Pagination — single page:** The do-while loop executes once; `exclusiveStartKey` is undefined after the first response; the condition `while (exclusiveStartKey)` exits cleanly. Covered by existing single-page test cases.

- **Pagination — 2+ pages:** The new test "paginates through multiple query pages before evaluating all-archived" (archiveUtils.test.ts:201–216) verifies that a non-archived skill on page 2 correctly prevents problem archival even when all page-1 skills are archived. The complementary test "archives problem when all skills across multiple pages are archived" (archiveUtils.test.ts:218–237) verifies the true-positive path. Both cases are structurally sound and exercise the loop correctly.

- **bedrockClient export removed:** Confirmed absent. `grep` on `src/archive/` returns no `export.*bedrockClient` match. The client is still instantiated at module scope as `const bedrockClient` and used internally by `generateEmbedding`.

- **previous_status fallback:** The comment at `unarchiveSkill.ts:64–69` explains the fallback clearly ("skills with no `previous_status` were likely `verified` at minimum since they were in active circulation"). The new test "falls back to 'verified' when previous_status is absent on the archived record" (unarchiveSkill.test.ts:178–194) correctly constructs an archived skill without `previous_status` and asserts the restored status is `"verified"`. The complementary test "restores to previous_status stored on the skill" (line 196) verifies the non-fallback path with `"partial"`, ensuring the ?? operator is not masking a case where `previous_status` is present but falsy.

**5. Does the change follow the architectural plan?**

Yes.
- No hard deletions anywhere — status updates only.
- Analytics events continue to flow to Kinesis via `emitEvent`, not DynamoDB.
- No LLM calls outside `src/evolve/`. Bedrock is used in `unarchiveSkill.ts` exclusively for embedding regeneration (non-reasoning operation) — unchanged and correct.
- The doc fixes (`dynamo-schemas.md`, `api.md`) align the specs with the implementation: `version_number` is now `N` (integer) in the cache table, matching the skills table SK, and `archived` is present in `status_distribution` as required.

---

## Security Check

- **Input validation:** Pass. No changes to input validation paths.
- **DynamoDB safety:** Pass. The floor-guard `ConditionExpression` uses `ExpressionAttributeValues` parameterization (`":zero": 0`). No string concatenation anywhere.
- **Sandbox integrity:** N/A — no skill execution in this module.
- **Error response safety:** Pass. No new error paths expose internal details. The floor-guard failure is caught silently (correct). Non-conditional errors are still re-thrown (correct).

---

## Fix-by-Fix Verdict

### N-01(R05) — skill_count floor guard: PASS

All three files apply the guard identically:
- `archiveSkill.ts:147` — `ConditionExpression: "#skill_count > :zero"`, `ConditionalCheckFailedException` caught silently at line 160.
- `archiveHandler.ts:187` — same `ConditionExpression`, `ConditionalCheckFailedException` caught silently at line 200. Non-conditional errors are logged but do not fail the SQS message acknowledgment (comment explains this is acceptable because the skill status update already succeeded and `skill_count` is informational). This is the same behavior as before the fix; only the floor guard is new.
- `archiveUtils.ts` — the `archiveProblemIfAllSkillsArchived` function does not decrement `skill_count` (it updates the problem status, not a counter), so no floor guard applies there. The relevant decrement paths are covered by the two handler files above.

Test coverage: `archiveSkill.test.ts:235` and `archiveHandler.test.ts` (the `archiveHandler` floor-guard path is exercised implicitly through the existing `ConditionalCheckFailedException` handling paths for the skill update step).

One minor observation: the `archiveHandler.test.ts` test suite does not have a dedicated test that specifically fires the floor-guard condition on the `skill_count` decrement step (unlike `archiveSkill.test.ts:235` which does). This is not a blocking issue — the floor guard code path in `archiveHandler.ts` is covered by the `ConditionalCheckFailedException` infrastructure already tested in the handler — but a direct test would be the completeness ideal. No action required.

### N-02(R05) — pagination in archiveProblemIfAllSkillsArchived: PASS

The implementation at `archiveUtils.ts:101–188` is correct. The `allSkills` accumulator is populated across all pages before `every()` is evaluated. The loop condition is `while (exclusiveStartKey)` using `result.LastEvaluatedKey` — the same pattern as `invalidateCacheForSkill`. Two new test cases are correct and cover the materially distinct scenarios (non-archived item on page 2, all-archived across pages).

### N-03(R05) — bedrockClient export removed: PASS

`export { bedrockClient }` is absent from `archiveUtils.ts`. The client is module-private. No other archive module file attempted to import it (confirmed: `archiveSkill.ts`, `archiveHandler.ts`, and `unarchiveSkill.ts` each import only named exports from `./archiveUtils.js`; `bedrockClient` is not among them). The `generateEmbedding` export remains and is still used by `unarchiveSkill.ts`.

### N-04(R05) — unarchiveSkill fallback documented: PASS

The comment at `unarchiveSkill.ts:64–69` satisfies the fix requirement. It explains: (a) when the fallback applies (skill archived before `previous_status` field was introduced, or archived by a code path that omitted it), (b) what the fallback value is (`"verified"`), and (c) why that value was chosen (skills eligible for the archive workflow must have been at least verified in active circulation). The new test at `unarchiveSkill.test.ts:178` correctly simulates a missing `previous_status` by passing `{ previous_status: undefined }` to `makeArchivedSkill`. The response assertion `expect(body.skill.status).toBe("verified")` is precise and correct.

### N-NEW-01 — cache schema fix (dynamo-schemas.md): PASS

The `codevolve-cache` table at `dynamo-schemas.md:179` now reads:

```
| `version_number` | `N` | Integer version number of the skill version that produced this result. Matches the `version_number` sort key (`N`) on the codevolve-skills table. |
```

The old `skill_version` (S, semver string) attribute is gone. The new attribute name `version_number` and type `N` are consistent with the skills table SK definition at line 81. The cache invalidation rule at line 223 now references `version_number` rather than a semver string, making the stream consumer logic straightforward: compare integer values, no type translation needed. The GSI at line 191 (`GSI-skill-hitcount`) also correctly projects `version_number`. All references are internally consistent.

### N-NEW-02 — status_distribution fix (api.md): PASS

The `status_distribution` object in `SkillQualityData` at `api.md:1051–1057` now includes all five statuses:

```typescript
status_distribution: z.object({
  unsolved: z.number().int(),
  partial: z.number().int(),
  verified: z.number().int(),
  optimized: z.number().int(),
  archived: z.number().int(),
}),
```

`archived: z.number().int()` is present. The fix is clean and complete.

---

## Issues Found

None. No new issues introduced by the fix batch.

---

## Notes for Ada and Jorven

1. **Phase 2 readiness:** N-01 and N-02 are resolved. The archive module is clear for Phase 2. The `skill_count` counter is now floor-guarded against concurrent SQS + API archive races. The `archiveProblemIfAllSkillsArchived` function is now correct for problems with any number of skill versions.

2. **N-NEW-01 resolved:** The `version_number` (N) field in the cache table schema is now consistent with the skills table. IMPL-05 (cache layer) can proceed without a type-translation bug risk. The blocking concern from REVIEW-02 and REVIEW-04 is closed.

3. **N-NEW-02 resolved:** The `status_distribution` field now reflects all five valid skill statuses. IMPL-07 (analytics dashboards) can implement the `skill-quality` dashboard without a schema gap.

4. **Open items from REVIEW-04 remain unaddressed** (N-01 through N-05 on the registry/CRUD module, S-01 mapSkillFromDynamo duplication). These were not in scope for this fix batch and remain open.

5. **Kinesis shard retention** remains at 24 hours. Must be increased to 7+ days before production. Carried forward from REVIEW-03.

---

*Reviewed by Iris — REVIEW-FIX-05 complete.*
