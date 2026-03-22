# REVIEW-08: Decision Engine Lambda (IMPL-10)

**Reviewer:** Iris
**Date:** 2026-03-22
**Task:** IMPL-10 (`src/decision-engine/`) — Decision Engine Lambda implementing all 4 rules
**Design Reference:** `docs/decision-engine.md` (ARCH-07)
**Verdict:** Approved with Notes

---

## Completion Gate Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass — exits 0, no errors |
| `npx jest tests/unit/decision-engine/` | Pass — 54 tests, 4 suites, all green |
| `npx cdk synth` | Pass — template synthesizes cleanly |
| `DecisionEngineFn` in template | Confirmed |
| `DecisionEngineSchedule` in template | Confirmed |
| `GapQueue` in template | Confirmed |
| `ArchiveQueue` in template | Confirmed |
| `GapLogTable` in template | Confirmed |
| `ConfigTable` in template | Confirmed |
| `ArchiveDryRunTable` in template | Confirmed |
| `ReservedConcurrentExecutions: 1` | Confirmed |

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Yes, with the notes below. The code is well-structured across five discrete files with clear separation of concerns. Each rule is independently testable and its implementation file maps cleanly to the sub-task scope in the spec. Naming is accurate throughout (`evaluateAutoCache`, `evaluateOptimizationFlag`, `evaluateGapDetection`, `evaluateArchive`). Comments justify non-obvious decisions (pagination loops, why `sqsSent` flag exists, FIFO deduplication rationale). The `isConditionalCheckFailedException` helper is duplicated between `autoCache.ts` and `optimizationFlag.ts` rather than shared from `src/shared/` — a minor readability concern, not a blocking issue. The `gapDetection.ts` log line at line 173 reports `sorted.length` and `items.length` as if they differ, but they are always the same value since both reference the same array before and after sort (the spread creates a new array, but `items.length === sorted.length` always). This is cosmetically confusing log output; the intent is clear.

**2. Is there a simpler solution?**

No for the overall structure — five files matching five sub-tasks is the right decomposition. One minor observation: `optimizationFlag.ts` uses `ScanCommand` with a status equality filter expression (`FilterExpression: "#status = :status"`) on a GSI whose partition key *is* `status`. The correct operation for a GSI with a known partition key is `QueryCommand` with `KeyConditionExpression`, not `ScanCommand` with a filter. The GSI key condition is more efficient (avoids scanning all GSI partitions and applying a post-read filter) and is what `autoCache.ts` correctly does using `QueryCommand`. This is a correctness issue for production at scale but not a logic bug — the results are identical, only the RCU cost differs. See WARNING-01.

**3. Are there unintended side effects?**

None found outside the task scope. The Decision Engine Lambda does not write to `codevolve-cache`, does not invoke any runner Lambda, and has no path that calls the Claude API. IAM grants in the CDK stack are correctly scoped: the Lambda has read/write on `codevolve-skills`, `codevolve-problems`, `codevolve-gap-log`, `codevolve-config`, `codevolve-archive-dry-run`; send on both SQS queues; write on the Kinesis stream. No Bedrock, no OpenSearch, no Secrets Manager grant is present in Phase 2 (Secrets Manager is deferred to Phase 3 per spec §6.5 — correctly not implemented yet).

**4. Are edge cases handled?**

The following edge cases were verified:

