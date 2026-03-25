# REVIEW-10: IMPL-11 (full), IMPL-12 (full), IMPL-13 (REVIEW-09 criticals resolved), IMPL-09 (fixes verified), CDK

**Reviewer:** Iris
**Date:** 2026-03-23
**Tasks:** IMPL-11 (`src/shared/deepEqual.ts`, `src/validation/handler.ts`), IMPL-12 (`src/evolve/claudeClient.ts`, `src/evolve/skillParser.ts`, `src/evolve/handler.ts`), IMPL-13 (`src/registry/promoteCanonicalGate.ts`, `src/registry/promoteCanonical.ts`), IMPL-09 (`src/analytics/dashboards.ts`, `src/analytics/eventId.ts`, `src/analytics/clickhouseClient.ts`), CDK (`infra/codevolve-stack.ts`)
**Design Reference:** `docs/validation-evolve.md` (ARCH-08), `docs/platform-design.md` (DESIGN-02), `docs/analytics-consumer.md` (§5.2)
**Prior Review:** REVIEW-09 (2026-03-22) — rejected IMPL-13 for CRITICAL-01, CRITICAL-02, CRITICAL-03

**Verdict: CHANGES REQUIRED**

---

## Completion Gate Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass — errors are in out-of-scope Phase 5 scaffolds (`src/mcp/server.ts`, `src/auth/authorizer.ts`) only |
| `npx jest --no-coverage` (in-scope suites) | Pass — all relevant suites pass (see below) |
| No LLM calls outside `src/evolve/` | Confirmed |
| Analytics events not written to DynamoDB | Confirmed |
| ValidateFn in CDK | Confirmed — 256 MB, 300s timeout, `src/validation/handler.ts`, correct IAM |
| EvolveFn in CDK | Confirmed — 512 MB, 300s timeout, FIFO SQS source, `reportBatchItemFailures: true` |
| PromoteCanonicalFn in CDK | Confirmed — TransactWriteItems IAM grant present |
| EvolveGapQueue in CDK | Confirmed — FIFO, contentBasedDeduplication, DLQ |
| EvolveJobsTable in CDK | Present — but PK mismatch (see CRITICAL-01 below) |
| REVIEW-09 CRITICAL-01 (409 ALREADY_CANONICAL) | Resolved — `promoteCanonicalGate.ts` gate 1 returns 409 |
| REVIEW-09 CRITICAL-02 (GSI-canonical with language filter) | Resolved — two queries on `GSI-canonical` filtered by language |
| REVIEW-09 CRITICAL-03 (NEVER_VALIDATED gate) | Resolved — gate 4 in `promoteCanonicalGate.ts` |
| REVIEW-09 WARNING-01 (ConditionExpression on promote) | Resolved — `attribute_exists(skill_id)` present |
| REVIEW-09 WARNING-02 (success field in Kinesis event) | Resolved — `success: failCount === 0` |
| REVIEW-09 WARNING-03 (NO_TESTS_DEFINED error code) | Resolved — error code matches spec |

### Test suite pass summary

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/unit/shared/deepEqual.test.ts` | 30 | PASS |
| `tests/unit/validation/handler.test.ts` | 21 | PASS |
| `tests/unit/evolve/skillParser.test.ts` | 16 | PASS |
| `tests/unit/evolve/handler.test.ts` | 15 | PASS |
| `tests/unit/registry/promoteCanonicalGate.test.ts` | 17 | PASS |
| `tests/unit/registry/promoteCanonical.test.ts` | 15 | PASS |
| `tests/unit/analytics/dashboards.test.ts` | 19 | PASS |
| `tests/unit/analytics/eventId.test.ts` | (passing) | PASS |

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Mostly yes, with three deviations that must be resolved before a senior engineer would sign off:

- `src/evolve/handler.ts` uses `job_id` as the PK for `codevolve-evolve-jobs` throughout, but the CDK stack declares the table PK as `evolve_id`. This is a hard runtime failure at first deploy.
- The CDK sets `VALIDATE_FUNCTION_NAME` in the environment for EvolveFn, but `src/evolve/handler.ts` reads `VALIDATE_LAMBDA_NAME`. The env var name mismatch means the function falls back to the hardcoded default `"codevolve-validation-handler"` at runtime rather than using the deployed function name.
- `promoteCanonical.ts` uses a `require()` call at runtime to load `@aws-sdk/client-cloudfront`. This pattern is documented in the code comment as intentional to avoid a compile-time dependency, but it violates the sandbox principle — `require()` at runtime inside a Lambda can load arbitrary modules and is a code smell that a senior engineer would flag. Given the function is guarded by a `CLOUDFRONT_DISTRIBUTION_ID` env check and runs only on the success path, it is not a security issue in practice, but the approach is fragile (the package must be present in the bundle at deploy time) and the comment acknowledges this with the bundler caveat.

Outside those three items, the code is clean. Handler flow comments are accurate, error paths are consistently typed, and the pure-function decomposition in `promoteCanonicalGate.ts` is the correct pattern.

**2. Is there a simpler solution?**

No for the core logic. The GSI-canonical two-query approach (one for `true#verified`, one for `true#optimized`) is the correct solution given DynamoDB's KeyConditionExpression cannot express OR. The `repairTestCases` function in `skillParser.ts` is appropriately minimal. `deepEqual.ts` is a clean recursive implementation.

