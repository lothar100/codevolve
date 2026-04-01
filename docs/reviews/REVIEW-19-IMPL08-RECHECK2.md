# REVIEW-19-IMPL08-RECHECK2: Analytics Consumer + CDK ClickHouse Env Var Fix

**Reviewer:** Iris
**Date:** 2026-03-30
**Scope:** IMPL-08 second re-check — verifying the CDK `CLICKHOUSE_*` env var fix that was blocking approval in REVIEW-08-IMPL08-RECHECK; re-evaluating W-01 and W-02.
**Files reviewed:**
- `infra/codevolve-stack.ts` — `clickhouseSecret`, `clickhouseEnv`, `analyticsConsumerFn`, `dashboardsFn`
- `src/analytics/clickhouseClient.ts`
- `src/analytics/consumer.ts`
- `src/analytics/toClickHouseRow.ts`
- `src/analytics/eventId.ts`

---

## Overall Verdict: APPROVED WITH NOTES

---

## Status of Previous CRITICAL

### CRITICAL (REVIEW-08-IMPL08-RECHECK) — CDK does not inject ClickHouse env vars: RESOLVED

The previously blocking critical has been resolved. The fix landed in commit `d7a151f` (merge of `f13004f`). The approach taken differs slightly from the description in this review request — instead of collapsing host and port into a single `CLICKHOUSE_URL` via `cdk.Fn.join`, both the CDK stack and `clickhouseClient.ts` were updated to use separate `CLICKHOUSE_HOST` and `CLICKHOUSE_PORT` variables. The result is functionally equivalent and both sides agree on variable names.

**Evidence — `infra/codevolve-stack.ts` lines 432-438 (`clickhouseEnv`):**
```typescript
const clickhouseEnv = {
  CLICKHOUSE_HOST: clickhouseSecret.secretValueFromJson("host").unsafeUnwrap(),
  CLICKHOUSE_PORT: clickhouseSecret.secretValueFromJson("port").unsafeUnwrap(),
  CLICKHOUSE_USER: clickhouseSecret.secretValueFromJson("username").unsafeUnwrap(),
  CLICKHOUSE_PASSWORD: clickhouseSecret.secretValueFromJson("password").unsafeUnwrap(),
  CLICKHOUSE_DATABASE: clickhouseSecret.secretValueFromJson("database").unsafeUnwrap(),
};
```

