# REVIEW-08-IMPL08-RECHECK: Analytics Consumer + Dashboard Endpoints

**Reviewer:** Iris
**Date:** 2026-03-24
**Scope:** IMPL-08 (Kinesis → Lambda → ClickHouse consumer) + IMPL-09 (5 dashboard endpoints) — recheck after CRITICAL double-protocol fix
**Files reviewed:**
- `src/analytics/clickhouseClient.ts`
- `src/analytics/consumer.ts`
- `src/analytics/eventId.ts`
- `src/analytics/toClickHouseRow.ts`
- `src/analytics/dashboards.ts`
- `src/analytics/emitEvents.ts`
- `tests/unit/analytics/consumer.test.ts`
- `tests/unit/analytics/eventId.test.ts`
- `tests/unit/analytics/toClickHouseRow.test.ts`
- `tests/unit/analytics/dashboards.test.ts`
- `infra/codevolve-stack.ts` (AnalyticsConsumerFn, AnalyticsConsumerDlq, AnalyticsConsumerDlqAlarm, Kinesis event source)

---

## Overall Verdict: CHANGES REQUIRED

---

## Status of Previous CRITICAL

### CRITICAL (original) — Double-protocol URL in `clickhouseClient.ts` line 55: RESOLVED

The `clickhouseClient.ts` file has been fully rewritten. It no longer reads from Secrets Manager and no longer constructs a URL from a secret object. The client now reads directly from environment variables:
- `CLICKHOUSE_URL` (defaults to `http://localhost:8123`)
- `CLICKHOUSE_USER` (defaults to `default`)
- `CLICKHOUSE_PASSWORD` (defaults to `""`)
- `CLICKHOUSE_DATABASE` (defaults to `default`)

The double-protocol construction `https://${secret.host}:${secret.port}` is gone. The CRITICAL is resolved in the source code.

---

## New Critical: CDK Does Not Inject ClickHouse Environment Variables

The fix traded one production failure mode for another. The rewritten client reads `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, and `CLICKHOUSE_DATABASE` from Lambda environment variables. However, none of these four variables are set anywhere in the CDK stack.

**Evidence — `infra/codevolve-stack.ts` line 466–469:**
```typescript
environment: {
  ...lambdaEnvironment,
  CLICKHOUSE_SECRET_ARN: clickhouseSecret.secretArn,  // old variable, now dead
},
```

The shared `lambdaEnvironment` block (lines 179–187) contains only DynamoDB table names, the Kinesis stream name, and `AWS_NODEJS_CONNECTION_REUSE_ENABLED`. It does not contain any `CLICKHOUSE_*` key. The `CLICKHOUSE_SECRET_ARN` that is injected was used by the old Secrets Manager client — it is now dead configuration.

**Runtime consequence:** Every deployed invocation of `codevolve-analytics-consumer` will resolve all four ClickHouse config values to their in-code defaults (`http://localhost:8123`, `default`, `""`, `default`). All ClickHouse connections will fail. Every Kinesis record will be retried three times and then routed to the DLQ. Analytics data will be silently lost until the CDK is corrected.

The same issue affects the dashboards Lambda (`dashboardsFn`) when it is eventually wired up — it uses `getClickHouseClient()` which has the same four-variable dependency.

**Fix required:** Replace `CLICKHOUSE_SECRET_ARN: clickhouseSecret.secretArn` with the four new variables. The values may come from SSM Parameter Store, Secrets Manager (fetched at deploy time via CDK), or plaintext env vars (appropriate for URL and user; password must use Secrets Manager or SSM SecureString). The exact sourcing strategy is for Ada and Jorven to decide, but the CDK must inject the four variables before this can be deployed.

---

## Test Results

```
npx jest tests/unit/analytics/ --passWithNoTests
```

```
PASS unit tests/unit/analytics/consumer.test.ts
PASS unit tests/unit/analytics/dashboards.test.ts
PASS unit tests/unit/analytics/eventId.test.ts
PASS unit tests/unit/analytics/toClickHouseRow.test.ts

Test Suites: 4 passed, 4 total
Tests:       43 passed, 43 total
Time:        0.376 s
```

All 43 analytics tests pass. (The original review reported 34; the count is now 43, reflecting additional tests added since the first review.)

---

## Review Questions

### 1. Would a senior engineer approve this implementation?

**clickhouseClient.ts — Yes.** The rewrite is clean: singleton pattern with module-level `_client`, lazy init on first call, `_setClickHouseClientForTest` / `_setClickHouseClientForTesting` alias both exported for injection, 10s `request_timeout` documented. The env-var approach is simpler and more portable than the original Secrets Manager fetch. Readable without comments.

**consumer.ts — Yes, with one minor observation.** Two-phase parse/insert structure is clearly documented and correctly implemented. Phase 1 parse failures accumulate in `batchItemFailures`; Phase 2 insert failures add all row sequence numbers. The transient-vs-permanent error distinction (`ClickHouseError` instanceof check) is correct. One minor point: `getClickHouseClient()` is a synchronous function but is called with `await` at line 90 (`const client = await getClickHouseClient()`). Awaiting a synchronous return is harmless in JavaScript (the value is not a Promise) and will not cause a bug, but it is imprecise. Not blocking.

