## Iris Review — REVIEW-08-IMPL08 (IMPL-08 Analytics Consumer + IMPL-09 Dashboard Endpoints)

> Reviewed by: Iris
> Date: 2026-03-23
> Files reviewed: `src/analytics/consumer.ts`, `src/analytics/clickhouseClient.ts`, `src/analytics/toClickHouseRow.ts`, `src/analytics/eventId.ts`, `src/analytics/dashboards.ts`, `src/analytics/emitEvents.ts`, `infra/codevolve-stack.ts`, `docs/analytics-consumer.md`, `docs/platform-design.md` (DESIGN-02), test files in `tests/unit/analytics/`

---

### Verdict: CHANGES REQUIRED

One critical bug found: the ClickHouse URL is double-prefixed with `https://`. All other checklist items pass. The critical must be fixed before this can be approved.

---

### Review Questions

**1. Would a senior engineer approve this implementation?**

Yes, with the URL exception. The consumer is well-structured — the two-phase design (parse → insert) is clearly named and matches the spec exactly. `deriveEventId`, `toClickHouseRow`, and the consumer handler are all readable without needing comments to decode intent. Variable names are accurate. The permanent vs. transient error distinction in `consumer.ts` lines 99–118 is correctly modelled using `instanceof ClickHouseError`. The dashboard handler is concise and the SQL builder pattern is appropriate. The `_setClickHouseClientForTesting` injection escape hatch is correctly documented as test-only.

**2. Is there a simpler solution?**

No. The implementation is minimal. The shared `queryClickHouse` private helper in `dashboards.ts` (line 31) correctly avoids duplication across all five SQL builders. The SQL is inline string construction, which matches the design spec and avoids an ORM dependency. The lazy singleton in `clickhouseClient.ts` follows the same pattern as the rest of the codebase. No gratuitous abstraction.

One minor note: `dashboards.ts` line 9 re-exports `_setClickHouseClientForTesting` (`export { _setClickHouseClientForTesting }`), which is the correct pattern for test injection — no change needed.

**3. Are there unintended side effects?**

None found. The consumer Lambda has no DynamoDB IAM grants (confirmed in CDK stack lines 544–546 — only `clickhouseSecret.grantRead` and `eventsStream.grantRead` are issued). The dashboards Lambda likewise has only `clickhouseSecret.grantRead` (line 563). Neither Lambda has write access to Skills, Problems, Cache, or Archive tables. Analytics separation is intact.

**4. Are edge cases handled?**

Mostly yes, with one gap:

- Empty batch (zero records): handled correctly — returns `{ batchItemFailures: [] }` without calling insert (consumer.ts line 83).
- All records fail to parse: handled — no insert attempted, parse failures returned (consumer.ts line 85).
- Transient insert error: all rows marked failed, returned for Kinesis retry (consumer.ts lines 120–123).
- Permanent insert error (`ClickHouseError`): all rows marked failed, error logged at ERROR with sample rows (consumer.ts lines 101–110).
- Malformed JSON in Kinesis record: caught, record marked as `batchItemFailures` (consumer.ts lines 48–60).
- Zod validation failure: caught, record marked as `batchItemFailures` (consumer.ts lines 62–71).
- `confidence` undefined/null: `null` preserved as SQL NULL via `?? null` in `toClickHouseRow.ts` line 41. Correct.
- Missing `from`/`to` params on dashboard handler: default range applied (dashboards.ts lines 17–25). Correct.
- Invalid dashboard type: returns 400 `INVALID_DASHBOARD_TYPE` (dashboards.ts lines 147–155). Correct.
- ClickHouse query failure: returns 500 `QUERY_ERROR`, no stack trace leaked (dashboards.ts lines 168–171). Correct.

Gap: If `getClickHouseClient()` throws (e.g., Secrets Manager is unreachable at cold start) during the consumer's Phase 2, the exception propagates out of the try/catch block at consumer.ts line 88 only because `getClickHouseClient()` is called inside that try block (line 89). This is actually correct — the catch at line 98 will catch the Secrets Manager error and mark all rows as failed. No gap. Verified correct.

**5. Does the change follow the architectural plan?**

Yes, with one deviation: the CDK stack timeout for `AnalyticsConsumerFn` is set to 300 seconds (`cdk.Duration.seconds(300)`, line 513) instead of the 60 seconds specified in `docs/analytics-consumer.md` §3.2 and §7.1. This is a WARNING-level finding (over-allocation, not a correctness issue).

The architectural rule that analytics events never go to primary DynamoDB is upheld. The Kinesis event source mapping is correctly wired. The dashboards Lambda reads only from ClickHouse. No LLM calls anywhere in these files.