The `mapSkillFromDynamo` helper in `promoteCanonical.ts` is still duplicated from other registry files. SUGGESTION-01 from REVIEW-04 (extract to shared utility) remains open — not blocking.

**3. Are there unintended side effects?**

`promoteCanonical.ts` now writes to both `codevolve-skills` (promote + demote) and `codevolve-problems` (canonical_skill_id update) atomically via TransactWriteItems. Both are correct per spec §4.3. The fire-and-forget CloudFront invalidation is the only additional side effect; it is correctly swallowed.

`evolve/handler.ts` writes to `codevolve-skills` (new skill), `codevolve-evolve-jobs` (job status), and Kinesis. No writes to analytics DynamoDB tables. PromoteCanonicalFn has an IAM grant on `cacheTable` (for future cache invalidation on demotion) but does not read or write from it in the current handler — acceptable forward planning.

**4. Are edge cases handled?**

IMPL-11 (`/validate`):
- 404 not found: handled
- 409 archived: handled
- 400 no tests: handled with `NO_TESTS_DEFINED`
- Runner Lambda throws: caught, counted as failed test
- Runner returns invalid JSON: caught, counted as failed test
- Runner returns `functionError`: caught, counted as failed test
- DynamoDB fetch error: returns 500
- DynamoDB update error: returns 500
- Kinesis failure: swallowed
- GapQueue failure: swallowed
- `confidence === NaN`: not explicitly guarded. `passCount / totalTests` is safe when `totalTests > 0` (the `skillTests.length === 0` check at line 277 ensures this). No gap.

IMPL-12 (`/evolve`):
- JSON parse failure: consumed (permanent), job stays at null (jobId not yet set)
- Schema validation failure: consumed (permanent), job updated to "failed"
- Claude returns no JSON: consumed (permanent)
- DynamoDB throttle: retried via batchItemFailures
- Secrets Manager failure: all records in batch fail (batchItemFailures populated)
- Validation Lambda invoke failure: non-fatal, logged, job proceeds to "complete"
- Empty Claude content array (no text blocks): `responseText` is `""`, which causes `parseClaudeSkillResponse` to throw `SyntaxError` — correctly escalated to `PermanentEvolveError`

Gap: if `querySimilarSkills` is called from `generateSkill()` (the exported helper, lines 132-157) as well as directly from the main handler (lines 236-237), the DynamoDB query runs twice per invocation. The `generateSkill` export function is not used by the handler (the handler inlines the prompt-building logic rather than calling `generateSkill`), but the duplicate call path remains a maintenance hazard if someone refactors to use the export. Not blocking.

IMPL-13 (`/promote-canonical`):
- 404 not found: handled
- 409 already canonical: handled (CRITICAL-01 resolved)
- 422 confidence too low: handled
- 422 tests failing: handled
- 422 never validated: handled (CRITICAL-03 resolved)
- 422 wrong status: handled
- 409 archived: handled
- TransactionCanceledException + ConditionalCheckFailed: handled — returns 422 PRECONDITION_FAILED
- Multiple canonical skills in both `true#verified` and `true#optimized` GSI partitions: `allCanonicalItems[0]` takes the first match, but does not handle the case where there are two canonical items (one at each status level). In practice this should not occur (the transact demotes exactly one), but if data is corrupted there could be two. The first is silently demoted and the second is left canonical. Low risk, noting it.
- Re-fetch after transaction fails: correctly returns 500 (line 254)

