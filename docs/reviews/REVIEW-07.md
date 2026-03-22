# REVIEW-07: /execute Endpoint + Cache Layer

**Reviewer:** Iris
**Date:** 2026-03-21
**Tasks:** IMPL-06 (`src/execution/`), IMPL-07 (`src/cache/cache.ts`)
**Verdict:** Request Changes

---

## Summary

The implementation is structurally sound and covers the majority of the spec correctly. The code is readable, the fire-and-forget pattern is applied consistently, the sandbox isolation model is correct, and test coverage is thorough for the happy path. However, there are two critical issues that must be resolved before this can merge: the success response body is missing required fields (`input_hash` and `version`) that are specified in `docs/api.md`, and `504 EXECUTION_OOM` has not been added to `docs/api.md` as required by both the task brief and `docs/execution-sandbox.md` §8.6. A third critical issue exists in the CDK stack. There are also non-critical issues noted below.

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Mostly yes. The code is clean and well-organised. The error taxonomy map, the fire-and-forget pattern, the EMA latency formula, and the canonical JSON implementation are all correct and readable. The `classifyFunctionError` function is a reasonable approach to distinguishing timeout vs OOM from Lambda's `FunctionError` payloads. Names are accurate throughout.

One readability concern: `sanitizeStackTrace` is not exported, so the sanitize tests must mirror the implementation manually. The test file notes this with an explicit comment, which is acceptable for now, but the divergence risk is real.

**2. Is there a simpler solution?**

No for the main handler logic — the complexity matches the spec. The `classifyFunctionError` could be simplified by checking `errorMessage` first (most common case) before `errorType`, but this is a minor readability preference, not a simplification.

**3. Are there unintended side effects?**

None found. The `executeFn` IAM grants are correctly scoped: `skillsTable` read/write, `cacheTable` read/write, `eventsStream` write, `lambda:InvokeFunction` restricted to the two runner ARNs only. Runner Lambdas have no grants beyond their default execution role (CloudWatch Logs only).

**4. Are edge cases handled?**

Most are handled well. Specific gaps are noted in the Critical Issues section. Missing from tests: a test case for when `invokeRunner` itself throws (SDK-level network error vs a Lambda function error). This case is handled in the implementation but not tested.

**5. Does the change follow the architectural plan?**

Yes, with the critical gaps noted. No LLM calls anywhere in these files. Analytics events go to Kinesis only. Skill execution is always delegated to runner Lambdas — the `/execute` Lambda itself never runs user code. Cache writes are gated on `auto_cache`. The `execution_count` and latency updates are fire-and-forget.

---

## Security Check

- **Input validation:** Pass. Zod schema applied to request body before any logic executes. Skill input field validation (presence check) occurs before hash computation. Runner payload never includes credentials or internal paths beyond the implementation string and inputs.
- **DynamoDB safety:** Pass. All DynamoDB expressions use parameterized `ExpressionAttributeValues`. No string concatenation. Cache keys use skill UUIDs and SHA-256 hashes only.
- **Sandbox integrity:** Pass. User code is never evaluated in the `/execute` Lambda. All execution is delegated to isolated runner Lambdas. Runner Lambda IAM roles have no AWS service access. The Python runner uses `exec()` with an empty globals namespace. The Node runner uses `new Function()`.
- **Error response safety:** Pass. Stack traces are sanitized before inclusion in responses. Internal paths stripped, bootstrap frames removed, frame count capped at 5.

---

## Critical Issues

**[CRITICAL-01] Success response missing `input_hash` and `version` fields — contract violation**

File: `src/execution/execute.ts`, lines 344–350 (cache hit path) and 522–528 (cache miss path).

The `ExecuteResponse` schema in `docs/api.md` specifies:

```typescript
const ExecuteResponse = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().positive(),     // <-- missing
  outputs: z.record(z.unknown()),
  latency_ms: z.number().nonnegative(),
  cache_hit: z.boolean(),
  input_hash: z.string(),                   // <-- missing
  execution_id: z.string().uuid(),
});
```

