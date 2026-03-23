# REVIEW-09: Phase 4 Scaffolds — /validate, /evolve SQS Consumer, Canonical Promotion

**Reviewer:** Iris
**Date:** 2026-03-22
**Tasks:** IMPL-11 (`src/validation/`), IMPL-12 (`src/evolve/`), IMPL-13 (`src/registry/promoteCanonical.ts`)
**Design Reference:** `docs/validation-evolve.md` (ARCH-08)
**Verdict:** REJECTED — IMPL-13 has three spec deviations that must be fixed before approval

---

## Completion Gate Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass — exits 0, no errors |
| `npx jest --no-coverage` | Pass — 306 tests pass, 1 todo, 0 failures |
| `npx cdk synth` | Pass — synthesizes cleanly, no errors |
| `ValidateFn` in CDK stack | Confirmed — 256 MB, 60s timeout, correct entry |
| `EvolveFn` in CDK stack | Confirmed — 512 MB, 300s timeout, FIFO SQS source |
| `ValidateFn` IAM grants | skillsTable read/write, eventsStream write, lambda:InvokeFunction on both runners |
| `EvolveFn` IAM grants | skillsTable write, eventsStream write, gapQueue consume, lambda:InvokeFunction on validateFn, secretsmanager:GetSecretValue |
| `reportBatchItemFailures: true` on SQS event source | Confirmed |
| No LLM calls outside `src/evolve/` | Confirmed — `generateSkill` stub is inside `src/evolve/handler.ts` |
| Analytics events not written to DynamoDB | Confirmed — all emit calls go to Kinesis via `emitEvent` |

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Yes for IMPL-11 and IMPL-12, with the noted gaps. The code is well-structured and clearly scoped as scaffolding. Handler flow comments match actual code, stub boundaries are explicitly marked with TODO references, and error handling is consistent. The `testRunner.ts` stub is clean — a single function, a single throw, a clear TODO. `evolve/handler.ts` is readable end-to-end: message parsing, schema validation, DynamoDB write, fire-and-forget Kinesis, fire-and-forget Lambda invoke.

Not yet for IMPL-13. The already-canonical return code, missing GSI, and absent `test_pass_count > 0` gate are correctness deviations from spec, not quality preferences.

**2. Is there a simpler solution?**

No for IMPL-11 and IMPL-12 given the scaffold scope. The flow decomposition is appropriate. The `processGapMessage` / `handler` split in `evolve/handler.ts` is the right pattern for SQS batch processing — it isolates per-record logic cleanly.

For IMPL-13, the `mapSkillFromDynamo` helper is duplicated from `getSkill.ts` and other registry files — the pre-existing SUGGESTION-01 from REVIEW-04 about extracting this to a shared utility remains open. Not blocking.

**3. Are there unintended side effects?**

None found outside task scope. `validateSkill.ts` writes only to `codevolve-skills` and Kinesis. `evolve/handler.ts` writes only to `codevolve-skills` and Kinesis, and invokes only `codevolve-validate`. `promoteCanonical.ts` writes to `codevolve-skills` and `codevolve-problems` — both correct per spec §4.3. No runner Lambdas are invoked from promoteCanonical. No analytics data is written to DynamoDB.

**4. Are edge cases handled?**

IMPL-11 scaffold handles: 404 not found, 422 archived, 400 no tests (including missing `tests` field), runner throw → 500, Kinesis failure swallowed. The confidence clamping to `[0, 1]` via `Math.min(1, Math.max(0, ...))` is correct. The `clearOptimizationFlag` condition (`failCount === 0 && runnerLatencyMs <= 5000`) is correct per spec §2.4. Two gaps noted below as WARNING and SUGGESTION.

IMPL-12 scaffold handles: JSON parse failure → DLQ, GapMessage schema validation failure → DLQ, `generateSkill` throw → `evolve_failed` emitted → DLQ, empty batch, mixed-failure batch. The `batchItemFailures` logic is correct.

IMPL-13 handles: 404, 422 archived, 422 confidence < 0.85, 422 failing tests, 400 invalid UUID, 500 unexpected error, Kinesis failure swallowed. Missing cases documented in issues below.