**5. Does the change follow the architectural plan?**

Yes for IMPL-11, IMPL-12, IMPL-13, and IMPL-09:
- No LLM calls outside `src/evolve/`
- Analytics events flow to Kinesis only, never to DynamoDB primary tables
- ClickHouse client used only by analytics read paths; not imported in hot path handlers
- `deepEqual.ts` has no I/O or side effects
- `promoteCanonical.ts` correctly uses `TransactWriteItems` for atomic multi-table update
- All five dashboard queries use only the ClickHouse client — no DynamoDB reads

The `require()` pattern in `promoteCanonical.ts` for CloudFront is architecturally unusual but isolated behind an env var guard and the spec §4.5 does explicitly describe cache invalidation as a fire-and-forget non-dependency.

---

## Security Check

**IMPL-11 `/validate`**
- Input validation: Pass — `skill_id` extracted from path, no body schema needed (no request body consumed)
- DynamoDB safety: Pass — `QueryCommand` and `UpdateCommand` use `ExpressionAttributeValues` and `ExpressionAttributeNames`; no string concatenation in expressions
- Sandbox integrity: Pass — handler invokes runner Lambdas via SDK, never executes user code directly
- Error response safety: Pass — 500 responses return generic message; no stack traces or table names leaked

**IMPL-12 `/evolve`**
- Input validation: Pass — `GapQueueMessageSchema.safeParse` before any processing
- DynamoDB safety: Pass — all expressions parameterized
- Sandbox integrity: Pass — Claude-generated code is written to DynamoDB as a string, never executed here; execution is deferred to runner Lambdas via the validate trigger
- Error response safety: Pass — no HTTP responses; SQS handler; errors logged to CloudWatch only

**IMPL-13 `/promote-canonical`**
- Input validation: Pass — `PathParamsSchema` validates UUID before DynamoDB access
- DynamoDB safety: Pass — `QueryCommand` and `TransactWriteCommand` use `ExpressionAttributeValues`
- Sandbox integrity: N/A
- Error response safety: Pass — no internal details in 4xx/5xx bodies

**IMPL-09 dashboards**
- Input validation: Pass — `DashboardTypeSchema` validates `type`; `isValidIso8601` validates `from`/`to` before interpolation; `resolveDateRange` rejects invalid dates with 400
- SQL injection: The ISO8601 `from`/`to` values are interpolated directly into ClickHouse queries after `isValidIso8601` validation. The validator requires `^\d{4}-\d{2}-\d{2}` prefix and a parseable date — this sufficiently constrains the input to ISO8601 timestamp format and prevents SQL injection of arbitrary strings. Acceptable.
- `extractTextBefore(intent, ':')` in the evolution-gap dashboard (line 546): this is a non-standard ClickHouse function. Standard ClickHouse (as of 23.x) does not have `extractTextBefore`. The correct function is `substringIndex(intent, ':', 1)`. This will cause a runtime error on the `evolution-gap` dashboard.
- Error response safety: Pass

---

## Issues Found

**[CRITICAL-01] IMPL-12: evolve-jobs table PK name mismatch — `job_id` vs `evolve_id`**

Files: `src/evolve/handler.ts` lines 218-231, 364-375, 405-415; `infra/codevolve-stack.ts` line 152.

The CDK table definition declares `partitionKey: { name: "evolve_id" }`. The spec (`docs/validation-evolve.md` §7, line 594) defines the PK as `evolve_id`. The handler generates a UUID and stores it as `job_id` in all PutItem and UpdateItem calls. At runtime, every write to `codevolve-evolve-jobs` will fail with a `ValidationException: The provided key element does not match the schema` because `job_id` is not the table's partition key.

This is a hard runtime failure that will cause all evolve jobs to fail transient (bubbling to `batchItemFailures` and SQS retry loop until DLQ).

Must be fixed before approval. Either rename the handler's `job_id` references to `evolve_id`, or change the CDK table PK to `job_id`. The spec is authoritative — rename the handler to use `evolve_id`.

