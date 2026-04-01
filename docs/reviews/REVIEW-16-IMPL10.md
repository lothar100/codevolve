# REVIEW-16: IMPL-10 Re-Review — CDK Critical Resolution Verification

**Reviewer:** Iris
**Date:** 2026-03-25
**Task:** IMPL-10 (`infra/codevolve-stack.ts` + `src/decision-engine/`) — CDK scaffold restore
**Design Reference:** `docs/decision-engine.md` (ARCH-07)
**Prior Review:** REVIEW-15-IMPL10 (2026-03-25) — REJECTED (CRITICAL-01: CDK constructs absent)
**Verdict:** APPROVED

---

## Purpose

REVIEW-15-IMPL10 rejected IMPL-10 solely because `DecisionEngineFn`, `DecisionEngineSchedule`, and
`GapLogTable` were absent from `infra/codevolve-stack.ts`. Ada has since added all three constructs
and merged them into main. This review verifies that CRITICAL-01 is fully resolved and that no
regressions were introduced.

---

## CRITICAL-01 Resolution Checklist

| Check | Result |
|-------|--------|
| `GapLogTable` present in CDK stack | PASS — CDK logical ID `GapLogTable`, table name `codevolve-gap-log`, PK `intent_hash` (S), TTL attribute `ttl` |
| `ConfigTable` present in CDK stack | PASS — CDK logical ID `ConfigTable`, table name `codevolve-config`, PK `config_key` (S) |
| `DecisionEngineFn` present in CDK stack | PASS — `NodejsFunction`, entry `src/decision-engine/handler.ts`, 512 MB, 240s timeout |
| `reservedConcurrentExecutions: 1` | PASS — confirmed `ReservedConcurrentExecutions: 1` in synthesized CloudFormation |
| `SKILLS_TABLE` env var injected | PASS — via `lambdaEnvironment` spread |
| `GAP_LOG_TABLE` env var injected | PASS — `gapLogTable.tableName` |
| `CONFIG_TABLE` env var injected | PASS — `configTable.tableName` |
| `GAP_QUEUE_URL` env var injected | PASS — `evolveGapQueue.queueUrl` |
| `ARCHIVE_QUEUE_URL` env var injected | PASS — `archiveQueue.queueUrl` |
| `EVENTS_STREAM` env var injected | PASS — via `lambdaEnvironment` spread |
| `DecisionEngineSchedule` EventBridge rule present | PASS — CDK logical ID `DecisionEngineSchedule`, rule name `codevolve-decision-engine-schedule` |
| Schedule rate | PASS — `rate(5 minutes)` |
| EventBridge target | PASS — `DecisionEngineFn` with `retryAttempts: 2` |
| IAM: `skillsTable.grantReadWriteData(decisionEngineFn)` | PASS — confirmed in policy section of synthesized template |
| IAM: `gapLogTable.grantReadWriteData(decisionEngineFn)` | PASS |
| IAM: `configTable.grantReadWriteData(decisionEngineFn)` | PASS |
| IAM: `problemsTable.grantReadWriteData(decisionEngineFn)` | PASS |
| IAM: `eventsStream.grantWrite(decisionEngineFn)` (Kinesis) | PASS |
| IAM: `archiveQueue.grantSendMessages(decisionEngineFn)` | PASS |
| IAM: `evolveGapQueue.grantSendMessages(decisionEngineFn)` | PASS |
| `npx cdk synth` exits 0 | PASS |
| `GapLogTable` appears in synth output | PASS |
| `DecisionEngineFn` appears in synth output | PASS |
| `DecisionEngineSchedule` appears in synth output | PASS |

---

## REVIEW-08 / REVIEW-15 Carry-Forward Warning Status