Both the cache-hit return (line 344) and the cache-miss success return (line 522) omit `input_hash` and `version`. The `version` field should be `versionNumber` (already in scope). The `input_hash` field should be `inputHash` (already in scope). This is a breaking API contract violation. Callers that rely on these fields for tracing, cache validation, or version pinning will receive undefined.

Must fix both return statements before approval.

**[CRITICAL-02] `504 EXECUTION_OOM` not added to `docs/api.md`**

Per `docs/execution-sandbox.md` §8.6: "Ada must add `504 EXECUTION_OOM` to the `/execute` error table in `docs/api.md` as part of IMPL-06 delivery." The `/execute` error table in `docs/api.md` (line 755–759) currently lists only `400`, `404`, `408`, and `422`. There is no `504 EXECUTION_OOM` row. The ARCH-06 task entry in `tasks/todo.md` also flags this as an open item for Ada.

This is a spec-compliance requirement. The api.md contract is authoritative per the sandbox spec. Must be added before approval.

**[CRITICAL-03] CDK GSI `nonKeyAttributes` still references `skill_version` (old field name)**

File: `infra/codevolve-stack.ts`, line 106.

```typescript
nonKeyAttributes: ["input_hash", "skill_version", "last_hit_at"],
```

The `skill_version` field was renamed to `version_number` (N, integer) in FIX-10, which updated `docs/dynamo-schemas.md`. The CDK stack was not updated to reflect this. At deploy time, `GSI-skill-hitcount` will project the non-existent `skill_version` attribute instead of `version_number`. Any GSI query expecting `version_number` in the projection will return items without it. The fix is to replace `"skill_version"` with `"version_number"` in the `nonKeyAttributes` array.

---

## Non-Critical Issues

**[WARNING-01] OOM detection misses the `errorMessage` pattern in `classifyFunctionError`**

File: `src/execution/execute.ts`, lines 170–178.

The OOM pattern requires:
```typescript
errorType === "Runtime.ExitError" && parsed.signal === "killed"
```

However, according to the spec (§4): "The response body contains `{"errorMessage":"Runtime exited with error: signal: killed","errorType":"Runtime.ExitError"}`." The `signal` field is embedded in the `errorMessage` string, not as a separate top-level `signal` key. The condition `parsed.signal === "killed"` will never match because `signal` is not a top-level field in Lambda's OOM error payload. The secondary check `errorMessage && /out of memory/i.test(errorMessage)` provides partial coverage but would miss the canonical OOM pattern from Lambda.

The correct check should inspect `errorMessage` for `"signal: killed"` (or `"Runtime.ExitError"` alone, since Lambda only emits that `errorType` for OOM/crash exits). This is non-critical because the runner can also return `error_type: "oom"` at the application level, which is correctly handled. But the Lambda-level OOM detection is subtly broken for the most common Lambda OOM error shape.

**[WARNING-02] `getCachedOutput` does not propagate errors to the caller — inconsistent contract**

File: `src/cache/cache.ts`, line 63.

`getCachedOutput` throws on DynamoDB errors (no try/catch). The call site in `execute.ts` wraps it in try/catch (line 316–319) and degrades gracefully on failure. This is correct behaviour, but the `writeCachedOutput` JSDoc comment says "Throws on DynamoDB errors — callers may fire-and-forget but errors propagate." This inconsistency across the cache module's three functions is confusing. `getCachedOutput` throws (caller handles), `incrementCacheHit` swallows (never throws), `writeCachedOutput` throws (caller fire-and-forgets). This is workable but could mislead the next developer. A clarifying comment on `getCachedOutput` noting its throw contract would help.

**[WARNING-03] `CACHE_TABLE_NAME` env var is not plumbed consistently in CDK**

File: `infra/codevolve-stack.ts`, line 381.