**[CRITICAL-02] IMPL-12 / CDK: env var name mismatch — `VALIDATE_FUNCTION_NAME` vs `VALIDATE_LAMBDA_NAME`**

Files: `src/evolve/handler.ts` line 59-60; `infra/codevolve-stack.ts` line 743.

The CDK sets `evolveFn.addEnvironment("VALIDATE_FUNCTION_NAME", validateFn.functionName)`. The handler reads `process.env.VALIDATE_LAMBDA_NAME`. These names do not match. At runtime, `VALIDATE_LAMBDA_NAME` is undefined, and the handler falls back to the hardcoded default `"codevolve-validation-handler"` (line 60). The actual deployed function is named `"codevolve-validate"`. The validate invoke will silently call the wrong function name (which does not exist), returning a Lambda invoke error that is caught and logged but not surfaced — meaning every evolve job will silently skip the validation step.

The spec (`docs/validation-evolve.md` §8 env vars table) specifies `VALIDATE_LAMBDA_NAME`. The CDK must be changed to pass `VALIDATE_LAMBDA_NAME` (matching the handler) rather than `VALIDATE_FUNCTION_NAME`.

Must be fixed before approval.

**[WARNING-01] IMPL-09: `extractTextBefore` is not a valid ClickHouse function**

File: `src/analytics/dashboards.ts` line 546.

The evolution-gap dashboard query uses `extractTextBefore(intent, ':')` to extract a domain prefix from intent strings. This function does not exist in ClickHouse. The correct function for this operation is `substringIndex(intent, ':', 1)`. At runtime, the `evolution-gap` dashboard will throw a ClickHouse query execution error on every request.

The other four dashboards are not affected.

**[WARNING-02] IMPL-12: `promoteCanonical.ts` uses `require()` at runtime for CloudFront SDK**

File: `src/registry/promoteCanonical.ts` lines 294-295.

```
const cf = require("@aws-sdk/client-cloudfront") as any;
```

The code comment explicitly documents this as intentional (to avoid a compile-time bundling dependency), but it bypasses esbuild's static analysis. If `@aws-sdk/client-cloudfront` is not present in the Lambda bundle at deploy time and `CLOUDFRONT_DISTRIBUTION_ID` is set, the function will throw a `MODULE_NOT_FOUND` error that is caught by the fire-and-forget `.catch()` handler. The promotion succeeds but cache invalidation silently fails with no observable signal other than a console warning. The CDK `externalModules: ["@aws-sdk/*"]` bundling config actively excludes all `@aws-sdk/*` packages from the bundle, relying on the Lambda runtime layer. The runtime layer for `NODEJS_22_X` includes only `@aws-sdk/client-*` packages that are part of the AWS SDK v3 base — `@aws-sdk/client-cloudfront` may or may not be present. This is unreliable.

Should be resolved by importing `@aws-sdk/client-cloudfront` statically at the top of the file (same pattern as the other SDK clients in the codebase) and removing the runtime `require()`.

**[SUGGESTION-01] IMPL-13: `mapSkillFromDynamo` duplicated across registry files**

File: `src/registry/promoteCanonical.ts` lines 326-350.

This helper is duplicated from `getSkill.ts` and other registry files. SUGGESTION-01 from REVIEW-04 remains open. Not blocking.

**[SUGGESTION-02] IMPL-12: `generateSkill` export duplicates the Claude call logic from the handler**

File: `src/evolve/handler.ts` lines 132-157.

The exported `generateSkill` function builds a prompt and calls Claude — and the handler (lines 236-258) also builds the same prompt and calls Claude directly, without calling `generateSkill`. The export exists but is unused by the handler. This means there is one tested code path (the handler inline) and one untested helper (the export). If a caller uses `generateSkill`, the DynamoDB `querySimilarSkills` call runs twice (once inside `generateSkill` and once at line 236). The export should either be removed or the handler should delegate to it. Not blocking at this stage.

---

## REVIEW-09 Criticals — Verification