**5. Does the change follow the architectural plan?**

IMPL-11 and IMPL-12: Yes. No LLM calls in the validate path. `generateSkill` is a non-exported local function stubbed to throw — it cannot be called from outside `src/evolve/`. Analytics events flow to Kinesis only. The fire-and-forget validate Lambda invoke uses `InvocationType.Event` correctly.

IMPL-13: Partially. The TransactWriteItems approach is correct and atomicity is preserved. However, the implementation uses the wrong GSI for the previous canonical lookup, omits the DynamoDB-level condition check on the promote item, and returns the wrong HTTP status for the already-canonical case. These deviate from ARCH-08 §4.2 and §4.3.

---

## Security Check

- **Input validation:** Pass. `validateSkill.ts` validates `skill_id` via `PathParamsSchema` (zod UUID) and the optional body via `RequestBodySchema` before any DynamoDB access. `evolve/handler.ts` validates the SQS message body via `GapMessageSchema.safeParse`. `promoteCanonical.ts` validates the path parameter via `PathParamsSchema`. All use the shared `validate()` helper or zod `safeParse`.
- **DynamoDB safety:** Pass. All expressions in all three handlers use `ExpressionAttributeValues` and `ExpressionAttributeNames` where reserved words apply. No string concatenation in any DynamoDB expression.
- **Sandbox integrity:** Pass (N/A — these handlers do not run user-supplied code; the test runner stub throws before any execution occurs).
- **Error response safety:** Pass. No stack traces, table names, or internal error messages are reflected in HTTP responses. The 500 error message for runner failure (`"Test runner failed — ARCH-08 pending"`) does not leak implementation details. The 422 error details include only `{ confidence }` or `{ test_fail_count }` — both are safe to return.

---

## Issues Found

**[CRITICAL-01] IMPL-13: Already-canonical returns 200 instead of 409 CONFLICT**

File: `src/registry/promoteCanonical.ts`, lines 80–85.

Spec §4.1 states: "Not already canonical — `is_canonical !== true` — 409 CONFLICT". The implementation returns `200` with the current skill state as a silent idempotent no-op. This diverges from the spec and introduces a correctness hazard: callers cannot distinguish between "successfully promoted" and "was already canonical." The test at line 235 of `promoteCanonical.test.ts` asserts `statusCode === 200`, which will need to be updated to `409` along with the handler fix.

Must be corrected to return `error(409, "CONFLICT", "Skill is already canonical")` before approval.

**[CRITICAL-02] IMPL-13: Wrong GSI used for previous canonical lookup**

File: `src/registry/promoteCanonical.ts`, lines 127–143.

The implementation queries `GSI-problem-status` (partition key: `problem_id`, sort key: `status`) with a `FilterExpression: "is_canonical = :true"`. Spec §4.2 requires querying `GSI-canonical` (partition key: `is_canonical_status`) with `KeyConditionExpression: "is_canonical_status = :val"` and a `FilterExpression` for `problem_id` and `language`.

The current approach has two problems. First, `GSI-problem-status` projects all attributes, but the query reads every skill for the problem (potentially dozens) then filters for the canonical one in memory — this is a scan within a problem partition rather than a direct key lookup. Second, and more critically, the lookup does not filter by `language` — the spec requires the canonical to be per `problem_id + language`, not per `problem_id` alone. Promoting a Python skill will incorrectly find and demote a JavaScript canonical for the same problem if one exists.

Must be corrected to query `GSI-canonical` with `is_canonical_status IN ("true#verified", "true#optimized")` filtered by `problem_id` and `language` before approval.

**[CRITICAL-03] IMPL-13: `test_pass_count > 0` gate and "never validated" case not enforced**

File: `src/registry/promoteCanonical.ts`, lines 110–118.

Spec §4.1 states the full gate is: `test_fail_count === 0 AND test_pass_count > 0`. The `test_pass_count > 0` condition exists specifically to prevent promotion of a skill that has never been validated (where both fields are absent). The spec notes: "If both are absent (skill has never been validated), treat as `test_fail_count = 1` (fails the gate)."

