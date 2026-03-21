# codeVolve — Archive Mechanism Design

> Author: Jorven (ARCH-03). Consumers: Ada (IMPL-04), Amber (DESIGN-03).

---

## 1. Archive Triggers

Archival is evaluated by the **Decision Engine Lambda** (`decision-engine`), which runs on a 5-minute EventBridge schedule. Archive evaluation specifically runs on a **24-hour cadence** — the Decision Engine tracks the last archive evaluation timestamp in DynamoDB and skips archive logic if fewer than 24 hours have elapsed since the last run.

A skill is flagged for archival when **any** of the following conditions are met:

| Condition | Metric | Threshold | Source |
|-----------|--------|-----------|--------|
| **Staleness** | Days since last execution | > 90 days | ClickHouse: `MAX(timestamp) WHERE event_type = 'execute' AND skill_id = ?` |
| **Low confidence** | Current confidence score | < 0.3 | DynamoDB: `confidence` field on Skill record |
| **High failure rate** | Failure rate over last 30 days | > 80% (minimum 10 executions) | ClickHouse: `COUNT(success=false) / COUNT(*) WHERE event_type = 'execute' AND skill_id = ? AND timestamp > now() - 30d` |
| **Zero usage** | Total execution count (lifetime) | 0 executions AND skill age > 60 days | ClickHouse: `COUNT(*) WHERE event_type = 'execute' AND skill_id = ?` combined with DynamoDB `created_at` |

**Evaluation logic (pseudocode):**

```
for each skill in DynamoDB WHERE status != 'archived':
    metrics = query_analytics(skill.skill_id)

    should_archive = (
        metrics.days_since_last_execution > 90
        OR skill.confidence < 0.3
        OR (metrics.failure_rate_30d > 0.80 AND metrics.execution_count_30d >= 10)
        OR (metrics.lifetime_execution_count == 0 AND skill.age_days > 60)
    )

    if should_archive:
        send_to_archive_queue(skill.skill_id, triggered_by=matched_condition)
```

The Decision Engine never performs archival directly. It writes messages to the **SQS ArchiveQueue**, and the separate `archive-handler` Lambda processes them.

---

## 2. Data Flow

### 2.1 End-to-end archive flow

```
EventBridge (5-min schedule)
    │
    └── Decision Engine Lambda
            │  (runs archive evaluation every 24h)
            │  Reads: ClickHouse (metrics), DynamoDB (skill records)
            │
            ├── For each skill meeting archive thresholds:
            │       └── SQS ArchiveQueue.sendMessage({ skill_id, reason, timestamp })
            │
            └── (other duties: auto-cache, optimization flags, gap detection)

SQS ArchiveQueue
    │
    └── Archive Handler Lambda (triggered by SQS)
            │
            ├── 1. Read current skill from DynamoDB
            │       └── Guard: skip if already archived or currently executing
            │
            ├── 2. DynamoDB: update skill status to "archived"
            │       └── SET status = "archived", archived_at, archive_reason, previous_status
            │
            ├── 3. DynamoDB: set embedding to null (remove from /resolve similarity)
            │
            ├── 4. DynamoDB cache: invalidate all cached results for this skill_id
            │
            ├── 5. Kinesis: emit archive event
            │       └── { event_type: "archive", skill_id, reason, timestamp }
            │
            └── 6. Check if all skills for the parent problem are now archived
                    └── If yes: archive the problem (see Section 4)
```

### 2.2 Related data handling

| Data | Action on archive | Rationale |
|------|-------------------|-----------|
| Skill record (DynamoDB) | Update status, never delete | Core principle: archive is not deletion |
| Skill embedding (DynamoDB) | Set to null | Archived skills must not appear in `/resolve` similarity results |
| DynamoDB cache entries | Delete all entries for skill_id | Stale cache must not serve results for archived skills |
| ClickHouse/BigQuery events | No action — preserved forever | Hard rule: analytics are append-only, never deleted |
| Problem record | Archive only if ALL skills are archived | See Section 4 |

---

## 3. Skill Archival — Exact Operations

### 3.1 DynamoDB update

Table: `codevolve-skills`

```
UpdateExpression:
    SET #status = :archived,
        #archived_at = :now,
        #archive_reason = :reason,
        #previous_status = #status

ConditionExpression:
    #status <> :archived
    AND attribute_not_exists(#active_execution_lock)

ExpressionAttributeNames:
    #status       → "status"
    #archived_at  → "archived_at"
    #archive_reason → "archive_reason"
    #previous_status → "previous_status"
    #active_execution_lock → "active_execution_lock"

ExpressionAttributeValues:
    :archived → "archived"
    :now      → "2026-03-21T00:00:00Z"  (ISO8601 timestamp)
    :reason   → "staleness_90d | low_confidence | high_failure_rate | zero_usage"
```

The `previous_status` field stores the skill's status before archival (`unsolved`, `partial`, `verified`, or `optimized`). This is required for correct un-archive restoration.