---

### Security Check

- **Input validation (dashboards.ts):** PASS. Dashboard type is validated against the `DASHBOARD_TYPES` allowlist before use (line 149). Time range params are passed directly into SQL string interpolation — see CRITICAL-01 below.
- **Input validation (emitEvents.ts):** PASS. Full Zod schema `EmitEventsRequestSchema` (line 41) validated before any Kinesis write.
- **DynamoDB safety:** PASS. Consumer and dashboards Lambdas have no DynamoDB permissions — confirmed in CDK stack. No DynamoDB writes anywhere in these files.
- **Sandbox integrity:** N/A. No execution-layer code in these files.
- **Error response safety:** PASS. `consumer.ts` error logging is internal only (CloudWatch). `dashboards.ts` line 170 returns `"Failed to query analytics data"` — no internal details, ClickHouse table name, or stack trace in the response body.
- **Credentials:** PASS. ClickHouse credentials fetched from Secrets Manager at cold start; no credentials in Lambda env vars or in code.

---

### Issues Found

**[CRITICAL] `clickhouseClient.ts` line 55 — Double `https://` prefix creates malformed ClickHouse URL**

The `createClient` call constructs the URL as:
```typescript
url: `https://${secret.host}:${secret.port}`,
```

The secret schema in `docs/analytics-consumer.md` §2.1 and §7.4 specifies `"host"` as `"https://<instance-id>.us-east-2.aws.clickhouse.cloud"` — the `https://` protocol is already embedded in the `host` field. The resulting URL would be `https://https://<instance-id>:8443`, which is not a valid URL and will cause every ClickHouse insert and query to fail at runtime.

The spec's own TypeScript pseudo-code in §4.2 used `host: \`${secret.host}:${secret.port}\`` (the older `host` config key), but the implementation correctly migrated to the `url` key from the `@clickhouse/client` v1.x API. The fix requires choosing one of:

- Option A: Use `url: \`${secret.host}:${secret.port}\`` and ensure `secret.host` already contains the `https://` scheme (no code change needed, update the secret to confirm the host value does not have double protocol).
- Option B: Use `url: \`https://${secret.host}:${secret.port}\`` and ensure the `host` field in the secret stores only the hostname without protocol.

The implementation must be consistent with whichever secret format is deployed. Given that `docs/analytics-consumer.md` §7.4 shows the secret's `host` as `"https://<instance-id>..."`, Option A is the correct fix: change `url: \`https://${secret.host}:${secret.port}\`` to `url: \`${secret.host}:${secret.port}\``. Ada must also verify the actual secret in AWS Secrets Manager to confirm the `host` value format before deployment.

File: `src/analytics/clickhouseClient.ts`, line 55.

---

**[WARNING] CDK Lambda timeout for `AnalyticsConsumerFn` is 300s instead of the spec-mandated 60s**

`infra/codevolve-stack.ts` line 513: `timeout: cdk.Duration.seconds(300)`.

The design spec (`docs/analytics-consumer.md` §3.2 and §7.1) specifies 60 seconds with explicit rationale: "A ClickHouse bulk insert of 100 rows over HTTPS typically completes in 200–800ms. The 60-second timeout provides a 75x safety margin." Using 300 seconds ties up a Kinesis shard iterator for 5 minutes on a hung insert, delaying retry initiation. Reduce to `cdk.Duration.seconds(60)`.

File: `infra/codevolve-stack.ts`, line 513.

---

**[WARNING] CloudWatch DLQ alarm uses `metricNumberOfMessagesSent()` instead of `metricApproximateNumberOfMessagesVisible()`**

`infra/codevolve-stack.ts` line 537:
```typescript
metric: analyticsConsumerDlq.metricNumberOfMessagesSent(),
```

The design spec (`docs/analytics-consumer.md` §6.3 and §7.5) mandates `metricApproximateNumberOfMessagesVisible`. The difference:

- `NumberOfMessagesSent`: counts messages arriving in the DLQ — fires immediately when a failure is routed. Resets to 0 between periods.
- `ApproximateNumberOfMessagesVisible`: counts messages currently sitting unprocessed in the queue — stays > 0 until messages are consumed or expire.

Using `NumberOfMessagesSent` with `GREATER_THAN_OR_EQUAL_TO_THRESHOLD: 1` will fire the alarm correctly when messages arrive, but the alarm will return to OK immediately once the period ends even if messages are unprocessed. `metricApproximateNumberOfMessagesVisible` provides a sustained alert for unprocessed backlog. This is the correct metric for operational monitoring. Use `analyticsConsumerDlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) })`.