The implementation reads `test_fail_count ?? 0` and checks only `testFailCount > 0`. A skill where both `test_fail_count` and `test_pass_count` are absent passes this gate with `testFailCount = 0`, which would set `is_canonical = true` with no test evidence. This violates the hard rule: "All skills must have passing tests before `is_canonical = true`."

Must enforce `test_pass_count > 0` (or treat absent `test_pass_count` as 0, which fails the gate) before approval.

**[WARNING-01] IMPL-13: No `ConditionExpression` on the promote TransactWrite item**

File: `src/registry/promoteCanonical.ts`, lines 157–175.

Spec §4.3 specifies a `ConditionExpression: "confidence >= :threshold AND test_fail_count = :zero"` on the promote item in the transaction. This creates a DynamoDB-level race-condition guard: if confidence drops between the pre-check (lines 97–105) and the transaction execution, the transaction fails with `TransactionCanceledException (ConditionalCheckFailed)` rather than silently promoting an under-threshold skill. Without it, a concurrent `/validate` run that lowers confidence to 0.7 immediately after the gate check has passed will not be caught.

The spec maps this cancellation to `422 PRECONDITION_FAILED`. At current single-digit concurrency this is low risk, but the guard is inexpensive and the spec is explicit. Should be added before IMPL-13 is marked Complete. Not blocking approval once CRITICAL-01 through CRITICAL-03 are fixed, but must not be deferred beyond the first real deployment.

**[WARNING-02] IMPL-11: Kinesis `validate` event `success` field is hardcoded `true`**

File: `src/validation/validateSkill.ts`, line 239.

The success Kinesis event at line 231–242 sets `success: true` unconditionally. Spec §2.5 states `success: (pass_count === total_tests)` — it should be `false` when any tests fail. The event is only reached after a successful DynamoDB write (partial-pass is still a "successful validation run"), but a caller consuming the Kinesis stream expecting `success: false` when `fail_count > 0` will misread partial-pass events. The fix is one line: `success: failCount === 0`.

**[WARNING-03] IMPL-11: No-tests error code is `NO_TESTS` instead of `NO_TESTS_DEFINED`**

File: `src/validation/validateSkill.ts`, line 132. File: `tests/unit/validation/validateSkill.test.ts`, lines 167, 179.

Spec §2.8 specifies the error code as `NO_TESTS_DEFINED`. The implementation and tests use `NO_TESTS`. This is a wire-format contract — consumers checking the error code by string will break when the full implementation lands and the code is corrected. Should be aligned with spec now while the surface area is small.

**[SUGGESTION-01] IMPL-12: `evolve_failed` emission on generateSkill failure is blocking (awaited), but fire-and-forget on schema validation failure**

File: `src/evolve/handler.ts`, lines 87–98 (generateSkill catch) vs lines 110–120 (schema validation failure).

On the `generateSkill` throw path, `evolve_failed` is `await`-ed, meaning the SQS record is not added to `batchItemFailures` until Kinesis confirms receipt. On the schema validation path, `evolve_failed` is also `await`-ed. Both are awaited — this is consistent — but neither matches the fire-and-forget contract used by the success path (line 171). Since `evolve_failed` is on the error path where the record is about to be DLQ'd anyway, a Kinesis failure on this emit should not alter the SQS outcome. Consider `emitEvent(...).catch(e => console.warn(...))` on both failure paths for consistency with the success path and with the handler's overall Kinesis contract. Not blocking at scaffold stage.

**[SUGGESTION-02] IMPL-12: Test 2 (schema validation failure branch) is not independently tested**

File: `tests/unit/evolve/evolveHandler.test.ts`, lines 183–206.

The test comment acknowledges the gap: the `generateSkill` function is not exported and cannot be overridden to return an invalid-shape object. Both Test 1 and Test 2 exercise the `generateSkill` throw path rather than the schema-validation-failure path. A `TODO` comment documents this, and `it.todo` at line 213 marks the happy path for post-ARCH-08. This is acceptable for a scaffold, but the schema-validation branch (`SkillSchema.safeParse` returning failure) is a distinct code path (lines 102–122) that should gain its own test when `generateSkill` becomes injectable. Track as a follow-up for IMPL-12 full implementation.

