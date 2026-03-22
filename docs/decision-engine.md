# codeVolve — Decision Engine Architecture

> Authored by Jorven. Design ID: ARCH-07. Ada implements IMPL-10 directly from this document.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Scheduling](#2-scheduling)
3. [Analytics Data Source Strategy](#3-analytics-data-source-strategy)
4. [Rule Logic](#4-rule-logic)
   - 4.1 Rule 1: Auto-Cache Trigger
   - 4.2 Rule 2: Optimization Flag
   - 4.3 Rule 3: Gap Detection → GapQueue
   - 4.4 Rule 4: Archive Evaluation → ArchiveQueue
5. [SQS Queue Design](#5-sqs-queue-design)
6. [CDK Resources](#6-cdk-resources)
7. [Implementation Plan for IMPL-10](#7-implementation-plan-for-impl-10)
8. [Operational Notes](#8-operational-notes)

---

## 1. Overview

The Decision Engine is a scheduled Lambda function that reads analytics data and writes back to the primary system. It never runs on the request path — it has zero impact on the latency of any API endpoint.

Each invocation evaluates four rules in sequence:

| Rule | Trigger Condition | Action |
|------|------------------|--------|
| Auto-Cache | `execution_count >= 50 AND input_repeat_rate >= 0.30` | `UpdateItem codevolve-skills SET auto_cache = true` |
| Optimization Flag | `latency_p95_ms > 5000 AND execution_count >= 20` | `UpdateItem codevolve-skills SET needs_optimization = true` |
| Gap Detection | Unresolved `resolve` events with `success = false`, deduplicated per 24h | Enqueue to `codevolve-gap-queue` (SQS FIFO) |
| Archive Evaluation | Per `docs/archive-policy.md` thresholds; gated to once per 24h | Enqueue to `codevolve-archive-queue` (SQS Standard) |

All rule logic is idempotent. Running the Decision Engine twice within a short window produces the same outcome as running it once.

```
EventBridge (rate: 5 minutes)
        │
        └── codevolve-decision-engine (Lambda, Node 22)
                │
                ├── Rule 1 & 2: Read codevolve-skills (DynamoDB scan via GSI)
                │       └── UpdateItem on matching skills
                │
                ├── Rule 3: Read analytics events (DynamoDB or ClickHouse)
                │       └── SendMessage → codevolve-gap-queue (SQS FIFO)
                │
                └── Rule 4: Gate on last_archive_evaluation timestamp
                        └── SendMessage → codevolve-archive-queue (SQS Standard)
```

---

## 2. Scheduling

### 2.1 EventBridge Rule

**Type:** Rate-based schedule (not cron).

**Rate:** `rate(5 minutes)`

**Rationale:** See ADR-007. A rate-based rule has no timezone dependency, is easier to audit in the AWS Console, and starts on deploy without requiring clock alignment. The 5-minute cadence is the operative window for auto-cache and optimization flags; archive evaluation is self-gated to 24 hours by internal logic (Section 4.4.1).

**EventBridge rule name:** `codevolve-decision-engine-schedule`

**Target:** `codevolve-decision-engine` Lambda ARN.

### 2.2 Overlapping Execution Handling

The Lambda timeout is set to **4 minutes** (240 seconds). The EventBridge schedule fires every 5 minutes. This gives a 1-minute gap between the maximum duration of one invocation and the start of the next, preventing true overlap under normal conditions.

**Why not a DynamoDB lock?** A distributed lock (conditional write, check-then-release) adds complexity, a failure mode (stale lock if the Lambda crashes), and write cost. The Decision Engine rules are all idempotent — a double-fire produces at most a duplicate SQS message, which SQS deduplication (FIFO queue for GapQueue) or idempotent archive handler logic will absorb. The cost of a rare double-fire is lower than the operational cost of a lock mechanism.

**If a real execution spike causes overlapping invocations:** Lambda reserved concurrency is set to 1 on the Decision Engine function. When a new invocation arrives while one is running, Lambda throttles it rather than running two copies concurrently. The throttled invocation is retried automatically by EventBridge (EventBridge retries on throttle up to 24 hours). The result is that the Decision Engine never runs concurrently with itself.

**CDK configuration:** Set `reservedConcurrentExecutions: 1` on the Decision Engine Lambda.

---

## 3. Analytics Data Source Strategy

### 3.1 Phase 2 (ClickHouse not yet live)

In Phase 2, `codevolve-skills` DynamoDB records carry denormalized counters maintained by the `/execute` Lambda:

- `execution_count` (N) — total lifetime executions (runner invocations only, not cache hits)
- `latency_p50_ms` (N) — exponential moving average of p50 latency
- `latency_p95_ms` (N) — exponential moving average of p95 latency
- `last_executed_at` (S) — ISO 8601 timestamp of most recent execution

The Decision Engine reads these fields directly from DynamoDB for Rules 1 and 2.

Rule 3 (gap detection) in Phase 2 reads `resolve` events from DynamoDB. A lightweight gap-tracking table (`codevolve-gap-log`) is introduced to record unresolved resolve attempts, because `codevolve-skills` does not store resolve events. See Section 4.3.1 for the gap-log table design.

Rule 4 (archive evaluation) combines DynamoDB fields (grace period, confidence, execution_count, last_executed_at) and a ClickHouse query for the failure rate trigger. In Phase 2, the failure rate trigger is **skipped** if ClickHouse is not reachable; the other three triggers (staleness, low confidence, zero usage) use DynamoDB data only and remain operational.

### 3.2 Phase 3 (ClickHouse live, IMPL-08 complete)

When IMPL-08 is deployed and ClickHouse is receiving events, the Decision Engine migrates its data sources as follows:

| Rule | Phase 2 Data Source | Phase 3 Data Source |
|------|--------------------|--------------------|
| Auto-Cache: execution_count | DynamoDB `codevolve-skills.execution_count` | ClickHouse query (authoritative) |
| Auto-Cache: input_repeat_rate | DynamoDB `codevolve-gap-log` (proxy) | ClickHouse query (authoritative) |
| Optimization Flag | DynamoDB `codevolve-skills.latency_p95_ms` | ClickHouse percentile query (authoritative) |
| Gap Detection | DynamoDB `codevolve-gap-log` | ClickHouse query on `resolve` events |
| Archive: failure rate trigger | Skipped (Phase 2) | ClickHouse query (enabled in Phase 3) |

The migration is feature-flagged: set `decision_engine.use_clickhouse = true` in `codevolve-config` when IMPL-08 is confirmed stable. The Lambda reads this flag at invocation time. No redeployment required.

### 3.3 ClickHouse Queries (Phase 3 Reference)

The following queries are what the Decision Engine runs against ClickHouse in Phase 3. They are specified here so IMPL-10 can implement the query layer even if ClickHouse is not yet live; the queries are exercised against a ClickHouse mock in tests.

**Query A — execution count and input repeat rate per skill (last 30 days):**

```sql
SELECT
    skill_id,
    COUNT(*) AS execution_count_30d,
    COUNT(DISTINCT input_hash) AS unique_inputs_30d,
    COUNT(*) / NULLIF(COUNT(DISTINCT input_hash), 0) AS repeat_ratio,
    1.0 - (COUNT(DISTINCT input_hash) / NULLIF(COUNT(*), 0)) AS input_repeat_rate
FROM analytics_events
WHERE event_type = 'execute'
  AND success = true
  AND timestamp >= NOW() - INTERVAL 30 DAY
GROUP BY skill_id
HAVING COUNT(*) >= 50
ORDER BY input_repeat_rate DESC
```

Note: `input_repeat_rate` = 1 - (unique_inputs / total_executions). If 60 out of 100 executions share the same input_hash, input_repeat_rate = 0.40.

**Query B — latency p95 per skill (last 7 days):**

```sql
SELECT
    skill_id,
    quantile(0.95)(latency_ms) AS latency_p95_ms,
    COUNT(*) AS execution_count_7d
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp >= NOW() - INTERVAL 7 DAY
GROUP BY skill_id
HAVING COUNT(*) >= 20
ORDER BY latency_p95_ms DESC
```

**Query C — unresolved resolve events (last 24 hours):**

```sql
SELECT
    intent,
    MIN(confidence) AS min_confidence,
    COUNT(*) AS miss_count,
    MIN(timestamp) AS first_seen,
    MAX(timestamp) AS last_seen
FROM analytics_events
WHERE event_type = 'resolve'
  AND success = false
  AND timestamp >= NOW() - INTERVAL 24 HOUR
GROUP BY intent
ORDER BY miss_count DESC
LIMIT 10
```

**Query D — failure rate per skill (last 30 days):**

```sql
SELECT
    skill_id,
    countIf(success = false) / NULLIF(COUNT(*), 0) AS failure_rate,
    COUNT(*) AS execution_count_30d
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp >= NOW() - INTERVAL 30 DAY
GROUP BY skill_id
HAVING COUNT(*) >= 10
  AND (countIf(success = false) / NULLIF(COUNT(*), 0)) > 0.80
```

---

## 4. Rule Logic

### 4.1 Rule 1: Auto-Cache Trigger

**Purpose:** Identify skills where a meaningful proportion of callers submit the same inputs repeatedly. These skills benefit from caching because the cache hit rate will be high, amortizing the cache write cost across many cache hits.

#### 4.1.1 Thresholds

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| `execution_count` | >= 50 | 50 executions is a statistically meaningful sample. Below 50, the repeat rate estimate is noisy and cache writes may be wasted. |
| `input_repeat_rate` | >= 0.30 | If 30% or more of executions share an input, cache hits will recover the write cost within a few cycles. 30% is conservative — many skills will have higher repeat rates in practice. |

**input_repeat_rate definition:** `1 - (distinct_input_hashes / total_executions)`. A rate of 0.30 means at least 30% of executions share an input with at least one other execution.

#### 4.1.2 Phase 2 Data Source

In Phase 2, `execution_count` is read from `codevolve-skills.execution_count` (DynamoDB). `input_repeat_rate` is approximated from the `codevolve-gap-log` table's `input_hash` diversity column. This approximation is coarse — the gap-log is not designed for this purpose. The Phase 2 behavior is: if `execution_count >= 50`, set `auto_cache = true` without checking `input_repeat_rate`. The repeat rate check is fully enforced in Phase 3 via ClickHouse.

This conservative Phase 2 behavior means more skills may receive `auto_cache = true` than strictly necessary, causing some extra cache writes in `/execute`. This is acceptable — a slightly over-eager cache is preferable to a missed cache for high-traffic skills.

#### 4.1.3 DynamoDB Query

```
Table: codevolve-skills
Index: GSI-status-updated
Key condition: status IN ('verified', 'optimized', 'partial')
Filter: execution_count >= 50 AND auto_cache <> true
```

The filter `auto_cache <> true` prevents redundant writes to skills that are already flagged.

#### 4.1.4 DynamoDB Write

```
Operation: UpdateItem
Table: codevolve-skills
Key: { skill_id, version_number }
UpdateExpression: SET auto_cache = :true, auto_cache_set_at = :now
ExpressionAttributeValues: { ':true': true, ':now': ISO8601 }
ConditionExpression: attribute_not_exists(auto_cache) OR auto_cache = :false
```

The `ConditionExpression` makes the write idempotent — if another invocation already wrote `auto_cache = true`, the condition fails silently (catch `ConditionalCheckFailedException` and continue).

#### 4.1.5 SQS Message

None. Rule 1 writes directly to DynamoDB.

#### 4.1.6 No TTL Reset

`auto_cache` is a persistent flag. The Decision Engine does not unset it. If a skill's repeat rate drops below threshold, the cache entries will simply not receive hits and will expire via TTL. A future enhancement (Phase 5) could have the Decision Engine unset `auto_cache` when repeat rate drops below a lower bound (e.g., 0.10), but this is out of scope for IMPL-10.

---

### 4.2 Rule 2: Optimization Flag

**Purpose:** Surface high-traffic skills with poor latency for human or agent review. The Decision Engine does not fix skills — it marks them for attention by the `/evolve` pipeline or a human operator.

#### 4.2.1 Thresholds

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| `latency_p95_ms` | > 5000 ms | 5 seconds is the upper bound for acceptable algorithmic execution. Skills taking longer than 5 seconds at p95 are either computationally inefficient or handling unexpectedly large inputs. |
| `execution_count` | >= 20 | Requires sufficient execution history before flagging. At fewer than 20 executions, latency estimates are unreliable. |

#### 4.2.2 Phase 2 Data Source

`latency_p95_ms` is the exponential moving average maintained by `/execute` on the skill record (DynamoDB). In Phase 2, this approximation is used directly. In Phase 3, the Decision Engine uses ClickHouse Query B (Section 3.3) for a true p95 over a 7-day window.

#### 4.2.3 DynamoDB Query

```
Table: codevolve-skills
Index: GSI-status-updated
Key condition: status IN ('verified', 'optimized')
Filter: latency_p95_ms > 5000 AND execution_count >= 20 AND needs_optimization <> true
```

The filter `needs_optimization <> true` prevents redundant updates.

#### 4.2.4 DynamoDB Write

```
Operation: UpdateItem
Table: codevolve-skills
Key: { skill_id, version_number }
UpdateExpression: SET needs_optimization = :true, optimization_flagged_at = :now
ExpressionAttributeValues: { ':true': true, ':now': ISO8601 }
ConditionExpression: attribute_not_exists(needs_optimization) OR needs_optimization = :false
```

Idempotent via `ConditionExpression` (same pattern as Rule 1).

#### 4.2.5 How This Flag Is Consumed

The `needs_optimization` flag appears on the Evolution/Gap dashboard (Dashboard 4 per `docs/platform-design.md`). Operators can sort by this flag to identify skills requiring attention. The `/evolve` pipeline (IMPL-12) is responsible for consuming this flag and generating improved implementations. The Decision Engine does not directly invoke `/evolve` for optimization candidates — it only flags; `/evolve` is triggered by human action or by a separate future rule.

#### 4.2.6 SQS Message

None. Rule 2 writes directly to DynamoDB.

#### 4.2.7 Clearing the Flag

`needs_optimization` is cleared by the `/validate` Lambda when a new skill version passes validation with `latency_p95_ms <= 5000`. This is not implemented in the Decision Engine — it is a responsibility of IMPL-11 (`/validate`).

---

### 4.3 Rule 3: Gap Detection → GapQueue

**Purpose:** Detect unresolved resolve attempts (intents that did not match any skill with confidence >= 0.70) and queue them for the `/evolve` pipeline to generate new skills.

#### 4.3.1 Phase 2 Gap Log Table

Because ClickHouse is not live in Phase 2, resolve events with `success = false` must be tracked in DynamoDB. A lightweight table tracks these gaps:

**Table name:** `codevolve-gap-log`

| Attribute | DynamoDB Type | Description |
|-----------|---------------|-------------|
| `intent_hash` | S (PK) | SHA-256 hex of the normalized intent string. Deduplication key. |
| `intent` | S | The original intent string. |
| `first_seen_at` | S | ISO 8601. When this intent first failed to resolve. |
| `last_seen_at` | S | ISO 8601. Updated on every new failure for the same intent. |
| `miss_count` | N | Total times this intent has failed to resolve. |
| `min_confidence` | N | Lowest confidence score seen for this intent. |
| `last_evolve_queued_at` | S | ISO 8601. When this intent was last sent to GapQueue. Null if never. |
| `ttl` | N | Unix epoch seconds. Auto-expire after 7 days of no new occurrences. |

**Who writes to `codevolve-gap-log`:** The `/resolve` Lambda (IMPL-05). When a resolve attempt returns `success = false` (confidence below threshold or no match), `/resolve` writes or updates an item in `codevolve-gap-log` via `UpdateItem` with `ADD miss_count :one` and `SET last_seen_at = :now`. This write is fire-and-forget.

**Who reads from `codevolve-gap-log`:** The Decision Engine (Rule 3). This is the only reader.

**Why not read from Kinesis directly?** The Decision Engine runs on a schedule, not as a stream consumer. Reading from Kinesis requires a shard iterator and stateful offset management — not appropriate for a scheduled Lambda. The gap-log table is a simple, queryable intermediary.

#### 4.3.2 Query

```
Table: codevolve-gap-log
Operation: Scan with filter
Filter:
  last_seen_at >= (NOW - 24 hours)
  AND (last_evolve_queued_at is NULL OR last_evolve_queued_at < (NOW - 24 hours))
Limit: 10
```

The 24-hour deduplication window prevents the same intent from being sent to `/evolve` more than once per day. The limit of 10 per run is enforced at the query level, not by discarding results — do not query more than 10 and discard the rest.

**Sort order:** DynamoDB Scan does not guarantee order. After reading up to 10 qualifying items, sort client-side by `min_confidence ASC` (lowest confidence first — most urgent gaps first). Process them in this order.

#### 4.3.3 SQS Message

**Queue:** `codevolve-gap-queue` (FIFO, see Section 5.1)

**Message body:**

```json
{
  "intent": "string — the original intent that failed to resolve",
  "resolve_confidence": 0.45,
  "timestamp": "ISO8601 — when this gap was detected (use last_seen_at from gap-log)",
  "original_event_id": "string — intent_hash from gap-log (used as stable reference)"
}
```

**MessageDeduplicationId:** `{intent_hash}_{date_YYYYMMDD}` — prevents duplicate messages for the same intent on the same calendar day. This is the FIFO queue's built-in deduplication mechanism; no additional DynamoDB check is needed.

**MessageGroupId:** `"gap"` — all gap messages go to the same group. The `/evolve` consumer (IMPL-12) processes messages sequentially within the group.

#### 4.3.4 DynamoDB Write After Enqueue

After successfully sending the SQS message, update the gap-log record:

```
Operation: UpdateItem
Table: codevolve-gap-log
Key: { intent_hash }
UpdateExpression: SET last_evolve_queued_at = :now
ExpressionAttributeValues: { ':now': ISO8601 }
```

This update prevents the same intent from being re-queued until the next 24-hour window.

#### 4.3.5 Throttle

Maximum 10 gap intents per Decision Engine run. This is enforced by the `Limit: 10` on the DynamoDB query (Section 4.3.2). Do not process more than 10 gaps per invocation, regardless of how many are eligible. This prevents the Decision Engine from overwhelming the `/evolve` pipeline during a period of many simultaneous gaps (e.g., after a bulk skill deletion).

---

### 4.4 Rule 4: Archive Evaluation → ArchiveQueue

**Purpose:** Evaluate active skills and problems against archive thresholds defined in `docs/archive-policy.md` and enqueue candidates for the Archive Handler Lambda (implemented in IMPL-04) to process.

#### 4.4.1 24-Hour Gate

Archive evaluation is expensive (scans all active skills, queries ClickHouse) and is only needed once per day. The Decision Engine gates Rule 4 behind a DynamoDB timestamp check.

**Gate implementation:**

1. At the start of each invocation, read the item `{ pk: "archive_eval", sk: "last_run" }` from a `codevolve-config` table (or use an attribute on an existing config record).
2. If `last_archive_evaluation` is missing or is more than 23 hours ago (to allow for slight schedule drift): run the evaluation and update `last_archive_evaluation` to the current time.
3. If `last_archive_evaluation` is within the last 23 hours: skip Rule 4 entirely and return immediately after Rules 1-3.

**Why 23 hours, not 24?** EventBridge rate-based schedules can drift slightly. A 23-hour window ensures the evaluation fires within each 24-hour day even with minor timing drift from the 5-minute schedule.

**Target evaluation time:** The Decision Engine evaluates near 04:00 UTC. To achieve this, the initial `last_archive_evaluation` value written at deploy time is set to the previous 04:00 UTC timestamp. Subsequent evaluations will naturally drift to near 04:00 UTC each day.

#### 4.4.2 Exemption Checks (applied before any threshold evaluation)

A skill is skipped if **any** of the following are true:

1. `status == "archived"` — already archived.
2. `is_canonical == true` — canonical skills are unconditionally exempt.
3. `evolve_in_progress == true` — actively being improved.
4. `created_at` within 30 days (`archive.grace_period_days`) — grace period.
5. `unarchived_at` within 14 days (`archive.unarchive_cooldown_days`) — anti-thrashing cooldown.

These are evaluated from the DynamoDB skill record without any ClickHouse query.

#### 4.4.3 Skill Archive Triggers

For each non-exempt skill, evaluate the following triggers in order. The first trigger that fires is sufficient to enqueue the skill — do not evaluate remaining triggers for the same skill.

**Trigger 1: Staleness**

```
Condition: (NOW - last_executed_at) > staleness_threshold_days
staleness_threshold = codevolve-config["archive.staleness_days"]  // default 90
                    → override to 365 if "seasonal" in skill.tags
                    → override to per-domain value if configured
Data source: codevolve-skills.last_executed_at (DynamoDB, Phase 2 and Phase 3)
```

Skills with no `last_executed_at` are treated as having been executed at `created_at` for staleness purposes. This avoids incorrectly flagging a skill that was never executed (that case is handled by Trigger 4: Zero Usage).

**Trigger 2: Low Confidence**

```
Condition: confidence < 0.30 AND execution_count >= 5
Data source: codevolve-skills.confidence + codevolve-skills.execution_count (DynamoDB)
```

Both conditions must be met. A skill with confidence 0.1 but only 2 executions is not flagged by this trigger.

**Trigger 3: High Failure Rate**

```
Condition (Phase 3 only): failure_rate > 0.80 AND execution_count_30d >= 10
Data source: ClickHouse Query D (Section 3.3)
Phase 2 behavior: skip this trigger if decision_engine.use_clickhouse != true
```

This trigger is explicitly disabled in Phase 2 to avoid false positives from the coarser DynamoDB-only data. In Phase 2, a broken skill will still be caught by the Low Confidence trigger (confidence drops as failures accumulate via `/validate`).

**Trigger 4: Zero Usage**

```
Condition: execution_count == 0 AND (NOW - created_at) > zero_usage_age_days
zero_usage_age_days = codevolve-config["archive.zero_usage_age_days"]  // default 60
Data source: codevolve-skills.execution_count + codevolve-skills.created_at (DynamoDB)
```

#### 4.4.4 Problem Archive Triggers

After evaluating skills, evaluate problems for archival. A problem is flagged for archival when:

```
Condition: zero resolve attempts in 90 days AND no active skills with confidence > 0.50
```

**How to check:** Query `GSI-problem-status` for the problem to count non-archived skills with `confidence > 0.50`. If count == 0, and `last_resolve_at` on the problem record is more than 90 days ago (or null), enqueue the problem.

**`last_resolve_at` tracking:** The `/resolve` Lambda must write `last_resolve_at` to the matching problem record on every successful resolve. This is not currently specified in `docs/dynamo-schemas.md`. **Ada must add `last_resolve_at` (S, ISO 8601) to the `codevolve-problems` table schema as part of IMPL-10.** The field is set by `/resolve` (UpdateItem, fire-and-forget) and read by the Decision Engine.

#### 4.4.5 Per-Cycle Limit

The archive evaluation sends at most `archive.max_per_cycle` (default: 50) messages to `codevolve-archive-queue` per invocation. When the limit is reached:

1. Sort remaining candidates by severity: failure_rate DESC, then confidence ASC, then staleness DESC. Process the most critical first.
2. Stop enqueueing when the limit is reached.
3. Emit a CloudWatch metric `archive.candidates_deferred` with the count of candidates that were not processed.
4. The deferred candidates will be re-evaluated on the next cycle.

#### 4.4.6 Dry-Run Mode

If `codevolve-config["archive.dry_run"] == true`:

1. Run all evaluation logic identically.
2. Do not send any SQS messages to `codevolve-archive-queue`.
3. Write the evaluation results to `codevolve-archive-dry-run` DynamoDB table per the schema in `docs/archive-policy.md` §5.3.
4. Emit CloudWatch metric `archive.dry_run.would_archive_count`.

#### 4.4.7 SQS Message

**Queue:** `codevolve-archive-queue` (Standard, see Section 5.2)

**Message body:**

```json
{
  "target_type": "skill",
  "target_id": "uuid — skill_id or problem_id",
  "reason": "string — e.g. 'staleness_90d', 'low_confidence', 'high_failure_rate', 'zero_usage'",
  "triggered_at": "ISO8601"
}
```

**`reason` values:**

| Value | Trigger |
|-------|---------|
| `staleness_90d` | Staleness trigger (standard 90-day threshold) |
| `staleness_365d` | Staleness trigger (seasonal 365-day threshold) |
| `staleness_domain_{domain}` | Staleness trigger (per-domain override) |
| `low_confidence` | Confidence < 0.30 with >= 5 executions |
| `high_failure_rate` | > 80% failure rate over 30 days |
| `zero_usage` | 0 lifetime executions AND age > 60 days |
| `problem_no_active_skills` | Problem with no active high-confidence skills and no resolves in 90 days |

#### 4.4.8 High-Impact Archive Warning

When a skill with lifetime `execution_count > 100` is flagged for any archive trigger, emit a Kinesis event before enqueuing the SQS message:

```json
{
  "event_type": "archive_warning",
  "skill_id": "uuid",
  "execution_count": 142,
  "trigger": "low_confidence",
  "confidence": 0.18,
  "triggered_at": "ISO8601"
}
```

This surfaces on the Evolution/Gap dashboard and may trigger a CloudWatch alarm (configured separately by Amber in DESIGN-04).

---

## 5. SQS Queue Design

### 5.1 GapQueue — `codevolve-gap-queue`

| Property | Value |
|----------|-------|
| Queue name | `codevolve-gap-queue.fifo` |
| Type | FIFO |
| Content-based deduplication | Enabled |
| Visibility timeout | 300 seconds (5 minutes) — matches the `/evolve` Lambda processing time target |
| Message retention | 4 days (345600 seconds) — gaps older than 4 days are stale; new resolve events will re-create them if the intent recurs |
| Max message size | 256 KB (SQS default) |
| Delay | 0 seconds |

**Message schema:**

```json
{
  "intent": "string",
  "resolve_confidence": 0.45,
  "timestamp": "2026-03-21T04:05:00Z",
  "original_event_id": "sha256_hex_of_intent"
}
```

**MessageDeduplicationId:** `{intent_hash}_{YYYYMMDD}` (set by Decision Engine; prevents duplicate messages for the same intent on the same calendar day).

**MessageGroupId:** `"gap"` (all messages in one group; `/evolve` consumer processes sequentially).

**Dead-letter queue:** `codevolve-gap-queue-dlq.fifo` — FIFO DLQ required for FIFO source queue.

| DLQ Property | Value |
|--------------|-------|
| Max receive count | 3 (message moves to DLQ after 3 failed consumer attempts) |
| Retention | 14 days |
| CloudWatch alarm | Fire if DLQ depth > 0 |

**Consumer:** `/evolve` Lambda (IMPL-12). Processes messages from `codevolve-gap-queue.fifo`, generates skill implementation via Claude API, writes new skill to DynamoDB, triggers `/validate`.

### 5.2 ArchiveQueue — `codevolve-archive-queue`

| Property | Value |
|----------|-------|
| Queue name | `codevolve-archive-queue` |
| Type | Standard (not FIFO) |
| Visibility timeout | 60 seconds — the Archive Handler Lambda completes in < 30 seconds per message |
| Message retention | 24 hours (86400 seconds) — archive candidates are re-evaluated daily; stale messages need not persist longer |
| Max message size | 256 KB (SQS default) |
| Delay | 0 seconds |

**Message schema:**

```json
{
  "target_type": "skill",
  "target_id": "uuid",
  "reason": "staleness_90d",
  "triggered_at": "2026-03-21T04:05:00Z"
}
```

**Idempotency:** The Archive Handler (IMPL-04, `src/archive/archiveHandler.ts`) already handles duplicate archive requests by checking the current `status` field before writing. A duplicate SQS message for an already-archived skill results in a no-op. Standard queue delivery guarantees at-least-once, so the archive handler must be idempotent (it already is per REVIEW-05).

**Dead-letter queue:** `codevolve-archive-queue-dlq`

| DLQ Property | Value |
|--------------|-------|
| Max receive count | 3 |
| Retention | 7 days |
| CloudWatch alarm | `archive-dlq-nonempty` (per `docs/archive-policy.md` §6.3) |

**Consumer:** Archive Handler Lambda (already implemented in IMPL-04, `src/archive/archiveHandler.ts`). The Archive Handler's SQS event source mapping must be updated in CDK to point to this queue.

---

## 6. CDK Resources

All resources are added to `infra/codevolve-stack.ts`. The following table lists every new AWS resource required for IMPL-10.

### 6.1 New Lambda Function

| Property | Value |
|----------|-------|
| CDK logical ID | `DecisionEngineFn` |
| Function name | `codevolve-decision-engine` |
| Runtime | `NODEJS_22_X` |
| Memory | 512 MB |
| Timeout | 240 seconds (4 minutes) |
| Reserved concurrency | 1 |
| Entry point | `src/decision-engine/handler.ts` |

### 6.2 EventBridge Rule

| Property | Value |
|----------|-------|
| CDK logical ID | `DecisionEngineSchedule` |
| Rule name | `codevolve-decision-engine-schedule` |
| Schedule | `rate(5 minutes)` |
| Target | `DecisionEngineFn` ARN |
| Retry attempts | 2 (EventBridge default) |

### 6.3 SQS Queues

| CDK Logical ID | Queue Name | Type | Notes |
|---------------|------------|------|-------|
| `GapQueue` | `codevolve-gap-queue.fifo` | FIFO | New |
| `GapQueueDlq` | `codevolve-gap-queue-dlq.fifo` | FIFO DLQ | New |
| `ArchiveQueue` | `codevolve-archive-queue` | Standard | New (Archive Handler already exists; queue is new) |
| `ArchiveQueueDlq` | `codevolve-archive-queue-dlq` | Standard DLQ | New |

### 6.4 New DynamoDB Table

| CDK Logical ID | Table Name | PK | SK | Notes |
|---------------|------------|----|----|-------|
| `GapLogTable` | `codevolve-gap-log` | `intent_hash` (S) | — | New. See Section 4.3.1. TTL attribute: `ttl`. |

### 6.5 IAM Grants

**Decision Engine Lambda (`codevolve-decision-engine`) needs:**

| Grant | Resource | Operations |
|-------|----------|-----------|
| DynamoDB read | `codevolve-skills` | `Scan`, `Query`, `GetItem` |
| DynamoDB write | `codevolve-skills` | `UpdateItem` |
| DynamoDB read | `codevolve-gap-log` | `Scan`, `GetItem` |
| DynamoDB write | `codevolve-gap-log` | `UpdateItem`, `PutItem` |
| DynamoDB read | `codevolve-config` | `GetItem` |
| DynamoDB write | `codevolve-config` | `UpdateItem` (for `last_archive_evaluation`) |
| DynamoDB read/write | `codevolve-problems` | `Query` (for problem archive trigger), `UpdateItem` (last_resolve_at update not done here — `/resolve` does it) |
| DynamoDB write | `codevolve-archive-dry-run` | `PutItem` (dry-run mode only) |
| SQS send | `codevolve-gap-queue.fifo` | `SendMessage` |
| SQS send | `codevolve-archive-queue` | `SendMessage` |
| Kinesis write | `codevolve-events` stream | `PutRecord` (for archive_warning events) |
| CloudWatch | — | `PutMetricData` (for custom metrics) |
| Secrets Manager read | `codevolve/clickhouse-credentials` | `GetSecretValue` (Phase 3, when ClickHouse is live) |

**ClickHouse access (Phase 3):** ClickHouse is accessed via HTTPS from the Decision Engine Lambda. Credentials (host, port, username, password) are stored in AWS Secrets Manager under the path `codevolve/clickhouse-credentials`. The Decision Engine Lambda reads this secret at cold-start and caches it in the module scope. No VPC attachment is required — ClickHouse Cloud exposes a public HTTPS endpoint.

**Archive Handler Lambda (`codevolve-archive-handler`) — additional grant needed:**

The existing Archive Handler Lambda needs a new SQS event source mapping from `codevolve-archive-queue`. Add:

```typescript
archiveHandlerFn.addEventSource(new SqsEventSource(archiveQueue, {
  batchSize: 1,  // process one archive message at a time to avoid partial batch failures
}));
```

**`/resolve` Lambda — additional grant needed:**

The existing `/resolve` Lambda (IMPL-05) needs DynamoDB `UpdateItem` on `codevolve-gap-log` and `codevolve-problems` (for `last_resolve_at`). This is specified here so CDK grants are not missed when IMPL-05 is implemented.

---

## 7. Implementation Plan for IMPL-10

IMPL-10 is broken into five independently implementable sub-tasks. Each sub-task has a clear file scope and verification method. All sub-tasks share the same Decision Engine Lambda handler entry point at `src/decision-engine/handler.ts`.

### Sub-task A: EventBridge + CDK Scaffold

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `infra/codevolve-stack.ts`, `src/decision-engine/handler.ts` (stub), `src/decision-engine/index.ts` |
| Depends on | Phase 2 complete (IMPL-05, IMPL-06, IMPL-07) |

**Scope:**
1. Add `codevolve-gap-log` DynamoDB table to CDK stack with TTL attribute.
2. Add `codevolve-gap-queue.fifo` and DLQ to CDK stack.
3. Add `codevolve-archive-queue` and DLQ to CDK stack.
4. Add `codevolve-archive-dry-run` DynamoDB table to CDK stack.
5. Define `DecisionEngineFn` Lambda in CDK with all IAM grants from Section 6.5.
6. Define `DecisionEngineSchedule` EventBridge rule targeting `DecisionEngineFn`.
7. Add `SqsEventSource` mapping from `codevolve-archive-queue` to `archiveHandlerFn`.
8. Write a stub `handler.ts` that logs the invocation event and returns without doing anything.

**Verification:** `npx cdk synth` exits 0. Template contains `DecisionEngineFn`, `DecisionEngineSchedule`, `GapQueue`, `ArchiveQueue`, `GapLogTable`. No TypeScript errors.

### Sub-task B: Rule 1 — Auto-Cache Trigger

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `src/decision-engine/rules/autoCache.ts`, `tests/unit/decision-engine/autoCache.test.ts` |
| Depends on | IMPL-10-A |

**Scope:**
1. Implement `evaluateAutoCache(dynamoClient)` function that queries `GSI-status-updated` for skills with `execution_count >= 50` and `auto_cache <> true`.
2. For each matching skill, issue `UpdateItem` with `auto_cache = true` and `auto_cache_set_at`.
3. Handle `ConditionalCheckFailedException` silently.
4. Unit tests: mock DynamoDB client; test that `UpdateItem` is called for matching skills; test that already-flagged skills are skipped; test idempotency.

**Verification:** `npx jest tests/unit/decision-engine/autoCache.test.ts` passes.

### Sub-task C: Rule 2 — Optimization Flag

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `src/decision-engine/rules/optimizationFlag.ts`, `tests/unit/decision-engine/optimizationFlag.test.ts` |
| Depends on | IMPL-10-A |

**Scope:**
1. Implement `evaluateOptimizationFlag(dynamoClient)` function that queries `GSI-status-updated` for skills with `latency_p95_ms > 5000`, `execution_count >= 20`, `needs_optimization <> true`.
2. For each matching skill, issue `UpdateItem` with `needs_optimization = true` and `optimization_flagged_at`.
3. Handle `ConditionalCheckFailedException` silently.
4. Unit tests: mock DynamoDB; test threshold boundary conditions (exactly 5000ms, exactly 20 executions); test idempotency.

**Verification:** `npx jest tests/unit/decision-engine/optimizationFlag.test.ts` passes.

### Sub-task D: Rule 3 — Gap Detection

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `src/decision-engine/rules/gapDetection.ts`, `tests/unit/decision-engine/gapDetection.test.ts` |
| Depends on | IMPL-10-A |

**Scope:**
1. Implement `evaluateGapDetection(dynamoClient, sqsClient)` function.
2. Scan `codevolve-gap-log` for items where `last_seen_at >= (NOW - 24h)` AND (`last_evolve_queued_at` is null OR `< (NOW - 24h)`). Apply Limit: 10.
3. Sort results client-side by `min_confidence ASC`.
4. For each item, send SQS message to `codevolve-gap-queue.fifo` with `MessageDeduplicationId` and `MessageGroupId`.
5. After successful SQS send, update `last_evolve_queued_at` in `codevolve-gap-log`.
6. Unit tests: mock DynamoDB and SQS; test 24-hour deduplication logic; test 10-item throttle; test sort order; test that `last_evolve_queued_at` is updated after send.

**Verification:** `npx jest tests/unit/decision-engine/gapDetection.test.ts` passes.

### Sub-task E: Rule 4 — Archive Evaluation

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `src/decision-engine/rules/archiveEvaluation.ts`, `tests/unit/decision-engine/archiveEvaluation.test.ts` |
| Depends on | IMPL-10-A |

**Scope:**
1. Implement `evaluateArchive(dynamoClient, sqsClient, configClient)` function.
2. Check `last_archive_evaluation` from `codevolve-config`; skip if within last 23 hours.
3. Query all non-archived skills via `GSI-status-updated`.
4. For each skill, check exemptions (Section 4.4.2), then evaluate triggers (Section 4.4.3) in order.
5. Enforce `archive.max_per_cycle` limit (default 50). Sort candidates by severity before truncating.
6. For each candidate (within limit), send SQS message to `codevolve-archive-queue`.
7. Emit Kinesis `archive_warning` event for skills with `execution_count > 100`.
8. Handle dry-run mode: write to `codevolve-archive-dry-run` instead of SQS when `archive.dry_run == true`.
9. Update `last_archive_evaluation` timestamp in `codevolve-config` after run completes.
10. Unit tests: test each trigger condition independently; test exemptions (canonical, grace period, evolve_in_progress, cooldown); test per-cycle limit and priority sort; test dry-run mode writes to dry-run table and not to SQS; test 23-hour gate (skip when recent, run when stale).

**Note for Ada:** The failure rate trigger (Trigger 3) must be stubbed in Phase 2 behind the `decision_engine.use_clickhouse` feature flag. Implement the flag check and stub; the ClickHouse query implementation is deferred to Phase 3.

**Verification:** `npx jest tests/unit/decision-engine/archiveEvaluation.test.ts` passes.

### IMPL-10 Completion Gate

All five sub-tasks are complete when ALL of the following pass:

1. `npx tsc --noEmit` — exits 0, no TypeScript errors.
2. `npx jest tests/unit/decision-engine/` — all Decision Engine unit tests pass.
3. `npx cdk synth` — exits 0. Template contains `DecisionEngineFn`, `DecisionEngineSchedule`, `GapQueue`, `ArchiveQueue`, `GapLogTable`.
4. Manual verification: deploy to dev environment, trigger the Lambda manually (`aws lambda invoke`), confirm CloudWatch logs show all four rules executed and correct DynamoDB/SQS writes occurred.
5. REVIEW-08 (Iris): review rule logic, archive trigger safety, gap detection accuracy.

---

## 8. Operational Notes

### 8.1 Monitoring

| CloudWatch Metric | Source | Alert Condition |
|------------------|--------|-----------------|
| `decision_engine.invocations` | Lambda metrics | None (informational) |
| `decision_engine.errors` | Lambda metrics | > 0 in 15 minutes |
| `decision_engine.duration_ms` | Lambda metrics | > 230,000 ms (approaching 4-minute timeout) |
| `archive.candidates_deferred` | Custom metric | > 0 (skills were deferred due to per-cycle limit) |
| `archive.dry_run.would_archive_count` | Custom metric | > 0 when dry_run=false (sanity check) |
| `gap_queue.depth` | SQS metrics | > 50 (queue backing up; `/evolve` may be slow or down) |
| `archive_queue.depth` | SQS metrics | > 100 (Archive Handler falling behind) |

### 8.2 Configuration Table Schema

The `codevolve-config` table is referenced throughout this document. Add these items to the table for the Decision Engine:

| `config_key` (PK) | Type | Default Value |
|-------------------|------|---------------|
| `decision_engine.use_clickhouse` | BOOL | false |
| `decision_engine.last_archive_evaluation` | S | (set at deploy time to prior 04:00 UTC) |
| `decision_engine.gap_detection_lookback_hours` | N | 24 |
| `decision_engine.gap_detection_max_per_run` | N | 10 |
| `decision_engine.auto_cache_min_executions` | N | 50 |
| `decision_engine.auto_cache_min_repeat_rate` | N | 0.30 |
| `decision_engine.optimization_flag_latency_threshold_ms` | N | 5000 |
| `decision_engine.optimization_flag_min_executions` | N | 20 |

Archive thresholds are documented separately in `docs/archive-policy.md` Appendix A.

### 8.3 Failure Modes

| Failure | Behavior | Recovery |
|---------|----------|---------|
| ClickHouse unreachable | Rules 1, 2, 4-partial, run on DynamoDB data; Rule 3 uses DynamoDB gap-log. Archive failure rate trigger is skipped. | Automatic on next invocation when ClickHouse recovers. |
| DynamoDB throttled | Lambda may fail mid-run. Next invocation retries. Rules 1 and 2 are idempotent — re-processing same skills causes no harm. | Automatic. |
| SQS send fails (GapQueue) | Individual gap item is not queued. Next invocation will attempt again (the 24-hour gate check uses `last_evolve_queued_at`, not a flag that was set on failure). | Automatic. |
| SQS send fails (ArchiveQueue) | Candidate is not enqueued. Next 24-hour evaluation will re-evaluate the candidate and re-attempt. | Automatic. |
| Lambda timeout (4 minutes) | Rules are evaluated in order: 1, 2, 3, 4. If timeout occurs mid-run, earlier rules will have completed; later rules may be partially complete. The archive gate (`last_archive_evaluation`) is only written after the full archive evaluation completes — if timeout occurs during archive evaluation, the gate is not updated and archive re-runs on the next invocation. | Automatic; may result in a double-run of partial rules, which is safe due to idempotency. |

---

*Last updated: 2026-03-21 — ARCH-07 initial design by Jorven*