### 3.2 Embedding removal

```
UpdateExpression:
    SET #embedding = :null

Table: codevolve-skills
Key: skill_id + version
```

This nullifies the skill's embedding vector. The `/resolve` endpoint skips skills with null embeddings during similarity computation, so the skill will no longer appear in resolve results.

### 3.3 Cache invalidation

```
Query codevolve-cache WHERE skill_id = {skill_id}
BatchWriteItem: delete all matching cache entries
```

### 3.4 Kinesis event emission

```json
{
    "event_type": "archive",
    "timestamp": "2026-03-21T00:00:00Z",
    "skill_id": "uuid",
    "problem_id": "uuid",
    "reason": "staleness_90d",
    "previous_status": "verified",
    "success": true
}
```

This event flows through the standard Kinesis pipeline into ClickHouse/BigQuery, providing an audit trail of all archive decisions.

---

## 4. Problem Archival

### 4.1 When a problem is archived

A problem is archived **only when ALL of its skills are archived**. Problems are never independently archived — they are a consequence of skill archival.

After each skill archival, the Archive Handler checks:

```
skills_for_problem = DynamoDB query(
    table: codevolve-skills,
    index: problem_id-index,
    KeyCondition: problem_id = {problem_id}
)

all_archived = every skill.status == "archived"

if all_archived:
    archive_problem(problem_id)
```

### 4.2 Problem archive DynamoDB update

Table: `codevolve-problems`

```
UpdateExpression:
    SET #status = :archived,
        #archived_at = :now

ConditionExpression:
    #status <> :archived
```

### 4.3 Mountain visualization

Archived problems are **hidden by default** in the mountain visualization. The visualization API filters by `status != "archived"` when building the mountain. A UI toggle allows users to show archived problems as "greyed-out bricks" at their original position.

### 4.4 Problem archive Kinesis event

```json
{
    "event_type": "archive",
    "timestamp": "2026-03-21T00:00:00Z",
    "problem_id": "uuid",
    "reason": "all_skills_archived",
    "success": true
}
```

---

## 5. Un-archive (Reversal)

### 5.1 API endpoint

`POST /skills/:id/unarchive`

This is a manual operation triggered via API. The Decision Engine does not automatically un-archive.

### 5.2 Un-archive flow

```
POST /skills/:id/unarchive
    │
    └── Archive Handler Lambda (invoked synchronously via API Gateway)
            │
            ├── 1. Read skill from DynamoDB
            │       └── Guard: reject if status != "archived"
            │
            ├── 2. DynamoDB: restore previous status
            │       └── SET status = previous_status, REMOVE archived_at, archive_reason
            │
            ├── 3. DynamoDB: regenerate embedding
            │       └── Generate embedding (invoke Bedrock Titan v2), store on skill record
            │
            ├── 4. Kinesis: emit unarchive event
            │       └── { event_type: "unarchive", skill_id, restored_status, timestamp }
            │
            └── 5. If parent problem is archived: auto-unarchive it
                    └── SET problem.status = "active"
```

### 5.3 DynamoDB update (un-archive)

Table: `codevolve-skills`

```
UpdateExpression:
    SET #status = #previous_status
    REMOVE #archived_at, #archive_reason, #previous_status

ConditionExpression:
    #status = :archived
```

### 5.4 Problem auto-unarchive

If **any** skill for a problem is un-archived, the parent problem is automatically un-archived. This is the inverse of the "archive when all skills archived" rule.

### 5.5 Kinesis event (un-archive)

```json
{
    "event_type": "unarchive",
    "timestamp": "2026-03-21T00:00:00Z",
    "skill_id": "uuid",
    "problem_id": "uuid",
    "restored_status": "verified",
    "success": true
}
```

---

## 6. Edge Cases

### 6.1 Archiving a canonical skill

**Behavior: block archival. Require explicit canonical demotion first.**

If a skill has `is_canonical: true`, the Archive Handler rejects the archive request and emits a warning event:

```json
{
    "event_type": "archive_blocked",
    "skill_id": "uuid",
    "reason": "canonical_skill",
    "timestamp": "2026-03-21T00:00:00Z"
}
```

The Decision Engine should log this to the Evolution/Gap dashboard. An operator or the `/evolve` pipeline should either promote an alternative skill to canonical or explicitly demote the skill via `POST /skills/:id/demote-canonical` before archival can proceed.

Rationale: auto-promoting the next-best skill is dangerous. The next-best skill may have low confidence or failing tests. Canonical status carries a quality guarantee (`confidence >= 0.85`, all tests passing), so it should not be transferred automatically.

### 6.2 Archiving during active execution

The DynamoDB `ConditionExpression` checks for `attribute_not_exists(active_execution_lock)`. The execution handler sets this lock attribute at the start of execution and removes it on completion (with a TTL fallback of 5 minutes in case the execution Lambda crashes).

If the condition fails, the archive message returns to the SQS queue and retries after the visibility timeout.

