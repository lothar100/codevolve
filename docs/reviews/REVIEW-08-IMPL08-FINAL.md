## Iris Review — IMPL-08 (Analytics Event Consumer: Kinesis → Lambda → ClickHouse)

**Review ID:** REVIEW-08-IMPL08-FINAL
**Date:** 2026-04-08
**Reviewer:** Iris
**Scope:** Final closure review following REVIEW-08-IMPL08-RECHECK. Verifies resolution of all three previously identified issues and confirms fitness for production approval.

**Files reviewed:**
- `src/analytics/consumer.ts`
- `src/analytics/clickhouseClient.ts`
- `src/analytics/eventId.ts`
- `src/analytics/toClickHouseRow.ts`
- `infra/codevolve-stack.ts` (lines 420–510, 1040–1050)
- `scripts/clickhouse-init.sql`
- `scripts/clickhouse-seed-verify.sql`
- `tests/unit/analytics/consumer.test.ts`
- `tests/unit/analytics/eventId.test.ts`
- `tests/unit/analytics/toClickHouseRow.test.ts`
- `docs/analytics-consumer.md`

---

### Verdict: APPROVED WITH NOTES

All three issues raised in REVIEW-08-IMPL08-RECHECK are resolved. No new criticals found. One pre-existing warning (non-parameterized dedup query) is carried forward as a non-blocking follow-up.

---

## Status of Previously Identified Issues

### CRITICAL — CDK does not inject CLICKHOUSE_URL/USER/PASSWORD/DATABASE into analyticsConsumerFn: RESOLVED

`infra/codevolve-stack.ts` lines 436–442 construct a shared `clickhouseEnv` object from five Secrets Manager JSON field references:

```
CLICKHOUSE_HOST     ← secret field "host"
CLICKHOUSE_PORT     ← secret field "port"
CLICKHOUSE_USER     ← secret field "username"
CLICKHOUSE_PASSWORD ← secret field "password"
CLICKHOUSE_DATABASE ← secret field "database"
```

`analyticsConsumerFn` (line 477–481) spreads `clickhouseEnv` into its `environment`. `dashboardsFn` (line 453) does the same. `clickhouseSecret.grantRead(analyticsConsumerFn)` at line 1044 grants the Lambda IAM access to retrieve the secret at runtime.

`src/analytics/clickhouseClient.ts` reads exactly these five variables (`CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`). The name mapping is 1:1. The old dead `CLICKHOUSE_SECRET_ARN` variable is absent from both CDK and client.

The `{{resolve:secretsmanager:...}}` CloudFormation dynamic references are resolved by Lambda at invocation time — the standard AWS pattern for injecting Secrets Manager values without a sidecar extension. This is correct.

**Result: RESOLVED. No production fallback to localhost will occur.**

### W-01 — confidence null sentinel mismatch: RESOLVED

`src/analytics/toClickHouseRow.ts` line 29 exports `CONFIDENCE_NULL_SENTINEL = -1.0`. Line 52 maps `event.confidence ?? CONFIDENCE_NULL_SENTINEL`. The `ClickHouseRow` interface (line 18) declares `confidence: number` — non-nullable TypeScript, matching the non-nullable `Float64` column in the DDL.

`scripts/clickhouse-init.sql` line 15: `confidence Float64, -- -1.0 sentinel when field is null (never NULL in CH)`.

Code, interface, DDL, and spec all agree on `-1.0` as the sentinel. `toClickHouseRow.test.ts` line 46–52 explicitly verifies the null → `-1.0` mapping.

**Result: RESOLVED.**

### W-02 — Pre-insert dedup check absent: RESOLVED

`src/analytics/consumer.ts` Phase 2 (lines 100–131) implements the two-layer dedup strategy specified in `docs/analytics-consumer.md §5.3`:

- **Layer 1 (hot-path):** `SELECT event_id FROM analytics_events WHERE event_id IN (...)` is issued before every INSERT. Already-present IDs are removed from the insert batch. Deduped records are logged at WARN level and excluded from `batchItemFailures` — correct because they were successfully processed on a prior invocation.
- **Layer 2 (eventual):** `ReplacingMergeTree(_ingested_at)` in the DDL handles concurrent-insert races not caught by the pre-insert check.
- The all-duplicates case (lines 129–132) returns early without calling INSERT.

`consumer.test.ts` lines 325–418 cover four dedup scenarios: query called before insert; single duplicate skipped; all rows deduped; mixed batch with one duplicate and one new row.

**Result: RESOLVED.**

---

## Review Questions

### 1. Would a senior engineer approve this implementation?

**Yes.** The handler is clearly structured with Phase 1 / Phase 2 comments that match the spec. Names are accurate (`batchItemFailures`, `rowSequenceNumbers`, `existingIdSet`). The singleton client with a test-injection escape hatch (`_setClickHouseClientForTest`) is idiomatic for Lambda warm-instance reuse. The error classification (permanent `ClickHouseError` vs transient `Error`) is readable and maps to different log levels and behavior. No unnecessary cleverness.

### 2. Is there a simpler solution?

**No.** The two-phase structure is the minimum necessary to correctly separate parse failures (permanent, do not retry) from insert failures (transient, do retry). The `clickhouseEnv` shared object in CDK is the correct pattern to keep the two Lambda definitions in sync. There are no redundant utilities that `src/shared/` would replace here.

### 3. Are there unintended side effects?

**None found.** The analytics consumer reads only from Kinesis and writes only to ClickHouse. It has no DynamoDB grants and no DynamoDB imports. `clickhouseSecret.grantRead` is narrowly scoped to `analyticsConsumerFn` and `dashboardsFn` only. No primary data path (registry, router, execute) imports from `src/analytics/`.

### 4. Are edge cases handled?

