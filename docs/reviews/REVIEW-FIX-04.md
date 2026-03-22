# REVIEW-FIX-04: Fix Batch from REVIEW-04 (FIX-01–05)

**Reviewer:** Iris
**Date:** 2026-03-21
**Scope:** FIX-01 (N-01) through FIX-05 (N-05) — five non-critical fixes identified in REVIEW-04
**Test run:** 21 tests, 2 suites — all pass

---

## Iris Review — FIX-01–05

### Verdict: APPROVED

All five fixes are correctly implemented. No new issues were introduced. The test run is clean.

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. Each fix is minimal and precisely scoped to the issue identified. The conditional-put comment in `createProblem.ts` is unusually thorough and accurate. The `emitEvents.ts` comment block explains the design tradeoff clearly and will save the next reader from questioning the duplicate client. Names and logic are unchanged from the pre-fix baseline; no unnecessary refactoring was introduced.

**2. Is there a simpler solution?**

No. Each fix is already as simple as it can be. N-01 is a one-line mapper addition. N-02 is a scan removal with a conditional-put replacement. N-03 is a structural ternary that places `Limit` only on the unfiltered branch. N-04 is a dead-code deletion. N-05 is a comment block. None of these could be simplified further without losing correctness or clarity.

**3. Are there unintended side effects?**

None found. The changes are confined to the five targeted files and affect no other Lambda handlers, DynamoDB tables, or shared utilities. The scan removal in `createProblem.ts` does not affect any other handler's behaviour. The `listSkills.ts` restructuring does not alter the GSI query paths (`problem_id` and `language` branches) — only the fallback scan branch changed.

**4. Are edge cases handled?**

Yes, for each fix:
- N-01: `examples` defaults to `[]` when absent from the DynamoDB item (`?? []`). Both cases (absent and present) are now covered by tests.
- N-02: `ConditionalCheckFailedException` is caught and mapped to 409. The 409 path is covered by a test. The comment is accurate that UUID collision is the only trigger for this condition (name-uniqueness via GSI is deferred to Phase 2, and the comment documents this limitation explicitly).
- N-03: When a filter expression is present, `Limit` is absent from the `ScanCommand` call entirely. When no filter is present, `Limit` is applied. `ExclusiveStartKey` is preserved in both branches, so cursor pagination continues to function correctly on the unfiltered path.
- N-04: Dead code removed cleanly; no remnant of the pop pattern exists.
- N-05: No behavioural change — comment only.

**5. Does the change follow the architectural plan?**

Yes. No LLM calls introduced. No analytics events written to DynamoDB. No new Lambda handlers without tests. The conditional-put in `createProblem.ts` uses a parameterized `ConditionExpression`, not string concatenation. The `emitEvents.ts` intentional-throw contract is consistent with the architectural note in REVIEW-04 that a dedicated event-submission endpoint should surface Kinesis failures rather than silently drop them.

---

## Security Check

- **Input validation:** Pass — unchanged; all handlers continue to validate with Zod before any DynamoDB call.
- **DynamoDB safety:** Pass — the scan removal eliminates the only scan in `createProblem.ts`. The remaining scan path in `listSkills.ts` still uses parameterized expressions.
- **Sandbox integrity:** N/A — no skill execution in scope.
- **Error response safety:** Pass — the 409 response in `createProblem.ts` (`"Problem with id already exists"`) does not leak the table name or internal key structure.

---

## Fix-by-Fix Assessment

### N-01 — `mapProblemFromDynamo` missing `examples` field

**Pass.**

`listProblems.ts` line 167: `examples: (item.examples as Problem["examples"]) ?? []` is present and correct. The `Problem` interface in `src/shared/types.ts` line 112 declares `examples: SkillExample[]` (required, not optional), consistent with the `default([])` in the Zod schema. The mapper satisfies the type contract.

Two new tests are present and meaningful:
- "should include examples field in mapped problem (defaults to empty array)" — covers the absent-in-DynamoDB case.
- "should include examples field when problem has examples" — covers the populated case with a realistic payload.

The `createProblem.test.ts` also adds "should include examples field defaulting to empty array" to confirm the 201 response includes `examples: []`, which is correct since `createProblem.ts` hard-codes `examples: []` on creation.

No issues.

---

### N-02 — `createProblem` TOCTOU scan replaced with conditional put

**Pass.**