### 6.3 Race conditions between archive and execute

| Scenario | Resolution |
|----------|------------|
| Archive completes, then `/execute` is called | `/execute` checks `status != "archived"` before running. Returns `409 Conflict: skill is archived`. |
| `/execute` starts, then archive message arrives | `active_execution_lock` blocks archival. Archive retries via SQS. |
| `/resolve` returns skill, archive happens, then `/execute` is called | Same as first row. `/execute` re-checks status. The client receives 409 and should re-resolve. |

### 6.4 Bulk archival safety limits

The Decision Engine enforces a **maximum of 50 archive messages per evaluation cycle**. If more than 50 skills qualify for archival, the engine processes only the 50 with the worst metrics (sorted by: highest failure rate, then lowest confidence, then longest staleness). Remaining skills are picked up in the next 24-hour cycle.

This prevents catastrophic bulk archival from a metrics anomaly (e.g., a ClickHouse query returning stale data after an outage).

Additionally, the Archive Handler tracks the count of archives executed in the current 24-hour window. If the count exceeds **100** (combining all sources: Decision Engine + manual API calls), further archival is paused and an alarm is raised via CloudWatch.

---

## 7. SQS ArchiveQueue Design

### 7.1 Queue configuration

| Property | Value | Rationale |
|----------|-------|-----------|
| Queue name | `codevolve-archive-queue` | |
| Queue type | Standard (not FIFO) | Order does not matter for archive operations |
| Visibility timeout | 300 seconds (5 min) | Enough time for DynamoDB + OpenSearch + cache operations |
| Message retention | 4 days | Default. Messages that fail repeatedly are visible in DLQ. |
| Receive wait time | 20 seconds | Long polling to reduce empty receives |
| Batch size | 10 | Archive Handler processes up to 10 messages per invocation |

### 7.2 Message format

```json
{
    "action": "archive",
    "skill_id": "uuid",
    "problem_id": "uuid",
    "reason": "staleness_90d | low_confidence | high_failure_rate | zero_usage",
    "triggered_by": "decision_engine | manual_api",
    "evaluation_timestamp": "2026-03-21T00:00:00Z",
    "metrics_snapshot": {
        "days_since_last_execution": 95,
        "confidence": 0.22,
        "failure_rate_30d": 0.85,
        "execution_count_30d": 14,
        "lifetime_execution_count": 42
    }
}
```

The `metrics_snapshot` provides an audit trail of the exact metrics that triggered the archive decision.

### 7.3 Dead Letter Queue (DLQ)

| Property | Value |
|----------|-------|
| DLQ name | `codevolve-archive-dlq` |
| Max receive count | 3 |
| Retention | 14 days |

After 3 failed processing attempts, messages move to the DLQ. A CloudWatch alarm triggers when the DLQ has any messages, signaling that archive operations need manual investigation.

Common DLQ scenarios:
- Canonical skill blocking (handled by archive_blocked event, but message still fails processing)
- DynamoDB throttling
- Bedrock embedding generation failure (on unarchive)

### 7.4 Retry policy

The Archive Handler Lambda uses the following retry strategy:

1. **SQS-level retries**: The message becomes visible again after the 300-second visibility timeout. Up to 3 attempts before DLQ.
2. **Within-handler retries**: For transient failures (OpenSearch timeout, DynamoDB throttling), the handler retries the specific operation up to 2 times with exponential backoff (1s, 2s) before letting the message return to the queue.
3. **Partial failure handling**: If DynamoDB update succeeds but OpenSearch removal fails, the handler does NOT roll back DynamoDB. Instead, it re-throws so the message retries. On retry, the DynamoDB update is a no-op (condition expression prevents double-archive), and OpenSearch removal is retried. This is safe because all operations are idempotent.

### 7.5 Idempotency

All archive operations are designed to be idempotent:

- DynamoDB update uses `ConditionExpression: status <> "archived"` — repeated attempts are no-ops.
- Embedding nullification is naturally idempotent — setting null on an already-null attribute is a no-op.
- Cache invalidation is naturally idempotent — deleting non-existent keys is a no-op.
- Kinesis event emission is **not** idempotent — duplicate events may occur on retry. The analytics consumer should deduplicate on `(event_type, skill_id, timestamp)`.

---

## Appendix: New Fields on Skill Record

The archive mechanism requires the following new fields on the Skill DynamoDB record:

| Field | Type | Description |
|-------|------|-------------|
| `archived_at` | ISO8601 string | Timestamp of archival. Present only when `status = "archived"`. |
| `archive_reason` | string enum | One of: `staleness_90d`, `low_confidence`, `high_failure_rate`, `zero_usage`, `manual`. |
| `previous_status` | string enum | Status before archival. Used by un-archive to restore correct status. |
| `active_execution_lock` | string (TTL) | Set by execution handler during active runs. Blocks archival. |

---

*Last updated: 2026-03-21 — initial design by Jorven (ARCH-03)*
