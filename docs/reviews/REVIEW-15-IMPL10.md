# REVIEW-15: IMPL-10 Completion Assessment (Decision Engine Lambda)

**Reviewer:** Iris
**Date:** 2026-03-25
**Task:** IMPL-10 (`src/decision-engine/`) — Decision Engine Lambda: all 4 rules + CDK wiring
**Design Reference:** `docs/decision-engine.md` (ARCH-07)
**Prior Review:** REVIEW-08 (2026-03-22) — Approved with Notes (W-01, W-02, W-03)
**Verdict:** REJECTED — CDK scaffold (Sub-task A) incomplete; two REVIEW-08 warnings resolved but the Lambda is undeployable

---

## Purpose

IMPL-10 was marked `[~]` (In Progress) without a clear completion assessment. This review determines whether the task is actually complete, and specifically whether REVIEW-08 warnings W-01 and W-02 were fixed.

---

## Completion Gate Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass — exits 0, no TypeScript errors |
| `npx jest tests/unit/decision-engine/` | Pass — 54 tests, 4 suites, all green |
| `DecisionEngineFn` in CDK stack | **FAIL — absent from `infra/codevolve-stack.ts`** |
| `DecisionEngineSchedule` (EventBridge) in CDK | **FAIL — absent from `infra/codevolve-stack.ts`** |
| `GapLogTable` (`codevolve-gap-log`) in CDK | **FAIL — absent from `infra/codevolve-stack.ts`** |
| `ARCHIVE_QUEUE_URL` env var injected by CDK | **FAIL — no CDK construct for Decision Engine Lambda exists** |
| `GAP_QUEUE_URL` env var injected by CDK | **FAIL — same reason** |
| `reservedConcurrentExecutions: 1` | **FAIL — Lambda construct does not exist** |
| W-01 (ScanCommand → QueryCommand) | **RESOLVED** — `optimizationFlag.ts` now uses `QueryCommand` with `KeyConditionExpression` |
| W-02 (placeholder account ID in ARCHIVE_QUEUE_URL) | **RESOLVED** — fallback is now `""` (line 31) |
| W-03 (staleness thresholds not runtime-configurable) | Deferred per REVIEW-08, still hardcoded — acceptable for Phase 2 |

---

## What Changed Since REVIEW-08

The previous REVIEW-08 (2026-03-22) recorded that `npx cdk synth` passed with `DecisionEngineFn`, `DecisionEngineSchedule`, `GapQueue`, `ArchiveQueue`, `GapLogTable`, `ConfigTable`, `ArchiveDryRunTable`, and `reservedConcurrentExecutions: 1` all confirmed in the synthesized template.

The current state of `infra/codevolve-stack.ts` contains **none** of these Decision Engine CDK constructs. The `archiveQueue` and `evolveGapQueue` exist (they were added by IMPL-04 and IMPL-12 respectively), but the Decision Engine Lambda, EventBridge rule, `GapLogTable`, and all associated IAM grants are absent.

This is a regression from the state that REVIEW-08 approved. The most likely explanation is that the CDK scaffold was lost or reverted during subsequent work (commits after 2026-03-22). The Lambda implementation files themselves (`handler.ts`, `rules/*.ts`) are present and correct.

W-01 and W-02 from REVIEW-08 were fixed in the Lambda source files. Those fixes are confirmed.

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

The Lambda source code (all five rule files) continues to meet the standard established in REVIEW-08. The logic is sound, well-structured, and has meaningful test coverage. The two highest-priority REVIEW-08 warnings were correctly addressed:

- `optimizationFlag.ts` now uses `QueryCommand` on `GSI-status-updated`, matching the pattern in `autoCache.ts`. The RCU-unbounded scan is gone.
- The `ARCHIVE_QUEUE_URL` fallback no longer contains a misleading placeholder account ID.

However, the CDK scaffold that wires this Lambda into the system is absent. A Lambda that cannot be scheduled, has no EventBridge trigger, and is not injected with its required environment variables is not a deployable unit. A senior engineer would not sign off on "complete" status without the infrastructure layer.

**2. Is there a simpler solution?**

No — the decomposition and approach are still correct. The fix is additive: restore the CDK constructs.

**3. Are there unintended side effects?**

None in the Lambda source code. The CDK absence means the Decision Engine has no effect at all in the deployed system — it cannot run without the EventBridge rule, and even if manually invoked, `ARCHIVE_QUEUE_URL` and `GAP_QUEUE_URL` would be empty strings (env vars not injected), causing SQS sends to fail immediately with a missing `QueueUrl` error.

**4. Are edge cases handled?**