**eventId.ts — Yes.** SHA-256 of pipe-delimited canonical fields with documented `NULL_FIELD_SENTINEL = "null"`. The rationale for "null" over "" is correctly documented (empty string is a valid `intent` value) and matches the spec (docs/analytics-consumer.md §5.2). All null field substitution uses `?? NULL_FIELD_SENTINEL`.

**toClickHouseRow.ts — Mostly yes, with a spec divergence noted below (W-01).** Boolean-to-UInt8 mapping is correct (true → 1, false → 0). Null string fields correctly map to `""`. The interface is typed and the function is a pure value transform with no side effects.

**dashboards.ts — Yes.** All five dashboards are implemented. ISO8601 validation is applied before SQL interpolation (`Date.parse` + YYYY-MM-DD prefix regex). The `from >= to` check prevents nonsensical ranges. The `resolveDateRange` function returns a discriminated union, which is clean. The `queryClickHouse` helper is reusable and typed. The outer `try/catch` around the handler prevents stack trace leakage.

**emitEvents.ts — Yes.** Dedicated `KinesisClient` (not the fire-and-forget shared wrapper) with explicit 500 on Kinesis failure. Zod validation applied to all client input. Server-assigns timestamps. No DynamoDB writes anywhere. Correct 202 response.

### 2. Is there a simpler solution?

No. The implementations are appropriately minimal. The two-phase consumer is the correct pattern for this spec. The dashboard handler switch-routing is clear. No shared utilities are being reinvented.

### 3. Are there unintended side effects?

None in the analytics code itself. `emitEvents.ts` writes only to Kinesis. `consumer.ts` writes only to ClickHouse. `dashboards.ts` reads only from ClickHouse. No DynamoDB writes observed in any analytics file. Analytics separation rule is upheld.

The CDK environment variable issue (new CRITICAL above) is a deployment-scope side effect: the `CLICKHOUSE_SECRET_ARN` environment variable is now dead configuration that will not be read by any code, while the four variables the code actually reads are absent.

### 4. Are edge cases handled?

**Well-covered:**
- Empty batch (zero records) → returns `{ batchItemFailures: [] }` without calling insert
- JSON parse failure → `batchItemFailures`, continues
- Zod validation failure → `batchItemFailures`, continues
- Transient ClickHouse error → all valid rows in `batchItemFailures` (Kinesis retries)
- Permanent ClickHouse error (`ClickHouseError`) → same, logged at ERROR level with row sample
- Mixed parse failures + insert failure → both combined correctly
- `from >= to` date range → 400 INVALID_DATE_RANGE
- Invalid dashboard type → 400 VALIDATION_ERROR
- ClickHouse query throws → 500 INTERNAL_ERROR (no stack trace in response)
- `confidence = null` → preserved as `null` in ClickHouseRow (Nullable Float64)

**Gap — pre-insert dedup check (W-02):**
`docs/analytics-consumer.md` §5.3 specifies a two-layer deduplication strategy: (1) a pre-insert `event_id` existence check in ClickHouse for hot-path dedup, and (2) `ReplacingMergeTree` for eventual compaction-based dedup. The consumer implements only layer 2. Layer 1 (the SELECT before INSERT) is absent. The spec explicitly states both are needed: "the pre-insert check handles the hot path; the engine-level dedup handles edge cases where the pre-insert check races with a concurrent insert."

In practice, `ReplacingMergeTree` provides eventual correctness — duplicates will be collapsed during background merge, so query results may include duplicate rows until compaction runs. For aggregate dashboards (count, avg, percentile) this will inflate numbers during high-retry windows. The severity depends on Kinesis retry frequency and ClickHouse merge scheduling. This is a WARNING, not a CRITICAL, because the data is eventually consistent and the functional gap is a spec deviation rather than a data loss risk.

**Gap — `confidence` null sentinel (W-01):**
The ClickHouse DDL in `docs/analytics-consumer.md` §4 declares `confidence Float64` (not Nullable) with the note "-1.0 when field is null". The `toClickHouseRow.ts` maps `confidence: null` to `null` (TypeScript `null`), not `-1.0`. The `ClickHouseRow` interface declares `confidence: number | null` and the column comment says "Nullable(Float64)".

This is a schema-vs-code inconsistency. If the deployed ClickHouse table is `Float64` (not nullable), inserting `null` will cause a ClickHouse `CANNOT_PARSE_INPUT_EXCEPTION` for every event with no confidence value, routing those records to the DLQ. If the table was created as `Nullable(Float64)`, the code is correct and the spec docs need updating. The DDL in the spec must be reconciled with the actual table creation script before deploy.

### 5. Does the change follow the architectural plan?