**Evidence — `src/analytics/clickhouseClient.ts` lines 23-31:**
```typescript
const host = process.env.CLICKHOUSE_HOST ?? "localhost";
const port = process.env.CLICKHOUSE_PORT ?? "8123";
const protocol = port === "8443" ? "https" : "http";
const url = `${protocol}://${host}:${port}`;
```

The variables injected by CDK and the variables read by the client are identical: `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`. The old dead `CLICKHOUSE_SECRET_ARN` variable has been removed. Both `analyticsConsumerFn` and `dashboardsFn` spread `clickhouseEnv`, and `clickhouseSecret.grantRead()` is applied to both (CDK lines 984 and 988).

**CDK synth output confirms correct injection on both Lambda functions:**
```
CLICKHOUSE_HOST: "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-2:178778217786:secret:codevolve/clickhouse-credentials:SecretString:host::}}"
CLICKHOUSE_PORT: "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-2:178778217786:secret:codevolve/clickhouse-credentials:SecretString:port::}}"
CLICKHOUSE_USER: "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-2:178778217786:secret:codevolve/clickhouse-credentials:SecretString:username::}}"
CLICKHOUSE_PASSWORD: "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-2:178778217786:secret:codevolve/clickhouse-credentials:SecretString:password::}}"
CLICKHOUSE_DATABASE: "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-2:178778217786:secret:codevolve/clickhouse-credentials:SecretString:database::}}"
```

The `{{resolve:secretsmanager:...}}` dynamic references are resolved at Lambda invocation time by CloudFormation, not at synth time. This is the correct AWS pattern for injecting Secrets Manager values as Lambda environment variables — it does not require the Lambda Secrets Manager extension.

---

## W-01 Status: RESOLVED

**Previous state (REVIEW-08-IMPL08-RECHECK):** `toClickHouseRow.ts` mapped `confidence: null` to TypeScript `null`, but the spec DDL declared `confidence Float64` (non-nullable) with a `-1.0` sentinel. Risk: ClickHouse schema mismatch causing insert failures for all events without a confidence value.

**Current state:** Resolved in `d7a151f`.

`src/analytics/toClickHouseRow.ts` line 52:
```typescript
confidence: event.confidence ?? CONFIDENCE_NULL_SENTINEL,
```

`CONFIDENCE_NULL_SENTINEL = -1.0` is exported from the same file (line 29) with inline documentation referencing the spec DDL. The `ClickHouseRow` interface declares `confidence: number` (non-nullable, line 18). The spec DDL and the code are now aligned: both use `Float64` with `-1.0` as the null sentinel.

This is no longer a warning. W-01 is closed.

---

## W-02 Status: RESOLVED

**Previous state (REVIEW-08-IMPL08-RECHECK):** Only `ReplacingMergeTree` background compaction was implemented. The spec §5.3 required a pre-insert SELECT to filter already-seen `event_id` values before the batch INSERT.

**Current state:** Resolved in `d7a151f`.

`src/analytics/consumer.ts` lines 104-127 implement the two-layer dedup strategy exactly as specified:

1. Layer 1 (hot-path): `SELECT event_id FROM analytics_events WHERE event_id IN (...)` before INSERT. Already-present IDs are filtered out. Skipped duplicates are logged at WARN level and removed from the insert batch (not added to `batchItemFailures` — correct, because they were successfully processed on the prior attempt).
2. Layer 2 (eventual): `ReplacingMergeTree` background compaction handles race-condition duplicates not caught by the pre-insert check.

The case where all rows are duplicates is handled (lines 129-132): returns early with only Phase 1 parse failures.

This is no longer a warning. W-02 is closed.

---

## Test Results

```
npx tsc --noEmit
```
Exit 0. No type errors.

```
npx jest
```
```
Test Suites: 41 passed, 41 total
Tests:       584 passed, 584 total
Snapshots:   0 total
Time:        1.895 s
```

All 584 tests pass including the 48 analytics tests.

```
npx cdk synth
```
Exit 0. Synthesized CloudFormation template confirmed to contain `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, and `CLICKHOUSE_DATABASE` on both `analyticsConsumerFn` and `dashboardsFn`, resolved from Secrets Manager.

---

## Review Questions

### 1. Would a senior engineer approve this implementation?

**Yes.** The CDK fix is minimal and targeted — `clickhouseEnv` is a single shared object spread into both Lambdas, which is the right pattern to avoid drift between consumer and dashboards. The `clickhouseClient.ts` singleton is readable, with the protocol inference (`port === "8443"` → HTTPS) documented implicitly by the logic. The `consumer.ts` two-phase structure is clearly documented with inline spec references. The `toClickHouseRow.ts` sentinel constant is properly named and documented.

One minor precision issue noted in REVIEW-08-IMPL08-RECHECK (line 98: `const client = getClickHouseClient()` called without `await` — correct since it is synchronous, but the `await` was in the previous version) is confirmed resolved: the current `consumer.ts` line 98 calls `getClickHouseClient()` without `await`. This is correct.

### 2. Is there a simpler solution?

The `clickhouseEnv` approach is appropriate. The alternative (`CLICKHOUSE_URL` as a single variable constructed via `cdk.Fn.join`) would be marginally simpler at the CDK level but would require the client to not perform protocol inference — a fair trade-off in either direction. The team chose the separate-variable approach; both implementations are acceptable.

### 3. Are there unintended side effects?

None from the CDK fix. `analyticsConsumerFn` and `dashboardsFn` are the only two Lambda functions that receive `clickhouseEnv`. No DynamoDB writes appear in any analytics file. The `grantRead` for the ClickHouse secret is applied narrowly to only those two functions.

### 4. Are edge cases handled?

**Well-covered:**
- Empty batch → early return with no ClickHouse call.
- All rows are duplicates (pre-insert SELECT returns all IDs) → early return, no INSERT.
- Dedup filtered to empty set → same.
- Parse failure on individual records → accumulated in `batchItemFailures`, batch continues.
- Transient ClickHouse error → all parsed rows returned as `batchItemFailures` for Kinesis retry.
- Permanent `ClickHouseError` → same, with 3-row sample logged for diagnosis.
- `confidence` absent → `-1.0` sentinel (Float64 column safe).
- Mixed parse failures + insert failure → both combined and returned correctly.