`ExecuteFn` sets `CACHE_TABLE_NAME: this.cacheTable.tableName` in its environment. However `src/cache/cache.ts` reads `process.env.CACHE_TABLE_NAME ?? "codevolve-cache"`. The env var name in CDK (`CACHE_TABLE_NAME`) matches the cache module, which is correct. However, the shared `lambdaEnvironment` object (line 163) sets `CACHE_TABLE: this.cacheTable.tableName` (without `_NAME`), while `ExecuteFn` overrides with `CACHE_TABLE_NAME`. Other Lambda functions that use `lambdaEnvironment` will have `CACHE_TABLE` set but not `CACHE_TABLE_NAME`. This is not a current bug (only `ExecuteFn` uses `src/cache/cache.ts`) but creates an inconsistency worth addressing when the cache module is referenced from other handlers.

**[SUGGESTION-01] `sanitizeStackTrace` is duplicated in the test file**

File: `tests/unit/execution/sanitize.test.ts`, lines 10–53.

The sanitizer is not exported from `execute.ts`, so the test file re-implements it manually. This is a known divergence risk — if the production implementation changes, the test mirror will silently drift. Consider exporting `sanitizeStackTrace` from a dedicated `src/execution/sanitize.ts` module and importing it in both the handler and the test. This is not blocking.

**[SUGGESTION-02] No test for SDK-level `invokeRunner` throw**

File: `tests/unit/execution/execute.test.ts`.

There is no test case for the scenario where `invokeRunner` itself throws an SDK-level exception (e.g., network error, Lambda throttling). The implementation handles this at lines 374–392 (returns 500 `INTERNAL_ERROR`). The spec lists 12 required test cases; the current 15 cases cover all specified scenarios. This would be a 16th case worth adding for completeness, but it is not blocking.

**[SUGGESTION-03] Node runner does not handle async `solve` functions**

File: `src/runners/node22/handler.js`, line 31.

`const result = fn(inputs)` does not `await` the result. If a skill implementation defines `async function solve(inputs) { ... }`, the runner will return a Promise object, which is not a plain object, so the type check `typeof result !== 'object' || result === null` will pass (Promises are objects), and the Promise will be returned as the output. The skill will appear to succeed but the output will be a serialised empty object `{}`. This is a silent failure mode. The spec does not explicitly forbid async `solve`, and the Python runner has no such issue since Python's `exec` is synchronous. Flagging for awareness. Not blocking IMPL-06 but should be addressed before the runner is used in production.

---

## Completion Gate Check

- [x] `tsc --noEmit`: exits 0
- [x] `jest tests/unit/execution/ tests/unit/cache/`: 45 tests, all pass (4 suites)
- [x] Runner Lambdas have no AWS service access (CDK confirms: no grants added to `runnerPython312Fn` or `runnerNode22Fn`)
- [x] Stack trace sanitization implemented and tested (7 test cases in `sanitize.test.ts`)
- [ ] `docs/api.md` updated with `504 EXECUTION_OOM` — **NOT DONE** (CRITICAL-02)
- [ ] `ExecuteResponse` includes `input_hash` and `version` fields — **NOT DONE** (CRITICAL-01)
- [ ] CDK `GSI-skill-hitcount` `nonKeyAttributes` corrected from `skill_version` to `version_number` — **NOT DONE** (CRITICAL-03)

---

## Notes for Ada

1. CRITICAL-01 and CRITICAL-02 can be resolved in parallel — they are in separate files.
2. CRITICAL-03 is a one-line CDK fix. Confirm the CDK change does not require table replacement (adding to `nonKeyAttributes` on an existing GSI is a destructive operation in DynamoDB — it requires deleting and recreating the GSI). Jorven should confirm the migration path for the deployed GSI before production deployment, but this does not block the code review approval gate.
3. Once CRITICAL-01, CRITICAL-02, CRITICAL-03 are fixed, re-run `npx tsc --noEmit` and `npx jest tests/unit/execution/ tests/unit/cache/` to confirm no regressions.
4. WARNING-01 (OOM detection) is worth fixing in the same PR to avoid a latent bug, even though it is non-critical today.

---

## Re-review: C-01/C-02/C-03/W-01/W-02/S-03

**Reviewer:** Iris
**Date:** 2026-03-21
**Scope:** Targeted verification of the six fixes applied after REVIEW-07 Request Changes verdict.

### Fix Verdicts

**C-01 — `src/execution/execute.ts`: Both success paths include `input_hash` and `version`**

Verified.