- **23-hour gate fires correctly on first invocation (no config record):** `readConfig` returns `{}` when the item does not exist; `config.last_archive_evaluation` is `null`, so `isWithinLast23Hours` is not called, and evaluation proceeds. Correct.
- **`ConditionalCheckFailedException` on auto-cache write:** caught silently, iteration continues. Correct.
- **`ConditionalCheckFailedException` on optimization-flag write:** caught silently. Correct.
- **SQS send fails for one gap item:** `last_evolve_queued_at` is not updated for that item; next run will retry. Correct per spec §8.3.
- **DynamoDB update of `last_evolve_queued_at` fails after SQS send:** swallowed with error log; FIFO dedup prevents double-processing within the same calendar day. Correct per spec comment at line 163.
- **Skill with `is_canonical = true` and extreme staleness:** exemption check correctly returns `true` before any trigger is evaluated. Confirmed by Test 3.
- **Skill within 30-day grace period with `execution_count = 0`:** correctly skipped despite satisfying zero-usage trigger. Confirmed by Test 4.
- **Seasonal skill at 200 days:** 365-day threshold applied correctly; not enqueued. Confirmed by Test 6.
- **Low confidence with `execution_count = 4` (below minimum 5):** trigger does not fire. Confirmed by Test 7b.
- **High failure rate trigger when `use_clickhouse = false`:** skipped per Phase 2 flag. Confirmed by Test 8.
- **Problem with `last_resolve_at` within 90 days:** skipped correctly. Confirmed by problem test at line 643.
- **51 candidates with `max_per_cycle = 50`:** exactly 50 SQS messages sent, 1 deferred. Confirmed by Test 10.
- **Dry-run mode:** SQS not called; `PutCommand` to dry-run table called instead. Confirmed by Test 12.

One gap: no test covers the case where `archive.max_per_cycle` is read from the config record (non-default). The implementation reads `config.max_per_cycle ?? MAX_PER_CYCLE_DEFAULT`. The test at Test 10 uses the default of 50 (the config returned has no `max_per_cycle`). This is low risk — the default path is tested, the read is a one-line expression, and there is no logic branching around the value. Not blocking.

**5. Does the change follow the architectural plan?**

Yes. Rule execution order in `handler.ts` matches the spec: autoCache → optimizationFlag → gapDetection → archiveEvaluation. No LLM calls in any file in `src/decision-engine/`. Analytics events from Rule 4 go to Kinesis only (not DynamoDB). No write to `codevolve-cache`. The `last_archive_evaluation` gate write occurs after the full archive evaluation completes — correct per spec §8.3 failure mode table. EventBridge schedule is `rate(5 minutes)` per spec §2.1. Timeout is 240 seconds (4 minutes) per spec §2.2.

---

## Security Check

- **Input validation:** Pass (N/A — this is a scheduled Lambda, not an API handler; there is no user-supplied input to validate).
- **DynamoDB safety:** Pass. All DynamoDB expressions use parameterized `ExpressionAttributeNames` and `ExpressionAttributeValues`. No string concatenation in any expression. Status values, threshold numbers, and timestamps are all passed as typed parameter values.
- **Sandbox integrity:** Pass (N/A — the Decision Engine does not run user code and does not interact with execution runners).
- **Error response safety:** Pass (N/A — this Lambda does not return HTTP responses).

---

## Issues Found

**[WARNING-01] `optimizationFlag.ts` uses `ScanCommand` instead of `QueryCommand` on `GSI-status-updated`**

File: `src/decision-engine/rules/optimizationFlag.ts`, line 103.

The `scanEligibleSkills` function calls `ScanCommand` with `IndexName: GSI-status-updated` and a `FilterExpression` that includes `#status = :status`. Since `GSI-status-updated` has `status` as its partition key, this is a table scan that applies a partition key equality as a post-read filter. The correct operation is `QueryCommand` with `KeyConditionExpression: "#status = :status"` — this queries a single GSI partition rather than scanning all partitions.

`autoCache.ts` (the companion rule implemented in the same task) correctly uses `QueryCommand` for the same index. The divergence suggests `optimizationFlag.ts` was written independently and the pattern was not carried over.

At current scale this produces correct results with higher RCU cost. At production scale (thousands of skills), the scan will read every item in the index before applying the status filter, burning RCUs proportional to total table size rather than the size of a single status partition.

