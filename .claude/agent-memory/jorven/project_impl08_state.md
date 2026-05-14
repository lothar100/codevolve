---
name: project_impl08_state
description: IMPL-08 analytics consumer plan (2026-03-22): key design decisions, ADR-008, file locations, open items for Ada
type: project
---

## IMPL-08: Kinesis → ClickHouse Analytics Consumer (planned 2026-03-22)

### Status
Plan written. Awaiting Ada implementation. Not yet reviewed by Iris.

### Key decisions made

1. **ClickHouse Cloud** (hosted, managed) — not self-hosted EC2. Free tier adequate for Phase 3.
2. **ReplacingMergeTree with SHA-256 `event_id`** — idempotent writes. event_id = SHA-256(skill_id|event_type|timestamp|input_hash).
3. **SQS Standard Queue DLQ** (`codevolve-analytics-consumer-dlq`) — alert mechanism, 14-day retention, CloudWatch alarm on depth > 0.
4. **Bisect-on-batch-item-failure** — Kinesis event source mapping config, batchSize 100, maxBatchingWindow 5s, retryAttempts 3.
5. **`LowCardinality(String)` for event_type** — not Enum8 (avoids TS/CH client type friction). All DESIGN-02 queries work unchanged.
6. **90-day TTL** on analytics_events table. Matches archive policy default.

### Files produced
- `docs/analytics-consumer.md` — full architecture spec (this is Ada's implementation source of truth)
- ADR-008 appended to `docs/decisions.md`
- `tasks/todo.md` — IMPL-08 table row updated, sub-tasks A-E added under Phase 3

### ADR recorded
ADR-008 in `docs/decisions.md` — covers ClickHouse Cloud vs EC2, ReplacingMergeTree idempotency, SQS DLQ choice.

### ClickHouse DDL highlights
- Table: `codevolve.analytics_events`
- Engine: `ReplacingMergeTree(event_id)`
- ORDER BY: `(event_type, toDate(timestamp), skill_id, event_id)`
- PARTITION BY: `toYYYYMM(timestamp)`
- TTL: `toDate(timestamp) + INTERVAL 90 DAY`
- init script: `scripts/clickhouse-init.sql`

### Lambda config
- Name: `codevolve-analytics-consumer`
- Entry: `src/analytics/consumer.ts` — `handler(event: KinesisStreamEvent): Promise<KinesisStreamBatchResponse>`
- Memory: 512 MB, Timeout: 60s, Runtime: NODEJS_22_X
- Client: `@clickhouse/client` (add to package.json dependencies)
- Secrets: `codevolve/clickhouse-credentials` in Secrets Manager (`CLICKHOUSE_SECRET_ARN` env var)

### Sub-task order
- A + B: parallel (ClickHouse setup + CDK scaffold)
- C: depends on A+B (parsing + event_id)
- D: depends on C (ClickHouse client + insert)
- E: depends on D (E2E deploy + smoke test)

### Open items for Ada
- Create `codevolve/clickhouse-credentials` secret manually (not via CDK — password must not be in git)
- Add `@clickhouse/client` to package.json before IMPL-08-C begins
- Export `_setClickHouseClientForTesting(client)` from `clickhouseClient.ts` for test injection
- Grant `clickhouseSecret.grantRead(decisionEngineFn)` in CDK alongside consumer grant (deferred from IMPL-10)

### Unblocks
- IMPL-09 (dashboard API endpoints — read from ClickHouse)
- IMPL-10 Phase 3 ClickHouse mode (set `decision_engine.use_clickhouse = true` in codevolve-config after E)