| Warning | Status |
|---------|--------|
| W-01: `optimizationFlag.ts` used `ScanCommand` instead of `QueryCommand` | RESOLVED — `optimizationFlag.ts` uses `QueryCommand` with `KeyConditionExpression: "#status = :status"` and full `LastEvaluatedKey` pagination loop. Confirmed in source. |
| W-02: Placeholder account ID `000000000000` in `ARCHIVE_QUEUE_URL` fallback | RESOLVED — `archiveEvaluation.ts` line 31 reads `process.env.ARCHIVE_QUEUE_URL ?? ""`. No placeholder. |
| W-03: Staleness thresholds hardcoded (not runtime-configurable via `codevolve-config`) | Still deferred to Phase 3, per REVIEW-08 and REVIEW-15. No regression — status unchanged. Acceptable for Phase 2. |

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. The CDK additions are precise, minimal, and match the spec in `docs/decision-engine.md` §6 with
no unnecessary additions. The Lambda construct sets `reservedConcurrentExecutions: 1` exactly as
ARCH-07 §2.2 requires, the EventBridge rule uses rate-based scheduling (not cron) per ARCH-07 §2.1,
and the env var injections are complete. The IAM grants use CDK's high-level methods
(`grantReadWriteData`, `grantSendMessages`, `grantWrite`) rather than inline `PolicyStatement`
calls, which is the appropriate pattern for this stack.

**2. Is there a simpler solution?**

No. The CDK additions are the minimum required to wire the Decision Engine into the deployed system.
No over-engineering was introduced. The `GapLogTable` removal policy is `DESTROY` (appropriate for a
TTL-based ephemeral tracking table); the `ConfigTable` is `RETAIN` (appropriate for runtime
configuration). Both are correct per their data sensitivity.

**3. Are there unintended side effects?**

None. The changes are strictly additive to the CDK stack. The existing `archiveQueue` and
`evolveGapQueue` are reused — the Decision Engine does not duplicate or re-create those queues, it
only receives `SendMessage` grants on them. No existing Lambda function, DynamoDB table, or Kinesis
stream is modified by these additions.

One observation: `DecisionEngineFn` inherits the `PROBLEMS_TABLE`, `CACHE_TABLE`, and
`ARCHIVE_TABLE` env vars from the `lambdaEnvironment` spread. The Decision Engine does not use
`CACHE_TABLE` or `ARCHIVE_TABLE`. These extra env vars are inert (no security or functional risk)
but represent minor noise. This is noted as a suggestion only — the pattern is consistent with how
other Lambdas in this stack are defined and changing it would require a refactor of the shared env
var model.

**4. Are edge cases handled?**

The CDK layer has no edge case surface of its own — it is infrastructure definition, not runtime
logic. The runtime edge case coverage was confirmed correct in REVIEW-08 and remains unchanged. No
new rule logic was introduced in this diff.

**5. Does the change follow the architectural plan?**

Yes. Every construct maps directly to a row in `docs/decision-engine.md` §6. The schedule, timeout,
concurrency setting, queue names, table names, and env var names all match the spec exactly.

---

## Completion Gate Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS — exits 0, no TypeScript errors |
| `npx jest` (full suite) | PASS — 584 tests, 41 suites, all green |
| `npx cdk synth` | PASS — exits 0 |
| `GapLogTable` in synth output | PASS |
| `DecisionEngineFn` in synth output | PASS |
| `DecisionEngineSchedule` in synth output | PASS |
| `ReservedConcurrentExecutions: 1` in synthesized resource | PASS |
| `ScheduleExpression: rate(5 minutes)` in synthesized rule | PASS |

---

## Security Check

- Input validation: Pass (N/A — scheduled Lambda, no user input)
- DynamoDB safety: Pass — all expressions use parameterized `ExpressionAttributeNames` / `ExpressionAttributeValues`; no string concatenation in queries
- Sandbox integrity: Pass (N/A — no execution runner interaction)
- Error response safety: Pass (N/A — no HTTP responses)
- Env var safety: Pass — no API keys or credentials committed to CDK; ClickHouse credentials (Phase 3) will use Secrets Manager per spec §6.5

---

## Issues Found

- [SUGGESTION] `DecisionEngineFn` inherits `CACHE_TABLE` and `ARCHIVE_TABLE` env vars from the `lambdaEnvironment` spread; the Decision Engine does not use these. No action required — the pattern is consistent with this stack's approach to shared env vars and the extras are inert.

---

## Notes

W-03 (staleness thresholds hardcoded as constants rather than read from `codevolve-config` at
runtime) remains deferred. It was explicitly accepted in REVIEW-08 and REVIEW-15. No action required
before Phase 3.

IMPL-10 is now fully deployable: Lambda, EventBridge trigger, DynamoDB gap-log table, configuration
table, all IAM grants, and all environment variable injections are present in the CDK stack and
confirmed in the synthesized CloudFormation template. All 584 project tests pass. TypeScript is
clean.

**IMPL-10 is approved. The task may be marked `[x]` Complete.**