| Issue | Status in This Review |
|-------|----------------------|
| CRITICAL-01: 409 ALREADY_CANONICAL | Resolved — gate 1 in `promoteCanonicalGate.ts` returns `{ valid: false, status: 409, code: "ALREADY_CANONICAL" }` |
| CRITICAL-02: GSI-canonical with language filter | Resolved — `promoteCanonical.ts` lines 103-133 issue two queries against `GSI-canonical` with `FilterExpression: "#lang = :language"` |
| CRITICAL-03: NEVER_VALIDATED gate | Resolved — gate 4 in `promoteCanonicalGate.ts` checks `test_pass_count === undefined \|\| null \|\| 0` |
| WARNING-01: ConditionExpression on promote | Resolved — `ConditionExpression: "attribute_exists(skill_id)"` present on promote item; `ConditionExpression: "attribute_exists(problem_id)"` on problems item |
| WARNING-02: Kinesis `success` field | Resolved — `success: failCount === 0` in `src/validation/handler.ts` line 355 |
| WARNING-03: NO_TESTS_DEFINED error code | Resolved — code is `NO_TESTS_DEFINED` in `src/validation/handler.ts` line 281 |

Note on WARNING-01: the transaction condition check on the promote item uses `attribute_exists(skill_id)` rather than the spec's recommended `confidence >= :threshold AND test_fail_count = :zero`. This provides existence assurance (prevents phantom writes) but does not close the race window where confidence drops between the pre-check and the transaction. The spec calls this a "race-condition guard." In practice at current scale this is acceptable; should be tracked as a deferred hardening item.

---

## IMPL-09 Analytics Fixes Verification (REVIEW-09 W-01 through W-04)

| Issue | Status |
|-------|--------|
| W-01: AnalyticsConsumerFn timeout 300s → 60s | Verified — `timeout: cdk.Duration.seconds(60)` at CDK line 465 |
| W-02: DLQ alarm metric wrong | Verified — `metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) })` at CDK line 491 |
| W-03: eventId.ts sentinel is `"null"` string | Verified — `NULL_FIELD_SENTINEL = "null"` documented and consistent with spec §5.2 |
| W-04: from/to SQL injection | Verified — `isValidIso8601` validation applied before interpolation; ISO8601 format sufficiently constrains the value |

---

## Spec Compliance Summary

### IMPL-11 `/validate`

| Requirement (spec §2) | Status |
|----------------------|--------|
| Path param UUID extraction (§2.1) | Confirmed |
| 404 if not found | Confirmed |
| 409 if archived | Confirmed |
| 400 NO_TESTS_DEFINED if no tests | Confirmed |
| Runner Lambda invocation per test | Confirmed |
| deepEqual comparison of actual vs expected | Confirmed |
| confidence = pass_count / total_tests | Confirmed |
| Status transitions (§6) | Confirmed — partial→verified at ≥0.85 + failCount=0, verified→optimized at 1.0, revert below 0.85 |
| DynamoDB update: confidence, status, test_pass_count, test_fail_count, last_validated_at | Confirmed |
| REMOVE optimization_flagged when latency_p95 <= 5000 | Confirmed |
| Kinesis event: success = failCount === 0 | Confirmed (WARNING-02 resolved) |
| GapQueue send on confidence < 0.7 | Confirmed |
| Response shape: all required fields | Confirmed |

### IMPL-12 `/evolve`

| Requirement (spec §3) | Status |
|----------------------|--------|
| SQS FIFO trigger with reportBatchItemFailures | Confirmed |
| GapQueueMessage Zod validation | Confirmed |
| evolve-job PutItem status="running" | Code correct; runtime will fail — see CRITICAL-01 |
| Claude API call (claude-sonnet-4-6) | Confirmed |
| skillParser extraction + repairTestCases | Confirmed |
| CreateSkillRequestSchema Zod validation | Confirmed |
| Skill PutItem: is_canonical=false, status=partial, confidence=0 | Confirmed |
| Validate Lambda async invoke (InvocationType.Event) | Confirmed; env var name mismatch — see CRITICAL-02 |
| evolve-job UpdateItem status="complete" | Code correct; runtime will fail — see CRITICAL-01 |
| Permanent errors consumed (no retry) | Confirmed |
| Transient errors → batchItemFailures | Confirmed |

### IMPL-13 `/promote-canonical`