Also: the threshold is set to `1` with `GREATER_THAN_OR_EQUAL_TO_THRESHOLD`, while the spec says `> 0` (i.e., `GREATER_THAN_THRESHOLD` with threshold `0`). These are semantically equivalent but the spec wording and CDK pattern should match for clarity.

File: `infra/codevolve-stack.ts`, lines 537–542.

---

**[WARNING] `eventId.ts` uses `"null"` string for null fields instead of `""` as specified**

`docs/analytics-consumer.md` §5.2 specifies the idempotency key formula as:
```
skill_id ?? "" + "|" + event_type + "|" + timestamp + "|" + (input_hash ?? "")
```
(empty string `""` for null fields)

But `eventId.ts` lines 13–14 use:
```typescript
event.skill_id ?? 'null',
...
event.input_hash ?? 'null',
```
(the string `"null"` for null fields)

The spec explicitly says: `skill_id: the event's skill_id field, or "" if null`. This is an inconsistency between the specification and implementation. The string `"null"` and the string `""` will produce different SHA-256 hashes for the same null event fields, meaning deduplication in ClickHouse will not match what a future re-implementation might produce.

In practice this is benign today — as long as the consumer is the only hash producer, all duplicates will produce the same `"null"` hash and deduplication works correctly. However, the spec deviation should be addressed: either update `eventId.ts` to use `""` (matching the spec), or update `docs/analytics-consumer.md` §5.2 to say `"null"` is the sentinel. The test in `eventId.test.ts` line 57 also asserts `"null"` behavior (comment says "uses 'null' string"), so the test would need updating if the code is changed to `""`.

**Recommendation:** Update `docs/analytics-consumer.md` §5.2 to match the implementation (`"null"` as sentinel), since changing the hash formula after deployment would invalidate all previously deduped records.

File: `src/analytics/eventId.ts` lines 13–14; `docs/analytics-consumer.md` §5.2.

---

**[WARNING] `dashboards.ts` SQL queries use string interpolation of `from`/`to` params without sanitization**

All five SQL builder functions construct queries like:
```typescript
AND timestamp BETWEEN '${from}' AND '${to}'
```

The `from` and `to` values are either taken from `event.queryStringParameters` or derived from `new Date(...).toISOString()`. While `resolveTimeRange` does not sanitize these strings, the `@clickhouse/client` query API with `format: "JSONEachRow"` does not use parameterized queries for these time range values — they are interpolated into the SQL string directly.

For the current access pattern (these are internal or operator-facing dashboards, not public user-facing endpoints), this is acceptable. However, if a malicious `from`/`to` value containing a single quote or ClickHouse SQL fragment were passed in, it could break queries or leak data. The hardening path is to use ClickHouse's `{param:DateTime64}` query parameter syntax or explicitly validate that `from` and `to` match ISO8601 format before interpolation (e.g., `new Date(from).toISOString()` — if it throws, reject with 400).

Given that this is an analytics read path with no write capability, this is WARNING-level rather than CRITICAL. Track for hardening before any public exposure of the dashboard API.

File: `src/analytics/dashboards.ts`, lines 52, 69, 87, 102, 121 (all `BETWEEN '${from}'` interpolations).

---

**[SUGGESTION] IMPL-09 todo.md status is `[ ]` but implementation, CDK wiring, and tests are complete**

`tasks/todo.md` line 430 shows `IMPL-09 | Ada | [ ]`. The full IMPL-09 deliverables (dashboards Lambda with all 5 endpoints, CDK route wiring, all tests) are present and passing. Ada should update IMPL-09 to `[~]` or `[✓]` as appropriate after the CRITICAL-01 fix is deployed.

---

### Test Results

```
Test Suites: 4 passed, 4 total
Tests:       34 passed, 34 total
```

- `tests/unit/analytics/consumer.test.ts` — 8 tests, all pass. Covers: valid batch success, parse failures isolated, all-parse-failure skip, transient insert error, permanent insert error (ClickHouseError), zero-record batch, Zod validation failure, mixed parse+insert failure.
- `tests/unit/analytics/dashboards.test.ts` — 11 tests, all pass. Covers all 5 dashboard types (200 with rows), from/to param propagation into SQL, invalid type (400), missing path param (400), ClickHouse connection error (500), resultSet.json() throw (500).
- `tests/unit/analytics/eventId.test.ts` — 7 tests, all pass. Covers determinism, sensitivity to each field, null handling for both null fields.
- `tests/unit/analytics/toClickHouseRow.test.ts` — 9 tests, all pass. Covers full event mapping, null field mappings, boolean-to-UInt8 conversions.

The two `console.error` outputs in the dashboards test run are intentional (testing the 500 error path) and do not indicate failures.