This must be fixed before the Decision Engine is deployed to an environment with significant data volume. It is not blocking test passage or correctness at low data volumes, so it is rated WARNING rather than CRITICAL. Should be fixed in the same PR or as FIX-12 before IMPL-10 is marked Complete.

**[WARNING-02] `archiveEvaluation.ts` hardcodes a fallback SQS URL with a placeholder account ID**

File: `src/decision-engine/rules/archiveEvaluation.ts`, line 32.

```typescript
const ARCHIVE_QUEUE_URL =
  process.env.ARCHIVE_QUEUE_URL ?? "https://sqs.us-east-2.amazonaws.com/000000000000/codevolve-archive-queue";
```

The fallback URL contains the placeholder account ID `000000000000`. In production the CDK stack correctly injects `ARCHIVE_QUEUE_URL` via environment variable. However, if the environment variable is accidentally absent (misconfigured deploy, local invocation without env), the Lambda will attempt to send messages to a non-existent queue and generate misleading SQS errors rather than a clear "missing configuration" failure. The other queue URL (`GAP_QUEUE_URL`) defaults to `""` which would immediately produce a more diagnostic error.

Recommend replacing the placeholder URL with `""` (matching `GAP_QUEUE_URL`'s pattern) or adding an explicit startup guard that logs a fatal error if `ARCHIVE_QUEUE_URL` is empty. Not blocking.

**[WARNING-03] `archive.max_per_cycle` and staleness thresholds are not read from `codevolve-config` at runtime**

File: `src/decision-engine/rules/archiveEvaluation.ts`, lines 47–50 and 403.

The spec (§8.2) lists `archive.staleness_days`, `archive.zero_usage_age_days`, and `archive.max_per_cycle` as runtime-configurable values stored in `codevolve-config`. The implementation reads `config.max_per_cycle` (line 403) but reads `archive.staleness_days` and `archive.zero_usage_age_days` from hardcoded constants (`NINETY_DAYS_MS`, `SIXTY_DAYS_MS`) rather than from the config record. This means changing those thresholds requires a code redeploy, not a config table update.

The spec (§4.4.1) says `staleness_threshold = codevolve-config["archive.staleness_days"]` with a default of 90. The implementation bakes 90 days directly. This is a minor deviation — the default is correct, but the runtime override path is missing. Not blocking for Phase 2, but worth tracking.

**[SUGGESTION-01] `isConditionalCheckFailedException` is duplicated across `autoCache.ts` and `optimizationFlag.ts`**

Both files contain an identical inline helper function or inline check for `ConditionalCheckFailedException` by name. A shared utility in `src/shared/` (e.g., `dynamoErrors.ts`) would eliminate the duplication. Low priority, not blocking.

**[SUGGESTION-02] `gapDetection.ts` log at line 173 is misleading**

```typescript
console.log(`[gapDetection] Processed ${sorted.length} gap(s) out of ${items.length} eligible`);
```

Since `sorted` is a sorted copy of `items`, `sorted.length === items.length` always. The intended message is probably "processed N out of M eligible after sorting," but the values will always be identical, making the "out of" phrasing confusing. If the intent is to show how many were successfully sent to SQS (vs. how many were attempted), a counter of successful sends would be more informative. Not blocking.

---

## Rule-by-Rule Spec Compliance

### Rule 1: Auto-Cache Trigger

- Threshold `execution_count >= 50`: Confirmed (constant `EXECUTION_COUNT_THRESHOLD = 50`, query filter `>= :threshold`).
- Phase 2 behavior (no `input_repeat_rate` check): Confirmed per spec §4.1.2.
- Status filter `IN ('partial', 'verified', 'optimized')`: Confirmed (`ELIGIBLE_STATUSES = ["partial", "verified", "optimized"]`).
- Filter `auto_cache <> true`: Confirmed (`attribute_not_exists(auto_cache) OR auto_cache = :false`).
- `UpdateExpression: SET auto_cache = :true, auto_cache_set_at = :now`: Confirmed.
- `ConditionExpression`: Confirmed, matches spec §4.1.4 exactly.
- Pagination via `LastEvaluatedKey`: Confirmed (do-while loop).

### Rule 2: Optimization Flag

- Threshold `latency_p95_ms > 5000`: Confirmed (strictly greater than, consistent with spec ">" not ">=").
- Threshold `execution_count >= 20`: Confirmed.
- Status filter `IN ('verified', 'optimized')`: Confirmed.
- Filter `needs_optimization <> true`: Confirmed.
- `UpdateExpression: SET needs_optimization = :true, optimization_flagged_at = :now`: Confirmed.
- `ConditionExpression`: Confirmed.
- **WARNING**: Uses `ScanCommand` instead of `QueryCommand` — see WARNING-01.

### Rule 3: Gap Detection

- 24-hour lookback on `last_seen_at`: Confirmed.
- 24-hour dedup on `last_evolve_queued_at`: Confirmed.
- `Limit: 10` applied at scan level: Confirmed.
- Client-side sort by `min_confidence ASC`: Confirmed.
- SQS message shape matches spec §4.3.3: Confirmed (`intent`, `resolve_confidence`, `timestamp`, `original_event_id`).
- `MessageDeduplicationId: {intent_hash}_{YYYYMMDD}`: Confirmed.
- `MessageGroupId: "gap"`: Confirmed.
- `last_evolve_queued_at` updated after successful SQS send: Confirmed.
- `last_evolve_queued_at` NOT updated on SQS failure: Confirmed (retry on next run).

### Rule 4: Archive Evaluation

- 23-hour gate: Confirmed.
- All 5 exemptions (archived, canonical, evolve_in_progress, grace period, cooldown): All confirmed.
- Trigger 1 (Staleness, 90d standard, 365d seasonal): Confirmed. Per-domain override is not implemented — not specified in IMPL-10 scope, deferred.
- Trigger 2 (Low Confidence, < 0.30 AND >= 5 executions): Confirmed.
- Trigger 3 (High Failure Rate): Correctly stubbed behind `use_clickhouse` flag, skipped in Phase 2.
- Trigger 4 (Zero Usage, `execution_count == 0` AND age > 60 days): Confirmed.
- First trigger wins: Confirmed (early return pattern `if (reason == null)`).
- Problem archive evaluation: Confirmed (90-day `last_resolve_at` + zero high-confidence skills).
- `archive.max_per_cycle` limit (default 50): Confirmed.
- Severity sort before truncation (`failure_rate DESC, confidence ASC, staleness DESC`): Confirmed.
- Kinesis `archive_warning` for `execution_count > 100`: Confirmed, emitted before SQS send.
- Dry-run mode: Confirmed — no SQS send; writes to `codevolve-archive-dry-run` table.
- `last_archive_evaluation` updated after full run completes (not before): Confirmed.
- `archive.candidates_deferred` logged (not emitted as CloudWatch metric yet): Acceptable for Phase 2; the comment at line 487 acknowledges this is deferred to Amber's DESIGN-04 work.

---

## CDK Verification

All resources from spec §6 are present:

| Resource | CDK Logical ID | Verified |
|----------|---------------|----------|
| Decision Engine Lambda | `DecisionEngineFn` | Yes |
| EventBridge Rule | `DecisionEngineSchedule` | Yes |
| GapQueue (FIFO) | `GapQueue` | Yes |
| GapQueue DLQ (FIFO) | `GapQueueDlq` | Yes |
| ArchiveQueue (Standard) | `ArchiveQueue` | Yes |
| ArchiveQueue DLQ (Standard) | `ArchiveQueueDlq` | Yes |
| GapLogTable | `GapLogTable` | Yes |
| ConfigTable | `ConfigTable` | Yes |
| ArchiveDryRunTable | `ArchiveDryRunTable` | Yes |
| `reservedConcurrentExecutions: 1` | `ReservedConcurrentExecutions: 1` in template | Yes |
| `archiveHandlerFn.addEventSource(archiveQueue, batchSize: 1)` | `ArchiveHandlerFnSqsEventSource...` in template | Yes |
| Memory: 512 MB | `MemorySize: 512` in template | Yes |
| Timeout: 240 seconds | `Timeout: 240` in template | Yes |
| Schedule: `rate(5 minutes)` | Confirmed in EventBridge rule | Yes |

IAM grants confirmed present: `skillsTable` read/write, `problemsTable` read/write, `gapLogTable` read/write, `configTable` read/write, `archiveDryRunTable` write, `gapQueue` send, `archiveQueue` send, `eventsStream` write.

One IAM grant is absent that the spec lists: Secrets Manager read for `codevolve/clickhouse-credentials`. This is correctly deferred to Phase 3 — the spec notes "Phase 3, when ClickHouse is live." No action needed now.

---

## Overall Assessment

IMPL-10 is a complete and correct Phase 2 implementation of the Decision Engine. All 4 rules are implemented, all spec thresholds are correct, all exemptions and triggers work as specified, idempotency guards are in place on all DynamoDB writes, and the 54 unit tests provide thorough coverage of boundary conditions. The CDK stack synthesizes cleanly with all required resources present.

The only issue requiring attention before production deployment is WARNING-01 (`ScanCommand` vs `QueryCommand` in `optimizationFlag.ts`). At the current development stage this does not affect correctness or the test gate, but should be corrected before significant data volume is present.

---

## Completion Gate Check

- [x] `npx tsc --noEmit` — exits 0
- [x] `npx jest tests/unit/decision-engine/` — 54 tests, all pass
- [x] `npx cdk synth` — exits 0, all required resources confirmed
- [x] Rule order: autoCache → optimizationFlag → gapDetection → archiveEvaluation
- [x] `reservedConcurrentExecutions: 1` confirmed
- [x] `archiveHandlerFn.addEventSource(archiveQueue, { batchSize: 1 })` confirmed
- [x] No LLM calls outside `src/evolve/`
- [x] No analytics events written to DynamoDB primary tables
- [x] Dry-run mode does not call SQS
- [x] Canonical skills unconditionally exempt from archive evaluation
- [ ] WARNING-01: `optimizationFlag.ts` should use `QueryCommand` not `ScanCommand` (not blocking approval; must fix before production data volume)
- [ ] WARNING-03: `archive.staleness_days` and `archive.zero_usage_age_days` not read from config at runtime (deferred to Phase 3 config migration)

---

## Notes for Ada

1. WARNING-01 (`ScanCommand` → `QueryCommand` in `optimizationFlag.ts`) is the highest priority follow-up. The fix is mechanical: replace `ScanCommand` with `QueryCommand`, move `#status = :status` from `FilterExpression` to `KeyConditionExpression`, and remove it from `FilterExpression`. The test mock will need to return items for the `QueryCommand` call instead of `ScanCommand`. Match the pattern already in `autoCache.ts`.

2. WARNING-02 (placeholder SQS URL) can be fixed at the same time as WARNING-01 — replace `"000000000000"` in the default with `""` or remove the fallback entirely (force failure on missing env var).

3. WARNING-03 (hardcoded staleness thresholds) is deferred to Phase 3. When IMPL-08 is live and the ClickHouse config path is wired up, extend `ConfigRecord` to include `staleness_days` and `zero_usage_age_days` and read them in `evaluateArchive`. No action needed now.

4. SUGGESTION-01 (shared `isConditionalCheckFailedException`): when the next Phase 3 IMPL touches `src/shared/`, extract this helper.

5. IMPL-10 is approved for marking Complete once WARNING-01 is fixed. WARNING-01 does not block this review's approval verdict but should be tracked as FIX-12.