The following cases are covered and tested:

- Empty batch (zero records) → returns `{ batchItemFailures: [] }` immediately; no ClickHouse call.
- All records fail to parse → insert not called; all sequence numbers in `batchItemFailures`.
- Mixed parse failures + valid records + successful insert → only parse failures returned.
- Mixed parse failures + transient insert error → all sequence numbers (parse + insert) combined.
- Permanent `ClickHouseError` → all rows in `batchItemFailures`, error logged with 3-row sample; caller will DLQ after 3 retries.
- All rows are duplicates → early return after dedup SELECT; INSERT never called.
- Mixed batch (some duplicates, some new) → INSERT called with only the new rows.
- `confidence` absent → `-1.0` sentinel; no ClickHouse schema rejection.

**One edge case not separately tested** — transient failure of the dedup SELECT itself (the pre-insert `client.query` throwing). This is caught by the outer `catch` block at line 142, which marks all `rowSequenceNumbers` as failed and returns them. The behavior is correct (Kinesis will retry), but there is no dedicated test. This is a suggestion, not a blocking gap, because the catch-all behavior is identical for SELECT and INSERT failures.

### 5. Does the change follow the architectural plan?

**Yes.**

- Analytics data flows Kinesis → Lambda → ClickHouse. No analytics events are written to primary DynamoDB tables.
- No LLM calls in any file under `src/analytics/`.
- All Kinesis records validated through `AnalyticsEventSchema` (Zod) before any processing.
- Kinesis event source has `reportBatchItemFailures: true`, `bisectBatchOnError: true`, `retryAttempts: 3`, and SQS DLQ — all per spec §3.
- `clickhouseSecret` is an `fromSecretNameV2` import (externally managed), not CDK-created — correct for credentials that rotate outside the deployment cycle.

---

## Security Check

- **Input validation:** Pass. Every Kinesis record is validated through `AnalyticsEventSchema.safeParse` before processing. Validation failures are non-fatal and logged.
- **DynamoDB safety:** Pass (N/A — no DynamoDB writes in any analytics handler).
- **Sandbox integrity:** Pass (N/A — no skill execution in this module).
- **Error response safety:** Pass. Consumer is an internal Lambda with no API Gateway surface. Errors are logged internally only; nothing is forwarded to external callers.
- **SQL injection:** Conditional pass. See WARNING below.

---

## Issues Found

### Previously Raised — Status in This Review

- **[RESOLVED] CRITICAL (RECHECK) — CDK missing ClickHouse env vars.** Five vars now injected via `clickhouseEnv` spread. Confirmed.
- **[RESOLVED] W-01 — confidence null vs -1.0 mismatch.** `CONFIDENCE_NULL_SENTINEL = -1.0` used in code and DDL. Confirmed.
- **[RESOLVED] W-02 — Pre-insert dedup absent.** Two-layer dedup implemented and tested. Confirmed.

### New Issues Found in This Review

- **[WARNING] Pre-insert dedup query uses string interpolation rather than parameterized query** (`consumer.ts` lines 105–107). The `event_id` values are SHA-256 hex digests — character set `[0-9a-f]{64}` — and cannot contain SQL metacharacters. Injection through these specific values is not possible. However, the pattern violates the security checklist (DynamoDB queries parameterized; same standard should apply to ClickHouse queries), and it sets a precedent that could be copied to a context where the values are not provably safe. The `@clickhouse/client` library supports `query_params` for named parameters. This should be addressed in a hardening pass before IMPL-08 reaches a public-facing audit.

- **[SUGGESTION] Spec DDL in `docs/analytics-consumer.md §4` uses `Enum8(...)` for `event_type`; actual DDL in `scripts/clickhouse-init.sql` uses `LowCardinality(String)`.** The spec DDL is stale. `LowCardinality(String)` is the more operationally flexible choice (allows new event types without a DDL migration), but the discrepancy means the spec is not the source of truth. Jorven should update `docs/analytics-consumer.md §4` to reflect `LowCardinality(String)`. Not blocking.

- **[SUGGESTION] No dedicated test for dedup SELECT throwing transiently.** The outer `catch` correctly handles this case (all rows marked failed), but it is not explicitly exercised. Recommend adding one test that mocks `client.query` to throw and verifies that all `rowSequenceNumbers` appear in `batchItemFailures`. Low priority.

---

## Test Results

```
npx jest tests/unit/analytics/ --no-coverage
```

```
PASS  tests/unit/analytics/dashboards.test.ts
PASS  tests/unit/analytics/consumer.test.ts
PASS  tests/unit/analytics/toClickHouseRow.test.ts
PASS  tests/unit/analytics/eventId.test.ts

Test Suites: 4 passed, 4 total
Tests:       48 passed, 48 total
Snapshots:   0 total
Time:        0.435 s
```

All 48 analytics unit tests pass. The `console.error` output visible in the `dashboards.test.ts` run is deliberate — it is a test that exercises the `[dashboards] Unexpected error` path; the mock throws intentionally. No test failures.

```
npx tsc --noEmit
```

Exit 0. No type errors.

---

## Notes for Ada and Jorven

All three blocking issues from REVIEW-08-IMPL08-RECHECK are confirmed resolved. The implementation is correct and production-ready.

Two non-blocking items to address in the next hardening pass:

1. **Parameterize the dedup SELECT** — replace `WHERE event_id IN (${escapedIds})` with `@clickhouse/client` named parameters. Zero practical risk today; high precedent risk if the pattern is copied.
2. **Update `docs/analytics-consumer.md §4` DDL snippet** — change `Enum8(...)` to `LowCardinality(String)` to match `scripts/clickhouse-init.sql`.

IMPL-08 is approved. Mark the task `[✓]` Complete.

---

*Signed off by Iris — 2026-04-08*