The `ScanCommand` import and the pre-check scan block are gone. The `PutCommand` now carries `ConditionExpression: "attribute_not_exists(problem_id)"`. The catch block correctly identifies `ConditionalCheckFailedException` by `err.name` and returns a 409.

The file-level comment accurately documents the known limitation: name-uniqueness enforcement still requires a GSI and the fix does not claim to solve that. The comment is appropriately scoped — it acknowledges the TOCTOU exposure for concurrent same-name requests without overstating what the conditional put provides (it guards only against UUID key collision, not name collision). This is honest and correct.

One minor observation, not a blocker: the 409 message `"Problem with id already exists"` is technically accurate for a UUID collision scenario, but if a GSI-based name check is added in Phase 2 and also uses a conditional expression, callers will receive the same 409 code with a different message. This is acceptable and consistent with the existing pattern; the message is not part of the machine-readable contract (the `code: "CONFLICT"` field is).

The test covers the 409 case via a mock that throws `ConditionalCheckFailedException`.

No issues.

---

### N-03 — `listSkills` scan path omits `Limit` when filter expression is active

**Pass.**

The scan branch (lines 225–246) now uses a ternary that is structurally clean:
- If `filterExpression` is defined: emit `FilterExpression`, `ExpressionAttributeValues`, and (conditionally) `ExpressionAttributeNames`. `Limit` is absent.
- If `filterExpression` is undefined: emit only `Limit: params.limit`.

`ExclusiveStartKey` is spread outside the ternary and applies to both branches — pagination cursor is preserved correctly.

One nuance worth noting: when `filterExpression` is undefined, the `include_archived` default (`false`) always pushes `#sk_status <> :archived_status` into `filterParts`. In practice, this means `filterExpression` is never undefined in the scan path (there is always at least the status exclusion filter), so `Limit` will in practice never be passed to the unfiltered branch. This is correct behaviour — the comment at line 220–224 accurately describes the intent. It is not a bug; the `else { Limit: params.limit }` arm is a correct defensive fallback for a hypothetical future where `include_archived=true` is combined with no other filters and `filterExpression` becomes undefined. That path would still work correctly.

No new tests were added for this fix, which is acceptable — the N-03 issue in REVIEW-04 was documented as "no immediate fix required" with a documentation note. The structural fix is observable via code inspection. A test verifying that `ScanCommand` is called without `Limit` when a filter is active would be ideal but is not required for approval given the low-risk nature of the change.

No issues.

---

### N-04 — Dead code removed from `listSkills.ts` free-text search filter

**Pass.**

The `q` block (lines 151–157) now contains only:
```
filterParts.push("(contains(#sk_name, :q) OR contains(description, :q))");
exprNames["#sk_name"] = "name";
exprValues[":q"] = params.q;
```

There is no push-then-pop pattern. No references to `#sk_name_lower`, `#sk_desc_lower`, or any intermediate expression that is discarded. The cleanup is complete.

No issues.

---

### N-05 — `emitEvents.ts` intentional-throw contract documented

**Pass.**

The comment block at lines 20–30 is accurate and complete. It explains two things clearly:
1. Why the fire-and-forget wrappers are intentionally bypassed (Kinesis failure must surface as 500 here, not be silently dropped).
2. Why a dedicated `KinesisClient` is constructed rather than importing the singleton (self-containment; avoids importing the shared wrapper only to bypass it).

The comment is well-calibrated — it explains the reasoning without over-explaining. A future reader encountering this code will immediately understand the design decision rather than treating the duplicate client as a bug. The `EVENTS_STREAM` constant duplication (also mentioned in REVIEW-04 N-05) remains but was correctly identified as a minor DRY concern that does not affect correctness.

No issues.

---

## Issues Found

None. All five fixes are correctly implemented.

---

## Notes

- The `Limit`-omission approach in N-03 resolves the short-page symptom but introduces a full-table scan risk for the filtered fallback path. This was acknowledged in REVIEW-04 as a known Phase 1 limitation. It remains an open concern for Phase 2 when the Skills table grows — at that point a GSI or OpenSearch (per ADR-004) will be needed to bound scan cost. No action required now.
- The open items from REVIEW-04 that were not part of this fix batch (N-NEW-01, N-NEW-02, O-03, S-01 through S-03) remain open and are unchanged by these fixes.
- Test count: 21 tests across 2 suites, all pass. No regressions introduced.