Yes for all source files. The consumer reads only from Kinesis and writes only to ClickHouse. The dashboards read only from ClickHouse. No LLM calls appear anywhere in the analytics path. No primary DynamoDB tables are written by any analytics handler. All inputs go through Zod validation. The Kinesis event source uses `reportBatchItemFailures: true`, `bisectBatchOnError: true`, `retryAttempts: 3`, and SQS DLQ — all matching the spec.

No, for the CDK: the CDK does not follow the updated client design because the four new env vars are not injected (see new CRITICAL above). The dashboards Lambda is also not yet wired up in CDK (stub TODO at line 348) — this is a known gap logged as IMPL-09 pending, acceptable.

---

## Security Check

- **Input validation:** Pass. `emitEvents.ts` validates all client input via `EmitEventsRequestSchema` (Zod). `dashboards.ts` validates the dashboard type via `DashboardTypeSchema` and validates `from`/`to` before interpolation.
- **DynamoDB safety:** Pass (N/A — analytics handlers do not write to DynamoDB).
- **Sandbox integrity:** Pass (N/A — no skill execution in this module).
- **Error response safety:** Pass. Dashboard handler catches all exceptions and returns `500 INTERNAL_ERROR` with a generic message. No stack traces, table names, or ClickHouse error details are forwarded to the caller.

---

## Issues Found

### New Issues

- **[CRITICAL] CDK does not inject `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, or `CLICKHOUSE_DATABASE` into `analyticsConsumerFn` (or any Lambda).** The rewritten `clickhouseClient.ts` reads these four env vars but none are set in `infra/codevolve-stack.ts`. The old `CLICKHOUSE_SECRET_ARN` variable is still present but now dead. At runtime all connections silently fall back to `http://localhost:8123` and fail. Fix: inject the four variables from Secrets Manager or SSM. The `CLICKHOUSE_SECRET_ARN` grant and import can remain if the values are read at deploy time via CDK; alternatively, migrate the `grantRead` to a Secrets Manager rotation-based approach. Password must not be in plaintext env vars.

### Carried Forward (not resolved by this recheck)

- **[WARNING] W-01 — `confidence` null sentinel mismatch:** `docs/analytics-consumer.md` §4 DDL declares `confidence Float64` with `-1.0` when null; code inserts TypeScript `null`. If the real table is non-nullable Float64, all events without confidence will fail insertion. Jorven must confirm whether the deployed table is `Float64` or `Nullable(Float64)` and update either the code or the spec DDL accordingly.

- **[WARNING] W-02 — Pre-insert dedup check absent:** §5.3 specifies a pre-insert `event_id` existence SELECT before the batch INSERT to handle the hot-path retry window. Only `ReplacingMergeTree` background compaction is implemented. During retry bursts, dashboard aggregates (execution counts, cache hit rates) will be inflated until the next background merge. Acceptable at current volume; must be addressed before high-traffic production load.

### Previously Resolved (confirmed in this recheck)

- **[RESOLVED] CRITICAL (original) — Double-protocol URL:** `clickhouseClient.ts` fully rewritten; no Secrets Manager fetch, no URL construction. Resolved.
- **[RESOLVED] W-01 (original) — AnalyticsConsumerFn timeout:** CDK line 465 `timeout: cdk.Duration.seconds(60)`. Resolved.
- **[RESOLVED] W-02 (original) — DLQ alarm metric:** CDK line 491 uses `metricApproximateNumberOfMessagesVisible`. Resolved.
- **[RESOLVED] W-03 (original) — eventId sentinel:** `NULL_FIELD_SENTINEL = "null"`, spec updated to match. Resolved.
- **[RESOLVED] W-04 (original) — dashboard from/to sanitization:** `isValidIso8601()` + `from >= to` check in place. Resolved.

---

## Notes for Ada and Jorven

The core analytics logic (consumer, eventId, toClickHouseRow, dashboards, emitEvents) is sound and all 43 tests pass. The sole blocker is infrastructure: the CDK Lambda environment does not contain the four variables the new client reads. This is a deploy-time failure that would not be caught by unit tests — the unit tests inject a mock client via `_setClickHouseClientForTesting`, bypassing the env var path entirely.

**Recommended fix path:**

1. Decide on secret delivery: CDK can read the Secrets Manager secret at synth time and inject individual fields as env vars (acceptable for URL/user, not for password), or use AWS Lambda Secrets Manager extension to populate env vars at cold start (better for password). A pragmatic interim: store `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, and `CLICKHOUSE_DATABASE` as SSM parameters and inject via CDK `StringParameter.valueForStringParameter`, store `CLICKHOUSE_PASSWORD` as a SecretManager value and inject via `addEnvironment` with the secret value resolved at synth time (for non-prod) or Lambda powertools Secrets extension (for prod).

2. Remove the now-dead `CLICKHOUSE_SECRET_ARN` env var from the consumer Lambda environment once the four new vars are in place (or repurpose the secret to provide the individual fields).

3. Confirm actual ClickHouse table DDL matches `confidence Nullable(Float64)` or update `toClickHouseRow.ts` to use `-1.0` sentinel — do not defer this.

IMPL-09 dashboard Lambda CDK wiring is still a TODO (line 348); that is expected and not blocking this review.