| Requirement (spec §4) | Status |
|----------------------|--------|
| 400 invalid UUID | Confirmed |
| 404 not found | Confirmed |
| 409 ALREADY_CANONICAL | Confirmed (CRITICAL-01 resolved) |
| 422 CONFIDENCE_TOO_LOW | Confirmed |
| 422 TESTS_FAILING | Confirmed |
| 422 NEVER_VALIDATED | Confirmed (CRITICAL-03 resolved) |
| 422 WRONG_STATUS | Confirmed |
| 409 SKILL_ARCHIVED | Confirmed |
| GSI-canonical query with language filter | Confirmed (CRITICAL-02 resolved) |
| TransactWriteItems: promote + demote + problems | Confirmed |
| TransactionCanceledException → 422 | Confirmed |
| Re-fetch promoted skill for response | Confirmed |
| Fire-and-forget CloudFront invalidation | Confirmed; see WARNING-02 for `require()` fragility |

---

## Overall Assessment

IMPL-11 is approved. All REVIEW-09 warnings are resolved. The deepEqual utility is correct and well-tested. The validation handler implements the full spec including status transitions, confidence formula, DynamoDB update shape, Kinesis emission, and GapQueue trigger.

IMPL-13 is approved. All three REVIEW-09 criticals are resolved cleanly. The gate function is a well-designed pure function with comprehensive tests. The GSI-canonical approach correctly filters by language. The TransactWrite structure is correct.

IMPL-12 is **rejected** on two counts: (1) the evolve-jobs PK mismatch (`job_id` vs `evolve_id`) is a hard runtime failure that will cause all evolve job tracking to fail; (2) the env var name mismatch (`VALIDATE_LAMBDA_NAME` vs `VALIDATE_FUNCTION_NAME`) silently disables the async validation trigger for every generated skill. Both are configuration errors, not logic errors — the underlying code logic is sound.

IMPL-09 analytics fixes (W-01 through W-04) are all verified. The evolution-gap dashboard has a non-standard ClickHouse function (`extractTextBefore`) that will fail at runtime — this is a WARNING rather than a CRITICAL because it affects only one of five dashboards and does not affect correctness of the other four.

---

## Fixes Required Before Approval

1. **[CRITICAL-01]** Rename all `job_id` references in `src/evolve/handler.ts` to `evolve_id` to match the CDK table PK and spec definition. Affected lines: 212, 218-231, 364-365, 405-406. Also update the `ConditionExpression: "attribute_not_exists(job_id)"` to `attribute_not_exists(evolve_id)` at line 229.

2. **[CRITICAL-02]** In `infra/codevolve-stack.ts` line 743, change `"VALIDATE_FUNCTION_NAME"` to `"VALIDATE_LAMBDA_NAME"` to match what `src/evolve/handler.ts` reads from the environment.

3. **[WARNING-01]** In `src/analytics/dashboards.ts` line 546, replace `extractTextBefore(intent, ':')` with `substringIndex(intent, ':', 1)`.

Items CRITICAL-01 and CRITICAL-02 are both single-line or narrow fixes. They require no test changes — the existing tests mock the DynamoDB client at the SDK level and do not validate the table PK name, so tests will continue to pass after the rename. Verification: `npx tsc --noEmit` and `npx jest` must still pass after the fix.

---

## Notes for Ada

1. **CRITICAL-01 fix detail:** In `handler.ts`, `jobId` is assigned at line 212 via `uuidv4()`. Change the `PutItem` `Item` field from `job_id: jobId` to `evolve_id: jobId`. Change both `UpdateItem` calls' `Key: { job_id: jobId }` to `Key: { evolve_id: jobId }`. Change the `ConditionExpression: "attribute_not_exists(job_id)"` to `"attribute_not_exists(evolve_id)"`. The local variable `jobId` can keep its name — only the DynamoDB item field name changes.

2. **CRITICAL-02 fix detail:** In `codevolve-stack.ts` at the `evolveFn.addEnvironment` call (line 742-744), change `"VALIDATE_FUNCTION_NAME"` to `"VALIDATE_LAMBDA_NAME"`. One character change, one file.

3. **WARNING-01 fix detail:** In `dashboards.ts` line 546, change `extractTextBefore(intent, ':')` to `substringIndex(intent, ':', 1)`. This is the standard ClickHouse function for splitting a string and returning a prefix.