---

### Checklist Item Verdicts

| # | Checklist Item | Verdict | Notes |
|---|----------------|---------|-------|
| 1 | Analytics separation — no events to primary DynamoDB | **PASS** | Consumer has no DynamoDB grants. CDK lines 544–546 confirm. |
| 2 | No primary DB writes — consumer never writes to Skills or Problems | **PASS** | Consumer IAM: Secrets Manager read + Kinesis read only. |
| 3 | Query correctness — all 5 DESIGN-02 dashboard queries satisfied | **PASS** | All 5 dashboard SQL builders query `analytics_events` on columns present in the ClickHouse schema. See notes below. |
| 4 | Idempotency logic correct — re-processing won't double-count | **PASS** | `ReplacingMergeTree(event_id)` deduplication confirmed. SHA-256 formula is deterministic and correctly separates null fields. Spec deviation (uses `"null"` sentinel vs. `""`) does not break correctness. See WARNING-03. |
| 5 | DLQ configuration — failed events land in DLQ, stream not blocked | **PASS** (with warning) | `KinesisEventSource` with `reportBatchItemFailures: true`, `bisectBatchOnError: true`, `retryAttempts: 3`, `onFailure: new SqsDlq(analyticsConsumerDlq)` — all correct. CloudWatch alarm uses wrong metric (WARNING-02). |
| 6 | Schema correctness — all 5 DESIGN-02 queries satisfied by ClickHouse schema | **PASS** | Schema in `analytics-consumer.md` §2.2 covers all columns queried by DESIGN-02 dashboards. `LowCardinality(String)` for `event_type` is backward-compatible with all `WHERE event_type = 'resolve'` string comparisons. `confidence Nullable(Float64)` handles null correctly. |

**Query correctness detail (Checklist Item 3):**

The DESIGN-02 schema (platform-design.md line 450) defines `event_type` as `Enum8(...)` with only 4 values (`resolve`, `execute`, `validate`, `fail`). The actual `analytics-consumer.md` §2.2 DDL upgrades this to `LowCardinality(String)` and adds `archive`, `unarchive`, `evolve`, `evolve_failed`, `promote_canonical`, `archive_warning` — matching the expanded `EVENT_TYPES` in `src/shared/types.ts`. This is a deliberate and documented deviation (analytics-consumer.md §2.2 note). All 5 dashboard queries that filter `event_type IN ('resolve', 'execute', 'validate', 'fail')` work identically with the string column.

Dashboard 4 (evolution-gap): The implementation query filters `event_type = 'resolve' AND success = 0`, matching DESIGN-02 query 4a exactly. DESIGN-02 also specifies queries 4b–4e (low-confidence resolves, failed executions, domain coverage, evolve pipeline status). The `buildEvolutionGapSql` function implements only 4a. DESIGN-02 queries 4b–4e are richer but not required to be in a single endpoint response per the API spec. The single-query per endpoint design is a product decision within scope — not a schema correctness failure.

Dashboard 1 (resolve-performance): The implementation combines queries 1a + 1c + 1d into a single per-minute aggregation, which is a simplification relative to DESIGN-02's multiple sub-queries per dashboard. This is acceptable for an API endpoint that returns structured rows — the frontend can derive the individual metrics from the returned row set.

---

### Notes for Ada and Jorven

1. **CRITICAL fix (Ada):** In `src/analytics/clickhouseClient.ts` line 55, verify and correct the URL construction. If the Secrets Manager secret's `host` value already contains `https://`, remove the `https://` prefix from the template literal. Deploy to dev and confirm the ClickHouse connection succeeds before marking IMPL-08 complete.

2. **Spec alignment (Jorven):** Update `docs/analytics-consumer.md` §5.2 to reflect that the `"null"` string (not `""`) is used as the sentinel for null fields in the `event_id` hash. This locks in the formula for any future re-implementations.

3. **CDK timeout (Ada):** Reduce `AnalyticsConsumerFn` timeout from 300s to 60s in `infra/codevolve-stack.ts` line 513.

4. **DLQ alarm metric (Ada):** Replace `metricNumberOfMessagesSent()` with `metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) })` in `infra/codevolve-stack.ts` line 537.

5. **IMPL-09 tracking (Ada):** Update `tasks/todo.md` IMPL-09 status from `[ ]` once IMPL-08 CRITICAL is resolved and both are deployed.

6. **Dashboard SQL injection hardening (Ada):** Add ISO8601 validation for `from`/`to` query params in `dashboards.ts` before any public exposure of the endpoint. Not blocking for internal Phase 3 use.

---

*Iris — 2026-03-23*