Cache-hit path (lines 343-351):
```typescript
return success(200, {
  skill_id: skillId,
  outputs: cachedOutput,
  cache_hit: true,
  latency_ms: latencyMs,
  execution_id: executionId,
  input_hash: inputHash,
  version: versionNumber,
});
```

Cache-miss path (lines 523-531):
```typescript
return success(200, {
  skill_id: skillId,
  outputs,
  cache_hit: false,
  latency_ms: latencyMs,
  execution_id: executionId,
  input_hash: inputHash,
  version: versionNumber,
});
```

Both `input_hash: inputHash` and `version: versionNumber` are present in both return statements. The `ExecuteResponse` contract in `docs/api.md` is now satisfied by both paths. Fix confirmed correct.

**C-02 — `docs/api.md`: `504 EXECUTION_OOM` row present in `/execute` error table**

Verified.

The error table now reads:

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | ... |
| 404 | `NOT_FOUND` | ... |
| 408 | `EXECUTION_TIMEOUT` | ... |
| 504 | `EXECUTION_OOM` | Runner Lambda killed by OOM. Skill implementation exceeded 512 MB memory limit. |
| 422 | `EXECUTION_FAILED` | ... |

The `504 EXECUTION_OOM` row is present at line 759, placed immediately after `408 EXECUTION_TIMEOUT`, before `422 EXECUTION_FAILED`. Placement and description are correct per `docs/execution-sandbox.md` §8.6.

**C-03 — `infra/codevolve-stack.ts`: `GSI-skill-hitcount` `nonKeyAttributes` contains `"version_number"` not `"skill_version"`**

Verified.

Line 106 now reads:
```typescript
nonKeyAttributes: ["input_hash", "version_number", "last_hit_at"],
```

The stale `"skill_version"` field name is gone. `"version_number"` matches the canonical field name established in FIX-10 (`docs/dynamo-schemas.md`) and the DynamoDB table sort key definition at line 53. Fix confirmed correct.

**W-01 — `src/execution/execute.ts`: OOM detection checks `errorType === "Runtime.ExitError"` OR `errorMessage` contains `"signal: killed"`**

Verified.

Lines 170-176 now read:
```typescript
if (
  errorType === "Runtime.ExitError" ||
  (typeof errorMessage === "string" && errorMessage.includes("signal: killed")) ||
  (errorMessage && /out of memory/i.test(errorMessage))
) {
  return "oom";
}
```

The old `parsed.signal === "killed"` check is absent from the file. The two required patterns from the original warning are both present: `errorType === "Runtime.ExitError"` (covers the canonical Lambda OOM `errorType`) and `errorMessage.includes("signal: killed")` (covers the canonical Lambda OOM `errorMessage` content). The `typeof errorMessage === "string"` guard before `.includes()` is correct defensive practice. Fix confirmed correct.

**W-02 — `src/cache/cache.ts`: Clarifying comment above `getCachedOutput` noting its throw contract**

Verified.

Line 59 reads:
```typescript
// Throws on DynamoDB errors — callers should catch and handle (unlike incrementCacheHit which swallows).
```

The comment is present, positioned immediately before the JSDoc block for `getCachedOutput`, and accurately describes the asymmetry: `getCachedOutput` throws (caller at line 316 of `execute.ts` wraps in try/catch), `incrementCacheHit` swallows (its own internal try/catch at line 137). Fix confirmed correct.

**S-03 — `src/runners/node22/handler.js`: `solve()` is awaited**

Verified.

Line 31 reads:
```javascript
const result = await fn(inputs);
```

The `await` keyword is present. The enclosing `handler` is declared `async` (line 18: `exports.handler = async (event) => {`). Async skill implementations that return a Promise will now resolve correctly rather than returning a serialized Promise object. Fix confirmed correct.

---

### Overall Verdict: APPROVED

All six fixes — three critical (C-01, C-02, C-03) and three non-critical (W-01, W-02, S-03) — are correctly implemented. No regressions introduced. The original Request Changes verdict is hereby lifted.

IMPL-06 and IMPL-07 are approved for completion. REVIEW-07 is closed.