**[SUGGESTION-03] IMPL-11: Scaffold response shape does not match spec §2.3 ValidateResponse**

File: `src/validation/validateSkill.ts`, lines 244–251.

The scaffold response returns `{ skill_id, confidence, pass_count, fail_count, latency_ms }`. The full spec ValidateResponse (§2.3) requires `{ skill_id, total_tests, passed, failed, pass_rate, previous_confidence, new_confidence, status_changed, new_status, results[] }`. This is expected for a scaffold and is acceptable — but the response field names differ enough (`pass_count` vs `passed`, `fail_count` vs `failed`, missing `total_tests`, `pass_rate`, `previous_confidence`, `new_confidence`, `status_changed`, `new_status`, `results`) that callers will need breaking changes when the full implementation lands. The scaffold should carry a comment noting this is a reduced response shape pending ARCH-08 wiring, or use the spec field names now for the fields that are present (`passed` instead of `pass_count`, `failed` instead of `fail_count`). Not blocking.

---

## Spec Compliance — IMPL-11 Scaffold

| Spec Requirement | Status |
|-----------------|--------|
| Path param UUID validation (§2.1) | Confirmed |
| Optional body: `version_number` parsed | Confirmed (spec names it `version`, impl uses `version_number` — harmless since it maps to the DynamoDB SK) |
| `additional_tests` and `timeout_ms` (§2.1) | Not implemented — stub scope, acceptable |
| 404 if not found (§2.8) | Confirmed |
| 422 if archived (§2.8) | Confirmed (code: `SKILL_ARCHIVED` vs spec: `PRECONDITION_FAILED` — minor, code is clearer) |
| 400 if no tests (§2.8) | Confirmed (code: `NO_TESTS` vs spec: `NO_TESTS_DEFINED` — see WARNING-03) |
| Runner invocation via `runTests()` | Stub confirmed, throws correctly |
| Confidence = pass/total, clamped (§5) | Confirmed |
| DynamoDB write: confidence, last_validated_at, test_pass_count, test_fail_count (§2.4) | Confirmed |
| DynamoDB write: `#status` update (§2.4) | Not implemented — stub scope |
| DynamoDB write: latency_p50_ms, latency_p95_ms (§2.4) | Not implemented — stub scope |
| REMOVE optimization_flagged when latency ok (§2.4) | Confirmed (as `needs_optimization` — field name differs from spec's `optimization_flagged`) |
| Kinesis event shape (§2.5) | Partially — `success` field wrong (see WARNING-02) |
| Cache invalidation on confidence change (§2, step 10) | Not implemented — stub scope |
| Evolve trigger on confidence < 0.7 (§2, step 12) | Not implemented — stub scope |
| Per-test results in response (§2.3) | Not implemented — stub scope |

## Spec Compliance — IMPL-12 Scaffold

| Spec Requirement | Status |
|-----------------|--------|
| SQS trigger: `codevolve-gap-queue.fifo` (§3.1) | Confirmed in CDK |
| `reportBatchItemFailures: true` (§3.10) | Confirmed in CDK |
| GapMessage schema (§3.2) | Simplified — scaffold uses reduced schema (see note below) |
| JSON parse failure → DLQ | Confirmed |
| Schema validation failure → DLQ | Confirmed |
| `generateSkill` stubbed (not calling Claude) | Confirmed — throws immediately |
| `evolve_failed` emitted on generateSkill failure | Confirmed |
| `evolve_failed` emitted on schema validation failure | Confirmed |
| DynamoDB write: status=partial, is_canonical=false, confidence=0 (§3.7) | Confirmed |
| DynamoDB write: ConditionExpression (attribute_not_exists) | Confirmed |
| `evolve` Kinesis event emitted (fire-and-forget) (§3.8 context) | Confirmed |
| Validate Lambda invoked async (InvocationType.Event) (§3.8) | Confirmed |
| Validate invoke failure swallowed (§3.8) | Confirmed |
| `batchItemFailures` populated on failure | Confirmed |
| Empty batch → empty batchItemFailures | Confirmed |
| No LLM call in handler | Confirmed |

Note on GapMessage schema: spec §3.2 defines a richer schema (`evolve_id`, `skill_id`, `language`, `domain`, `tags`, `problem_id`, `priority`, `reason`). The scaffold `GapMessageSchema` requires only `intent`, `resolve_confidence`, `timestamp`, `original_event_id`. This is a forward-compatibility issue — when the Decision Engine (IMPL-10) is updated to enqueue the full spec shape, the consumer schema must be updated in lockstep. Track as a follow-up.

## Spec Compliance — IMPL-13

| Spec Requirement | Status |
|-----------------|--------|
| Already-canonical → 409 CONFLICT (§4.1) | FAIL — returns 200 (CRITICAL-01) |
| Not archived gate → 422 (§4.1) | Confirmed |
| Status must be verified or optimized (§4.1) | Not enforced — missing gate |
| confidence >= 0.85 gate (§4.1) | Confirmed |
| test_fail_count === 0 gate (§4.1) | Confirmed |
| test_pass_count > 0 / never-validated gate (§4.1) | FAIL — not enforced (CRITICAL-03) |
| Previous canonical lookup on GSI-canonical (§4.2) | FAIL — uses GSI-problem-status (CRITICAL-02) |
| Previous canonical filtered by language (§4.2) | FAIL — consequence of CRITICAL-02 |
| TransactWrite: promote item (§4.3) | Confirmed — correct fields |
| TransactWrite: ConditionExpression on promote (§4.3) | Missing (WARNING-01) |
| TransactWrite: demote item (§4.3) | Confirmed |
| TransactWrite: problems table update (§4.3) | Confirmed |
| TransactionCanceledException → 422 (§4.3 note) | Not handled — outer catch returns 500 |
| Re-fetch after transaction for response (§4.4) | Not done — response built from pre-transaction item (acceptable) |
| Cache invalidation after promotion (§4.5) | Not implemented — acceptable for this phase |
| Kinesis: `promote_canonical` event (§4 context) | Confirmed — emitted with correct shape |

---

## CDK Verification

| Resource | Config | Verified |
|----------|--------|----------|
| `ValidateFn` | `codevolve-validate`, 256 MB, 60s, `src/validation/validateSkill.ts` | Yes |
| `EvolveFn` | `codevolve-evolve`, 512 MB, 300s, `src/evolve/handler.ts` | Yes |
| `ValidateFn` → `skillsTable` read/write | Yes |
| `ValidateFn` → `eventsStream` write | Yes |
| `ValidateFn` → `lambda:InvokeFunction` on both runners | Yes |
| `EvolveFn` → `skillsTable` write | Yes (`grantWriteData` — read not granted; correct since evolve only writes) |
| `EvolveFn` → `eventsStream` write | Yes |
| `EvolveFn` → `gapQueue` consume | Yes |
| `EvolveFn` → `lambda:InvokeFunction` on `validateFn` | Yes |
| `EvolveFn` → `secretsmanager:GetSecretValue` on `codevolve/anthropic-api-key*` | Yes |
| `EvolveFn` → SQS event source: `gapQueue`, `batchSize: 1`, `reportBatchItemFailures: true` | Yes |
| `/validate/{skill_id}` API Gateway route → `ValidateFn` | Yes |

One observation: `ValidateFn` has `lambda:InvokeFunction` on both runner Lambdas pre-granted. At scaffold stage the test runner never invokes them (it throws first), but when ARCH-08 wires the real runner, the IAM grant will already be in place. This is correct forward-planning.

---

## Overall Assessment

IMPL-11 and IMPL-12 are well-executed scaffolds. They faithfully implement the portions of ARCH-08 that are within scaffold scope, clearly defer the rest, and pass all tests. The code is readable, the error handling is consistent, and the boundary between stub and real implementation is unambiguous. Both can be approved as scaffold deliverables once IMPL-13 is resolved.

IMPL-13 is rejected for three reasons. The already-canonical response code (`200` vs `409`), the wrong GSI for canonical lookup (missing language filter creates a cross-language demotion risk), and the missing `test_pass_count > 0` / never-validated gate together constitute correctness failures against the spec, not style preferences. The third issue directly violates the hard rule that `is_canonical = true` must not be set without all tests passing — a skill that has never been validated can currently be promoted to canonical.

IMPL-09 through IMPL-13 can be marked Complete after CRITICAL-01 through CRITICAL-03 are resolved and tests are updated to match. WARNING-01 (TransactWrite condition check) should be bundled into the same fix pass.

---

## Completion Gate Check

- [x] `npx tsc --noEmit` — exits 0
- [x] `npx jest --no-coverage` — 306 tests pass, 0 failures
- [x] `npx cdk synth` — exits 0, no errors
- [x] No LLM calls outside `src/evolve/`
- [x] No analytics events written to DynamoDB
- [x] `ValidateFn` present with correct IAM grants
- [x] `EvolveFn` present with correct IAM grants
- [x] `reportBatchItemFailures: true` on SQS event source
- [x] `generateSkill` stub correctly throws — ARCH-08 pending
- [x] `testRunner.ts` isolated — no handler logic entanglement
- [ ] CRITICAL-01: Already-canonical must return 409, not 200
- [ ] CRITICAL-02: Previous canonical lookup must use GSI-canonical, filtered by language
- [ ] CRITICAL-03: `test_pass_count > 0` gate must be enforced; never-validated must fail gate
- [ ] WARNING-01: Add ConditionExpression to promote TransactWrite item
- [ ] WARNING-02: Fix `success` field in validate Kinesis event to `failCount === 0`
- [ ] WARNING-03: Align no-tests error code to `NO_TESTS_DEFINED` per spec §2.8

---

## Notes for Ada

1. **CRITICAL-01** fix: change the already-canonical early return at `promoteCanonical.ts` line 81 from `success(200, ...)` to `error(409, "CONFLICT", "Skill is already the canonical for this problem")`. Update the corresponding test assertion from `statusCode === 200` to `statusCode === 409` and add a check that `body.error.code === "CONFLICT"`.

2. **CRITICAL-02** fix: replace the `GSI-problem-status` query (lines 127–138) with a query on `GSI-canonical`. The key condition should be `is_canonical_status = :ics` where `:ics` is built as `` `true#${skillItem.status as string}` `` (matching the value set by the promote expression). Add a `FilterExpression: "problem_id = :pid AND #lang = :lang"` with `ExpressionAttributeNames: { "#lang": "language" }` to limit to the same problem + language. If you want to be thorough, query both `"true#verified"` and `"true#optimized"` (two queries or a single query with an OR filter — DynamoDB does not support OR in KeyConditionExpression, so two queries or a filter are both acceptable).

3. **CRITICAL-03** fix: add a check after the `test_fail_count` gate. Read `test_pass_count` from `skillItem`. If `test_pass_count` is `undefined` or `null` or `=== 0`, return `error(422, "PRECONDITION_FAILED", "Skill has not been validated or all tests are failing", { test_pass_count: testPassCount ?? 0 })`. Update the test at line 194 (which currently only checks `test_fail_count: 1`) to add a separate test for the never-validated case.

4. **WARNING-01** can be fixed in the same pass: add `ConditionExpression: "confidence >= :threshold AND test_fail_count = :zero"` with `:threshold: 0.85` and `:zero: 0` to the promote TransactWrite item, and add a catch for `TransactionCanceledException` in the outer try block that returns `error(422, "PRECONDITION_FAILED", "Promotion conditions no longer met")`. Add a test case for this path.

5. **WARNING-02** (one line): `src/validation/validateSkill.ts` line 239 — change `success: true` to `success: failCount === 0`.

6. **WARNING-03** (two files): change `"NO_TESTS"` to `"NO_TESTS_DEFINED"` in `validateSkill.ts` line 132 and the two test assertions in `validateSkill.test.ts` lines 167 and 179.

7. The missing `status` gate for IMPL-13 (`status must be verified or optimized`) was not elevated to CRITICAL because a skill with status `unsolved` or `partial` would still be caught by the `test_fail_count` and `test_pass_count` gates in practice (such skills are unlikely to have passing tests). However it should be added for completeness when the other fixes are applied.