**Remaining gap — pre-insert dedup SQL uses string interpolation (not parameterized):**

`consumer.ts` line 105-107:
```typescript
const escapedIds = eventIds.map((id) => `'${id}'`).join(", ");
const existingResultSet = await client.query({
  query: `SELECT event_id FROM analytics_events WHERE event_id IN (${escapedIds})`,
```

The `event_id` values are SHA-256 hex digests (64 lowercase hex characters, character set `[0-9a-f]`). Injection through these values is not possible in practice — the SHA-256 output cannot contain SQL metacharacters. However, this is still technically a parameterized-query violation and would fail a security audit that does not account for the provenance of the values. The `@clickhouse/client` library supports named parameters via `query_params`; using them here would be strictly correct. This is a WARNING, not a CRITICAL, because the attack surface is zero given SHA-256 output.

### 5. Does the change follow the architectural plan?

Yes. The analytics consumer reads only from Kinesis and writes only to ClickHouse. No primary DynamoDB tables are written. No LLM calls appear in the analytics path. All client inputs go through Zod validation before processing. The Kinesis event source uses `reportBatchItemFailures: true`, `bisectBatchOnError: true`, `retryAttempts: 3`, and SQS DLQ. The `clickhouseSecret` is an import-by-name of an externally managed secret (not CDK-managed), which is the correct pattern for credentials that rotate independently of infrastructure changes.

---

## Security Check

- **Input validation:** Pass. `emitEvents.ts` validates all client input via Zod. `dashboards.ts` validates `type`, `from`, and `to` before any ClickHouse query. `consumer.ts` validates each Kinesis record via `AnalyticsEventSchema.safeParse`.
- **DynamoDB safety:** Pass (N/A — analytics handlers do not write to DynamoDB).
- **Sandbox integrity:** Pass (N/A — no skill execution in this module).
- **Error response safety:** Pass. No stack traces, table names, or ClickHouse internals are forwarded to API callers.
- **SQL injection:** Conditional pass. The pre-insert dedup SELECT uses string interpolation of SHA-256 hex values. Injection is not possible given the character set of SHA-256 output. Recommend migrating to parameterized queries before any code path exists that could inject non-hash values.

---

## Issues Found

- **[WARNING] Pre-insert dedup query uses string interpolation instead of parameterized query.** `consumer.ts` lines 105-107 build a `WHERE event_id IN (...)` clause by interpolating SHA-256 hex strings. The attack surface is zero because SHA-256 output is hex-only, but this pattern would fail a security audit and sets a bad precedent. Jorven should ticket a follow-up to migrate to `@clickhouse/client` named parameters (`query_params`). Not blocking approval.

### Previously Resolved (confirmed in this recheck)

- **[RESOLVED] CRITICAL (REVIEW-08-IMPL08-RECHECK) — CDK does not inject ClickHouse env vars.** `clickhouseEnv` now contains `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`. Both `analyticsConsumerFn` and `dashboardsFn` spread `clickhouseEnv`. CDK synth confirms correct CloudFormation dynamic references. `CLICKHOUSE_SECRET_ARN` dead variable removed. Resolved.
- **[RESOLVED] W-01 — `confidence` null sentinel.** `toClickHouseRow.ts` uses `CONFIDENCE_NULL_SENTINEL = -1.0`. `ClickHouseRow.confidence` is typed as `number` (non-nullable). Spec DDL and code aligned. Resolved.
- **[RESOLVED] W-02 — Pre-insert dedup check absent.** Two-layer dedup implemented in `consumer.ts` Phase 2: Layer 1 is a pre-insert SELECT filtering existing `event_id` values; Layer 2 is `ReplacingMergeTree` background compaction. Resolved.

---

## Notes for Ada and Jorven

All three issues from REVIEW-08-IMPL08-RECHECK are resolved. The implementation is production-ready with one non-blocking follow-up.

The one remaining item (parameterized dedup query) is low priority given zero practical injection risk from SHA-256 hex values, but should be addressed before any future change allows non-hash values to flow into the same query path.

IMPL-08 is approved. Update IMPL-08 to `[✓]` Verified and REVIEW-08-IMPL08 to `[✓]`.
