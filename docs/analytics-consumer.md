# codeVolve — Analytics Event Consumer

> This document specifies the Kinesis → ClickHouse analytics consumer pipeline.

---

## 1. Overview

The analytics consumer is a Lambda function triggered by the Kinesis `codevolve-events` stream.
It batches incoming records and writes them to the `analytics_events` table in ClickHouse.

---

## 2. Consumer Architecture

```
Kinesis Data Stream (codevolve-events)
  └── Lambda (codevolve-analytics-consumer)
        ├── Batch: up to 100 records
        ├── Deserialize + validate each record
        ├── Deduplicate by event_id (§5.2)
        └── Batch-insert to ClickHouse analytics_events table
```

---

## 3. Kinesis Trigger Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Batch size | 100 | Matches POST /events limit; avoids oversized ClickHouse batches |
| Parallelization factor | 1 | Preserve shard ordering for session-level analytics |
| Starting position | TRIM_HORIZON on first deploy | Replay any events emitted before consumer was active |
| Bisect on error | true | Isolate poison-pill records to the DLQ rather than blocking the whole shard |
| Maximum retry attempts | 3 | After 3 failures, route to DLQ |
| Destination on failure | SQS (codevolve-analytics-dlq) | Dead-letter queue for manual inspection and replay |

---

## 4. ClickHouse Table Schema

```sql
CREATE TABLE analytics_events (
    event_id     String,        -- dedup key (§5.2)
    event_type   Enum8('resolve' = 1, 'execute' = 2, 'validate' = 3, 'fail' = 4, 'archive' = 5, 'unarchive' = 6),
    timestamp    DateTime64(3),
    skill_id     String,        -- "null" sentinel when field is null (§5.2)
    intent       String,        -- "null" sentinel when field is null (§5.2)
    latency_ms   Float64,
    confidence   Float64,       -- -1.0 when field is null
    cache_hit    UInt8,         -- 0 or 1
    input_hash   String,        -- "null" sentinel when field is null (§5.2)
    success      UInt8          -- 0 or 1
) ENGINE = ReplacingMergeTree()
ORDER BY (event_type, timestamp, event_id);
```

`ReplacingMergeTree` deduplicates rows with the same `event_id` during compaction,
providing eventual idempotency for replayed Kinesis records.

---

## 5. Idempotency

### 5.1 Why idempotency is required

Kinesis guarantees at-least-once delivery. A Lambda invocation may be retried after
partial success. Without deduplication, retried invocations would insert duplicate rows
into ClickHouse, corrupting aggregation results (e.g., execution counts, cache hit rates).

### 5.2 Event ID sentinel specification

Each event is assigned a deterministic `event_id` computed from a canonical hash of:

```
SHA-256("{event_type}|{timestamp}|{skill_id}|{intent}|{input_hash}")
```

**Null field sentinel: `"null"` (the string literal)**

When any of `skill_id`, `intent`, or `input_hash` is null in the source event,
the string literal `"null"` is substituted before hashing.

This sentinel is **not** an empty string `""`.

Rationale: An empty string is a valid non-null value for `intent` (an agent may
submit an empty intent). Using `""` as the null sentinel would produce the same
hash for `intent = null` and `intent = ""`, breaking deduplication correctness.
The string `"null"` cannot be a valid UUID (skill_id), a valid non-empty intent,
or a valid input_hash (hex string), making it unambiguous as a null placeholder.

Implementation: `src/analytics/eventId.ts` — the `NULL_FIELD_SENTINEL` constant
and `computeEventId()` function are the canonical implementation. Do not change
the sentinel without a coordinated migration of the ClickHouse `event_id` column.

### 5.3 Deduplication mechanism

- **Short-term (seconds to minutes):** The consumer checks for an existing
  `event_id` in ClickHouse before inserting. If found, skip the insert.
- **Long-term (hours to days):** `ReplacingMergeTree` deduplicates during
  background compaction. Both mechanisms are needed: the pre-insert check
  handles the hot path; the engine-level dedup handles edge cases where the
  pre-insert check races with a concurrent insert.

---

## 6. Error Handling

| Error type | Behavior |
|------------|----------|
| Invalid JSON record | Log and skip (do not fail the batch) |
| Zod validation failure | Log and skip; emit a structured warning |
| ClickHouse insert timeout | Retry up to 3 times with exponential backoff; if still failing, throw to trigger Lambda retry |
| ClickHouse connection error | Throw immediately — Kinesis will retry the batch |
| Duplicate event_id | Skip insert (idempotent) |
| DLQ full | CloudWatch alarm; manual intervention required |

---

## 7. Monitoring

| Metric | CloudWatch Alarm |
|--------|-----------------|
| Consumer Lambda error rate > 1% (5min) | Critical |
| Consumer Lambda iterator age > 60s | Warning (consumer falling behind) |
| DLQ message count > 0 | Warning |
| ClickHouse insert latency p95 > 500ms | Warning |