The Lambda source code edge case coverage is unchanged from REVIEW-08 and remains correct. No new gaps introduced.

**5. Does the change follow the architectural plan?**

The source code follows the plan. The CDK layer does not — it is simply absent.

---

## Security Check

- Input validation: Pass (N/A — scheduled Lambda, no user input)
- DynamoDB safety: Pass — all expressions use parameterized `ExpressionAttributeNames`/`ExpressionAttributeValues`; no string concatenation in queries
- Sandbox integrity: Pass (N/A — no execution runner interaction)
- Error response safety: Pass (N/A — no HTTP responses)

---

## Issues Found

**[CRITICAL-01] Decision Engine Lambda missing from CDK stack — Lambda is undeployable**

`infra/codevolve-stack.ts` contains no `DecisionEngineFn` Lambda construct, no `DecisionEngineSchedule` EventBridge rule, and no `GapLogTable` DynamoDB table. The prior REVIEW-08 confirmed all three were present. They must be restored.

Required additions per `docs/decision-engine.md` §6:
- `DecisionEngineFn` (`NodejsFunction`, entry `src/decision-engine/handler.ts`, 512 MB, 240s timeout, `reservedConcurrentExecutions: 1`)
- `DecisionEngineSchedule` (`events.Rule`, `rate(5 minutes)`, target `DecisionEngineFn`)
- `GapLogTable` (`dynamodb.Table`, PK `intent_hash` S, TTL attribute `ttl`)
- All IAM grants from §6.5: skills read/write, gap-log read/write, config read/write, problems read/write, archive-dry-run write, gap-queue send, archive-queue send, Kinesis write
- Environment variables injected into `DecisionEngineFn`: `SKILLS_TABLE`, `GAP_LOG_TABLE`, `CONFIG_TABLE`, `PROBLEMS_TABLE`, `ARCHIVE_QUEUE_URL`, `GAP_QUEUE_URL`, `EVENTS_STREAM`, `ARCHIVE_DRY_RUN_TABLE`

Note: `ArchiveQueue` and `evolveGapQueue` (the FIFO gap queue) already exist in the stack from earlier tasks. The Decision Engine only needs `SendMessage` grants on them and the env var injections — it does not need to re-create those queues.

**[RESOLVED] W-01: `optimizationFlag.ts` `ScanCommand` → `QueryCommand`**

Fixed. `optimizationFlag.ts` now uses `QueryCommand` with `KeyConditionExpression: "#status = :status"` and full pagination via `LastEvaluatedKey`. Pattern is consistent with `autoCache.ts`.

**[RESOLVED] W-02: Placeholder account ID in `ARCHIVE_QUEUE_URL` fallback**

Fixed. `archiveEvaluation.ts` line 31 now reads:
```typescript
const ARCHIVE_QUEUE_URL = process.env.ARCHIVE_QUEUE_URL ?? "";
```
The `000000000000` placeholder is gone.

---

## Test Results

```
Test Suites: 4 passed, 4 total
Tests:       54 passed, 54 total
Time:        0.308s
```

All 54 decision-engine unit tests pass. TypeScript is clean. The test suite is unchanged from REVIEW-08 — no regression, no gaps introduced by the W-01/W-02 fixes.

---

## Required Fixes Before Approval

1. **[CRITICAL-01] Restore `DecisionEngineFn` CDK construct** with EventBridge rule (`rate(5 minutes)`), all IAM grants from spec §6.5, and all required environment variable injections. Verify with `npx cdk synth` that `DecisionEngineFn`, `DecisionEngineSchedule`, and `GapLogTable` appear in the synthesized template and that `reservedConcurrentExecutions: 1` is set.

That is the only required fix. The Lambda source code is in good shape. W-01 and W-02 are resolved.

---

## Notes for Ada

The Lambda source (`src/decision-engine/`) is complete and correct. The only work remaining is restoring the CDK infrastructure layer. When submitting the fix, confirm:

1. `npx cdk synth` exits 0 with `DecisionEngineFn`, `DecisionEngineSchedule`, `GapLogTable` in the template
2. `reservedConcurrentExecutions: 1` is set on `DecisionEngineFn`
3. `ARCHIVE_QUEUE_URL` env var is wired to `archiveQueue.queueUrl`
4. `GAP_QUEUE_URL` env var is wired to `evolveGapQueue.queueUrl`
5. `GapLogTable` has TTL attribute `ttl` enabled
6. `archiveQueue.grantSendMessages(decisionEngineFn)` and `evolveGapQueue.grantSendMessages(decisionEngineFn)` are present

W-03 (staleness thresholds not runtime-configurable) remains deferred to Phase 3 per REVIEW-08. No action needed before approval.
