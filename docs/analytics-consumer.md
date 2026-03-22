# codeVolve — Analytics Consumer Architecture

> Status: Plan complete (Jorven, 2026-03-22). Ada implements from this document.

> Authored by Jorven. Design ID: IMPL-08. Ada implements directly from this document.

---

## Table of Contents

1. [Overview](#1-overview)
2. [ClickHouse Setup](#2-clickhouse-setup)
3. [Lambda Architecture](#3-lambda-architecture)
4. [ClickHouse Client](#4-clickhouse-client)
5. [Idempotency Design](#5-idempotency-design)
6. [DLQ and Partial Failure Handling](#6-dlq-and-partial-failure-handling)
7. [CDK Resources](#7-cdk-resources)
8. [Implementation Plan for IMPL-08](#8-implementation-plan-for-impl-08)
9. [Operational Notes](#9-operational-notes)

---

## 1. Overview

The analytics consumer is a Lambda function that reads `AnalyticsEvent` records from the `codevolve-events` Kinesis stream and writes them in batches to ClickHouse. It is the sole writer to the `analytics_events` ClickHouse table. Nothing else writes to ClickHouse.

```
codevolve-events (Kinesis Data Stream)
        │
        └── codevolve-analytics-consumer (Lambda, Node 22)
                │  Kinesis event source mapping
                │  Batch size: 100 records
                │  Bisect-on-batch-item-failure: enabled
                │  Parallelization factor: 1 per shard
                │
                ├── Parse + deduplicate records
                ├── Compute event_id (SHA-256 of skill_id+event_type+timestamp+input_hash)
                ├── INSERT INTO analytics_events (ReplacingMergeTree deduplication)
                │
                └── On failure: ReportBatchItemFailures
                        └── Failed sequence numbers → Kinesis DLQ (Lambda destination)
                                └── CloudWatch alarm: DLQ message count > 0
```

**Architectural constraints (non-negotiable):**

- Analytics events are NEVER written to primary DynamoDB tables (ADR-002). The consumer writes only to ClickHouse.
- The consumer Lambda is stateless. No in-process state survives between invocations.
- Kinesis's 24-hour retention (default) means an analytics outage of less than 24 hours loses no events. The consumer catches up automatically on recovery.
- The primary API path has zero runtime dependency on this consumer. `/resolve`, `/execute`, and all other endpoints continue if the consumer is down.

---

## 2. ClickHouse Setup

### 2.1 Deployment Target

**ClickHouse Cloud** (hosted, managed). This eliminates EC2 instance management, OS patching, and manual backups. The free tier provides 1 TB storage and 3 replicas, which is sufficient for Phase 3. If ClickHouse Cloud cost becomes prohibitive at scale, a migration ADR will be written.

Credentials (host URL, username, password) are stored in AWS Secrets Manager at the path `codevolve/clickhouse-credentials`. The Lambda reads this secret at module initialization (cold start) and caches it in the module scope. No VPC attachment is required — ClickHouse Cloud exposes a public HTTPS endpoint.

**Secret structure in Secrets Manager:**

```json
{
  "host": "https://<instance-id>.us-east-2.aws.clickhouse.cloud",
  "port": 8443,
  "username": "codevolve_writer",
  "password": "<password>",
  "database": "codevolve"
}
```

### 2.2 ClickHouse Table DDL

The following `CREATE TABLE` statement must be run once against the ClickHouse Cloud instance during initial setup. Ada creates this via a one-time migration script (`scripts/clickhouse-init.sql`) that is idempotent (`CREATE TABLE IF NOT EXISTS`).

```sql
CREATE TABLE IF NOT EXISTS codevolve.analytics_events
(
    event_id     String,          -- SHA-256 hex: deduplication key (see §5)
    event_type   LowCardinality(String),  -- 'resolve' | 'execute' | 'validate' | 'fail' | 'archive' | 'archive_warning' | 'unarchive'
    timestamp    DateTime64(3, 'UTC'),    -- millisecond precision, UTC
    skill_id     String,          -- UUID string or empty string (never NULL in CH)
    intent       String,          -- intent string or empty string
    latency_ms   Float64,
    confidence   Nullable(Float64),
    cache_hit    UInt8,           -- 0 or 1 (boolean stored as UInt8)
    input_hash   String,          -- SHA-256 hex or empty string
    success      UInt8,           -- 0 or 1
    _ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)  -- when the row was written by the consumer
)
ENGINE = ReplacingMergeTree(event_id)
ORDER BY (event_type, toDate(timestamp), skill_id, event_id)
PARTITION BY toYYYYMM(timestamp)
TTL toDate(timestamp) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
```

**Design rationale for each DDL decision:**

| Decision | Rationale |
|----------|-----------|
| `ReplacingMergeTree(event_id)` | Enables idempotent writes. If the same `event_id` is inserted twice (Kinesis at-least-once delivery), ClickHouse deduplicates on merge. See §5 for `event_id` derivation. |
| `ORDER BY (event_type, toDate(timestamp), skill_id, event_id)` | Matches the dominant query pattern: filter by `event_type`, then time range, then optionally by `skill_id`. The ORDER BY is the primary index in ClickHouse's MergeTree engine. |
| `PARTITION BY toYYYYMM(timestamp)` | Monthly partitions allow DROP PARTITION for targeted TTL enforcement and prevent full-table scans on time-range queries that span partition boundaries. |
| `TTL toDate(timestamp) + INTERVAL 90 DAY` | Events older than 90 days are dropped automatically by ClickHouse's TTL engine. This is the archive-safe default (per §3.2 of docs/decisions.md ADR-002). ClickHouse retains all events for archived skills within this 90-day window — the TTL is time-based, not skill-status-based. |
| `LowCardinality(String)` for `event_type` | ClickHouse optimizes queries on low-cardinality string columns (7 distinct values) via dictionary encoding. Avoids the Enum8 type mismatch between TypeScript and ClickHouse client libraries. |
| `Nullable(Float64)` for `confidence` | Confidence is null for `fail` and `archive_warning` events. ClickHouse supports Nullable columns; the TypeScript consumer maps `null` to SQL NULL. |
| `String` for `skill_id`, `intent`, `input_hash` | ClickHouse does not have a UUID type that maps cleanly from Node.js. Empty string is used instead of NULL for consistency with the ORDER BY key (ClickHouse MergeTree does not allow Nullable columns in the ORDER BY). |

**Schema compatibility with DESIGN-02 dashboard queries:**

All 5 dashboards in `docs/platform-design.md` §DESIGN-02 query this table. The column set above is a superset of the DESIGN-02 draft schema, with two intentional additions:

1. `event_id` (deduplication key, not queried by dashboards)
2. `_ingested_at` (internal observability column; can be used to measure Kinesis-to-ClickHouse lag)

The DESIGN-02 draft schema used `Enum8('resolve'=1, ...)` for `event_type`. This plan uses `LowCardinality(String)` instead. All DESIGN-02 queries that filter `WHERE event_type = 'resolve'` work identically with `LowCardinality(String)`. No query changes are required.

**Note for Ada:** The `archive_warning` and `unarchive` event types appear in `src/shared/types.ts` (`EVENT_TYPES` constant) but were not in the original DESIGN-02 schema. They are included in this DDL so the consumer handles all event types the system emits. Add handling for these types in the consumer's parsing logic.

---

## 3. Lambda Architecture

### 3.1 Kinesis Event Source Mapping

| Property | Value | Rationale |
|----------|-------|-----------|
| Batch size | 100 records | ClickHouse performs best with bulk inserts. 100 records is well within Lambda's 6MB payload limit (each analytics event is ~400 bytes JSON). |
| Bisect on batch item failure | `true` | When a subset of records in a batch fails, Kinesis bisects the batch and retries only the failing half. This prevents a single bad record from blocking an entire batch indefinitely. Requires `ReportBatchItemFailures` response format from the handler. |
| Starting position | `TRIM_HORIZON` | On initial deploy, consume all available events in the stream. After the first successful checkpoint, Kinesis advances from the last committed sequence number. |
| Maximum batching window | 5 seconds | Allows up to 5 seconds for batch accumulation before Lambda is triggered, even if the batch size has not been reached. Reduces Lambda invocations during low-traffic periods. |
| Parallelization factor | 1 (default) | One concurrent Lambda invocation per Kinesis shard. The `codevolve-events` stream is provisioned at 1 shard for Phase 3. Parallelization factor > 1 is needed only when processing falls behind the stream — not expected at Phase 3 scale. |
| Destination on failure | SQS DLQ (see §6) | Records that fail after Kinesis retry exhaustion are routed to the DLQ. |
| Maximum retry attempts | 3 | After 3 consumer-side retries (Kinesis shard iterator retries plus bisect retries), move failed records to DLQ. |

### 3.2 Lambda Configuration

| Property | Value |
|----------|-------|
| CDK logical ID | `AnalyticsConsumerFn` |
| Function name | `codevolve-analytics-consumer` |
| Runtime | `NODEJS_22_X` |
| Memory | 512 MB |
| Timeout | 60 seconds |
| Reserved concurrency | Not set (allow Lambda to scale with shards) |
| Entry point | `src/analytics/consumer.ts` |
| Environment variables | `CLICKHOUSE_SECRET_ARN`, `EVENTS_STREAM`, `AWS_REGION` |

**Timeout rationale:** A ClickHouse bulk insert of 100 rows over HTTPS typically completes in 200–800ms. The 60-second timeout provides a 75x safety margin for network retries and ClickHouse cold-start latency. Kinesis's iterator lease is held for the duration of the invocation; 60 seconds is well within the 5-minute Kinesis iterator expiry.

**Memory rationale:** 512 MB is sufficient for 100 JSON records in memory plus the `@clickhouse/client` library overhead. The Node.js V8 heap for this workload peaks at ~80 MB.

### 3.3 Handler Entry Point Contract

File: `src/analytics/consumer.ts`

```typescript
import type { KinesisStreamEvent, KinesisStreamBatchResponse } from 'aws-lambda';

export async function handler(
  event: KinesisStreamEvent
): Promise<KinesisStreamBatchResponse> {
  // Returns { batchItemFailures: [{ itemIdentifier: sequenceNumber }] }
  // Empty array = all records succeeded.
}
```

The handler MUST return a `KinesisStreamBatchResponse` (not void) when `bisectOnFunctionError` is enabled on the event source mapping. Returning void causes Kinesis to treat the entire batch as failed.

---

## 4. ClickHouse Client

### 4.1 Package

Use the official `@clickhouse/client` npm package (v1.x). This is the only supported ClickHouse client for Node.js. Do not use `axios` or `node-fetch` to call the ClickHouse HTTP API directly.

```
npm install @clickhouse/client
```

Add to `package.json` dependencies (not devDependencies). The client is bundled into the Lambda zip by esbuild.

### 4.2 Client Initialization

The client is initialized once at module scope (outside the handler function) so it is reused across warm invocations. The secret is fetched once at cold start.

```typescript
// src/analytics/consumer.ts — module scope, runs once per cold start

import { createClient } from '@clickhouse/client';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION ?? 'us-east-2',
});

interface ClickHouseSecret {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

let clickhouseClient: ReturnType<typeof createClient> | null = null;

async function getClickHouseClient(): Promise<ReturnType<typeof createClient>> {
  if (clickhouseClient !== null) return clickhouseClient;

  const secretArn = process.env.CLICKHOUSE_SECRET_ARN;
  if (!secretArn) throw new Error('CLICKHOUSE_SECRET_ARN env var is not set');

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  const secret: ClickHouseSecret = JSON.parse(response.SecretString ?? '{}');

  clickhouseClient = createClient({
    host: `${secret.host}:${secret.port}`,
    username: secret.username,
    password: secret.password,
    database: secret.database,
    request_timeout: 30_000,  // 30 second HTTP timeout for ClickHouse inserts
    compression: { request: true },  // gzip request body — reduces transfer size by ~5x
  });

  return clickhouseClient;
}
```

**Important:** If `getClickHouseClient()` throws (Secrets Manager unreachable, malformed secret), the handler must catch the error and mark all records in the batch as failed via `batchItemFailures`. Do not let the Lambda crash without reporting failures — Kinesis will retry the entire batch.

### 4.3 Batch Insert

Use ClickHouse's `insert` method with JSON values format. Do not build a raw SQL string — use the typed insert API.

```typescript
await client.insert({
  table: 'analytics_events',
  values: rows,  // ClickHouseRow[] — see §5.2 for row shape
  format: 'JSONEachRow',
});
```

**Error handling for insert:** If the insert throws, it may be a transient ClickHouse error (network, overload) or a permanent error (malformed row, schema mismatch). The handler must distinguish between the two:

- **Transient errors** (HTTP 429, 503, connection timeout): Mark all records in the batch as failed via `batchItemFailures`. Kinesis will retry after the visibility timeout.
- **Permanent errors** (HTTP 400 — bad request, type mismatch): Log the error and the offending rows. Mark all records as failed. They will go to DLQ after retry exhaustion. Do NOT silently drop permanently-malformed records.

In practice, all valid `AnalyticsEvent` records from the Kinesis stream will insert successfully once the schema is correct. A permanent insert error indicates a schema mismatch between the TypeScript type and the ClickHouse DDL — this should be treated as a critical alert.

---

## 5. Idempotency Design

### 5.1 Why Idempotency Is Needed

Kinesis guarantees **at-least-once** delivery. A record may be delivered more than once if:

1. The consumer Lambda times out mid-batch and Kinesis retries.
2. The event source mapping retries after a throttle.
3. The Lambda crashes after inserting into ClickHouse but before checkpointing the Kinesis sequence number.

Without idempotency, duplicate events would corrupt all aggregation queries (execution counts, percentiles, cache hit rates).

### 5.2 event_id Derivation

Each `AnalyticsEvent` from Kinesis is assigned a deterministic `event_id` before insertion. The `event_id` is a SHA-256 hex digest of a canonical string constructed from the event's identifying fields:

```
event_id = SHA-256(skill_id + "|" + event_type + "|" + timestamp + "|" + input_hash)
```

Where:
- `skill_id`: the event's `skill_id` field, or `""` if null.
- `event_type`: the event's `event_type` string.
- `timestamp`: the event's `timestamp` ISO 8601 string as-is (already server-assigned by the emitting Lambda; see `src/shared/emitEvent.ts`).
- `input_hash`: the event's `input_hash` field, or `""` if null.

The `"|"` separator prevents collisions between adjacent null fields.

**Implementation in Node.js:**

```typescript
import { createHash } from 'node:crypto';

function deriveEventId(event: AnalyticsEvent): string {
  const raw = [
    event.skill_id ?? '',
    event.event_type,
    event.timestamp,
    event.input_hash ?? '',
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}
```

**ClickHouse deduplication mechanism:** `ReplacingMergeTree(event_id)` deduplicates rows with the same `event_id` during background merge operations. Deduplication is **not** instantaneous — between when a duplicate row is inserted and when ClickHouse merges it, both rows may appear in query results. This is acceptable for Phase 3 dashboards because:

1. Kinesis duplicates are rare (estimated < 0.01% of records).
2. Dashboard queries are not real-time financial transactions — a brief double-count is not operationally significant.
3. The `FINAL` keyword can be added to dashboard queries that require strict deduplication, at the cost of slower query execution: `SELECT ... FROM analytics_events FINAL WHERE ...`.

**Decision Engine queries** (in `docs/decision-engine.md` §3.3) do not use `FINAL` because they run over large time windows where background merges have already completed. If double-counting is observed in practice, `FINAL` can be added to Decision Engine queries without a redeployment (queries are not compiled into Lambda code — they are constructed at runtime).

### 5.3 ClickHouseRow Shape

The TypeScript interface for a row written to ClickHouse:

```typescript
interface ClickHouseRow {
  event_id: string;          // SHA-256 hex
  event_type: string;        // e.g. 'resolve'
  timestamp: string;         // ISO 8601, e.g. '2026-03-21T04:05:00.123Z'
  skill_id: string;          // UUID string or ''
  intent: string;            // intent string or ''
  latency_ms: number;        // float
  confidence: number | null; // Nullable(Float64) in ClickHouse
  cache_hit: 0 | 1;          // UInt8
  input_hash: string;        // SHA-256 hex or ''
  success: 0 | 1;            // UInt8
}
```

**Mapping from `AnalyticsEvent` to `ClickHouseRow`:**

```typescript
function toClickHouseRow(event: AnalyticsEvent): ClickHouseRow {
  return {
    event_id: deriveEventId(event),
    event_type: event.event_type,
    timestamp: event.timestamp,
    skill_id: event.skill_id ?? '',
    intent: event.intent ?? '',
    latency_ms: event.latency_ms,
    confidence: event.confidence,   // null is preserved as SQL NULL
    cache_hit: event.cache_hit ? 1 : 0,
    input_hash: event.input_hash ?? '',
    success: event.success ? 1 : 0,
  };
}
```

---

## 6. DLQ and Partial Failure Handling

### 6.1 ReportBatchItemFailures

When the Kinesis event source mapping has `bisectOnFunctionError: true` (which is the underlying CDK mechanism for `reportBatchItemFailures`), the handler must return a `KinesisStreamBatchResponse` object:

```typescript
return {
  batchItemFailures: [
    { itemIdentifier: record.kinesis.sequenceNumber },
    // ... one entry per failed record
  ]
};
```

An empty `batchItemFailures` array signals that all records succeeded.

**Failure isolation strategy:**

The handler processes records individually and builds a `batchItemFailures` list. If a single record fails to parse (malformed JSON from the Kinesis stream), only that record is marked as failed — the rest of the batch is inserted normally.

If the ClickHouse insert itself fails (the entire batch INSERT throws), all records in that insert attempt are marked as failed. The handler does not attempt to insert one-by-one on a batch insert failure — ClickHouse insert failures at the batch level are almost always transient (network, overload), and Kinesis's bisect mechanism will subdivide the batch on the next retry, naturally isolating any permanently-bad records.

**Parsing failures vs insert failures — separate handling:**

```
Phase 1 — Parse each Kinesis record:
  - JSON.parse the record's data (base64-decoded)
  - Validate against AnalyticsEventSchema (Zod)
  - If parse/validate fails: add to batchItemFailures immediately
  - Successfully parsed records accumulate into a rows[] array

Phase 2 — Batch insert to ClickHouse:
  - INSERT INTO analytics_events VALUES (all rows[])
  - If insert succeeds: return { batchItemFailures: [parsing failures only] }
  - If insert fails: mark ALL rows[] records as failed + parsing failures
    Return { batchItemFailures: [all records] }
```

### 6.2 DLQ Configuration

**DLQ type:** SQS Standard Queue (not FIFO). Kinesis event source mappings route failed records to SQS DLQs, not Kinesis DLQs. The failed records arrive as SQS messages containing the original Kinesis record data plus failure metadata.

**DLQ name:** `codevolve-analytics-consumer-dlq`

| DLQ Property | Value |
|--------------|-------|
| Queue name | `codevolve-analytics-consumer-dlq` |
| Type | SQS Standard |
| Message retention | 14 days |
| CloudWatch alarm | Depth > 0 triggers `analytics-consumer-dlq-nonempty` alarm (CRITICAL severity) |

**SQS message structure for Kinesis DLQ records:**

AWS wraps the failed Kinesis records automatically. Each SQS message body contains:

```json
{
  "requestContext": {
    "requestId": "...",
    "functionArn": "...",
    "condition": "RetryAttemptsExhausted",
    "approximateInvokeCount": 3
  },
  "responseContext": {
    "statusCode": 200,
    "executedVersion": "$LATEST",
    "functionError": "...",
    "payloadTruncated": false
  },
  "version": "1.0",
  "timestamp": "...",
  "KinesisBatchInfo": {
    "shardId": "shardId-000000000000",
    "startSequenceNumber": "...",
    "endSequenceNumber": "...",
    "approximateArrivalOfFirstRecord": "...",
    "approximateArrivalOfLastRecord": "...",
    "batchSize": 1,
    "streamArn": "..."
  }
}
```

The original Kinesis record data is NOT included in the DLQ message body. The DLQ is an alert mechanism — it tells operators that records failed. Operators can replay the original events from the Kinesis stream (if within retention window) by resetting the shard iterator.

**DLQ Alert action:** When DLQ depth > 0, the on-call engineer should:

1. Check CloudWatch logs for `codevolve-analytics-consumer` — look for parse errors (permanent) vs ClickHouse connection errors (transient).
2. If transient: verify ClickHouse Cloud status, check Secrets Manager secret is correct. Failed records within Kinesis retention (24h default) can be replayed by resetting the consumer's Kinesis shard iterator.
3. If permanent (schema mismatch): investigate the `AnalyticsEvent` type change that caused the mismatch. Update the ClickHouse DDL if needed. Permanently malformed records cannot be replayed.

### 6.3 CloudWatch Alarm

```
Alarm name: codevolve-analytics-consumer-dlq-nonempty
Metric: SQS ApproximateNumberOfMessagesVisible
Namespace: AWS/SQS
Dimensions: QueueName = codevolve-analytics-consumer-dlq
Threshold: > 0
Period: 60 seconds
Evaluation periods: 1
Alarm action: SNS topic → ops channel
```

---

## 7. CDK Resources

All resources are added to `infra/codevolve-stack.ts`. Ada adds them in the existing stack class alongside Phase 2 resources.

### 7.1 New Lambda Function

| Property | Value |
|----------|-------|
| CDK logical ID | `AnalyticsConsumerFn` |
| Function name | `codevolve-analytics-consumer` |
| Runtime | `NODEJS_22_X` |
| Memory | 512 MB |
| Timeout | 60 seconds |
| Entry | `src/analytics/consumer.ts` |
| Handler | `handler` |
| Environment | `CLICKHOUSE_SECRET_ARN` (from Secrets Manager ARN), `EVENTS_STREAM` (stream name), `AWS_REGION` |

### 7.2 Kinesis Event Source Mapping

CDK construct: `KinesisEventSource` from `@aws-cdk/aws-lambda-event-sources`.

```typescript
import { KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';

analyticsConsumerFn.addEventSource(new KinesisEventSource(eventsStream, {
  startingPosition: StartingPosition.TRIM_HORIZON,
  batchSize: 100,
  maxBatchingWindow: Duration.seconds(5),
  reportBatchItemFailures: true,  // enables bisect-on-failure
  retryAttempts: 3,
  onFailure: new SqsDlq(analyticsConsumerDlq),  // routes failures to SQS DLQ
}));
```

The `eventsStream` reference is the existing `codevolve-events` Kinesis stream already defined in the CDK stack. Ada must find and reference it by its CDK logical ID.

### 7.3 SQS DLQ

| Property | Value |
|----------|-------|
| CDK logical ID | `AnalyticsConsumerDlq` |
| Queue name | `codevolve-analytics-consumer-dlq` |
| Type | Standard |
| Retention | `Duration.days(14)` |

### 7.4 Secrets Manager Secret

The ClickHouse credentials secret is created manually in AWS Secrets Manager (not via CDK), because the secret value (actual ClickHouse Cloud password) must not appear in the CDK template or in git. CDK only creates an IAM grant granting the Lambda read access to the secret.

**Manual setup (Ada creates once before deployment):**

```bash
aws secretsmanager create-secret \
  --name codevolve/clickhouse-credentials \
  --region us-east-2 \
  --description "ClickHouse Cloud credentials for analytics consumer" \
  --secret-string '{
    "host": "https://<instance-id>.us-east-2.aws.clickhouse.cloud",
    "port": 8443,
    "username": "codevolve_writer",
    "password": "<password>",
    "database": "codevolve"
  }'
```

**CDK grant (Ada adds to stack):**

```typescript
const clickhouseSecret = secretsmanager.Secret.fromSecretNameV2(
  this, 'ClickHouseSecret', 'codevolve/clickhouse-credentials'
);
clickhouseSecret.grantRead(analyticsConsumerFn);
// Pass the ARN to the Lambda via environment variable:
analyticsConsumerFn.addEnvironment('CLICKHOUSE_SECRET_ARN', clickhouseSecret.secretArn);
```

Also grant the Decision Engine Lambda read access to the same secret (for Phase 3 ClickHouse queries). Ada adds this grant to the `DecisionEngineFn` IAM configuration in `infra/codevolve-stack.ts`.

### 7.5 CloudWatch Alarm

```typescript
import { Alarm, ComparisonOperator, Metric } from 'aws-cdk-lib/aws-cloudwatch';

new Alarm(this, 'AnalyticsConsumerDlqAlarm', {
  alarmName: 'codevolve-analytics-consumer-dlq-nonempty',
  metric: analyticsConsumerDlq.metricApproximateNumberOfMessagesVisible({
    period: Duration.minutes(1),
  }),
  threshold: 0,
  comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
  evaluationPeriods: 1,
  alarmDescription: 'Analytics consumer DLQ has messages. Check CloudWatch logs for consumer errors.',
});
```

### 7.6 IAM Grants Summary

| Grant | Resource | Operations |
|-------|----------|-----------|
| Kinesis read | `codevolve-events` stream | `GetRecords`, `GetShardIterator`, `DescribeStream`, `ListShards` (granted automatically by `KinesisEventSource`) |
| Secrets Manager read | `codevolve/clickhouse-credentials` | `GetSecretValue` |
| SQS send (DLQ) | `codevolve-analytics-consumer-dlq` | `SendMessage` (granted automatically by `SqsDlq` destination) |
| CloudWatch Logs write | Lambda log group | Standard Lambda execution role grant |

No DynamoDB grants. No primary table access. The consumer is intentionally isolated from the primary data store.

---

## 8. Implementation Plan for IMPL-08

IMPL-08 is broken into five independently implementable sub-tasks, following the same pattern as IMPL-10. All sub-tasks share the same handler entry point at `src/analytics/consumer.ts`.

Sub-tasks A and B can be done in parallel. Sub-tasks C, D, and E depend on A and B.

---

### Sub-task A: ClickHouse Cloud Setup and Migration Script

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `scripts/clickhouse-init.sql`, `scripts/clickhouse-seed-verify.sql` |
| Depends on | ClickHouse Cloud instance provisioned (manual, one-time) |
| Blocks | IMPL-08-C, IMPL-08-D |

**Scope:**

1. Create `scripts/clickhouse-init.sql` with the exact DDL from §2.2. The script must use `CREATE TABLE IF NOT EXISTS` for idempotency.

2. Create `scripts/clickhouse-seed-verify.sql` with a verification query:
   ```sql
   SELECT
       count() AS total_rows,
       uniq(event_type) AS distinct_event_types,
       min(timestamp) AS earliest_event,
       max(timestamp) AS latest_event
   FROM codevolve.analytics_events;
   ```
   This query is run after IMPL-08 is deployed to confirm events are flowing.

3. Create the `codevolve/clickhouse-credentials` Secrets Manager secret manually (see §7.4 for the `aws secretsmanager create-secret` command). The actual ClickHouse Cloud credentials must not be committed to git.

4. Add `@clickhouse/client` to `package.json` dependencies and run `npm install`.

**Verification:**

- `npx tsc --noEmit` exits 0 (no TypeScript errors from new dependency).
- `aws secretsmanager describe-secret --secret-id codevolve/clickhouse-credentials --region us-east-2` returns the secret metadata (confirms it exists).
- `clickhouse-client --host <host> --port 8443 --user codevolve_writer --password <password> --query "SHOW TABLES FROM codevolve"` returns `analytics_events` (confirms table was created).

---

### Sub-task B: CDK Resources

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `infra/codevolve-stack.ts` |
| Depends on | IMPL-08-A (secret must exist before CDK references it) |
| Blocks | IMPL-08-D (Lambda must be deployable before end-to-end test) |

**Scope:**

1. Add `AnalyticsConsumerFn` Lambda to the CDK stack. Use the same esbuild bundling pattern as other Lambda functions in the stack. Entry point: `src/analytics/consumer.ts`, handler export: `handler`.

2. Add `AnalyticsConsumerDlq` SQS Standard queue with 14-day retention.

3. Add `KinesisEventSource` on `AnalyticsConsumerFn` using the existing `codevolve-events` stream reference. Set `batchSize: 100`, `maxBatchingWindow: Duration.seconds(5)`, `reportBatchItemFailures: true`, `retryAttempts: 3`, `onFailure: new SqsDlq(analyticsConsumerDlq)`.

4. Add `clickhouseSecret.grantRead(analyticsConsumerFn)` and inject `CLICKHOUSE_SECRET_ARN` as an environment variable.

5. Add `clickhouseSecret.grantRead(decisionEngineFn)` so the Decision Engine can use ClickHouse in Phase 3 (this grant is already listed in `docs/decision-engine.md` §6.5 but was deferred to IMPL-08 since the secret did not exist yet).

6. Add `AnalyticsConsumerDlqAlarm` CloudWatch alarm as specified in §7.5.

7. Write a minimal stub handler in `src/analytics/consumer.ts` that logs the event and returns `{ batchItemFailures: [] }`. This stub is replaced in IMPL-08-C.

**Verification:**

- `npx cdk synth` exits 0.
- Synthesized CloudFormation template contains `AnalyticsConsumerFn`, `AnalyticsConsumerDlq`, `AnalyticsConsumerDlqAlarm`.
- Template contains an `AWS::Lambda::EventSourceMapping` resource with `StartingPosition: TRIM_HORIZON` and `BisectBatchOnFunctionError: true`.
- `grep -r "NODEJS_20" infra/codevolve-stack.ts` returns no matches.

---

### Sub-task C: Event Parsing and event_id Derivation

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `src/analytics/consumer.ts`, `src/analytics/eventId.ts`, `tests/unit/analytics/eventId.test.ts`, `tests/unit/analytics/consumer.test.ts` |
| Depends on | IMPL-08-A (package installed), IMPL-08-B (handler stub exists) |
| Blocks | IMPL-08-D |

**Scope:**

1. Create `src/analytics/eventId.ts` implementing `deriveEventId(event: AnalyticsEvent): string` using Node.js `crypto.createHash('sha256')` as specified in §5.2.

2. Create `src/analytics/toClickHouseRow.ts` implementing `toClickHouseRow(event: AnalyticsEvent): ClickHouseRow` as specified in §5.3. Define the `ClickHouseRow` interface in this file and export it.

3. Implement the Kinesis record parsing phase in `src/analytics/consumer.ts` (Phase 1 of the two-phase logic in §6.1):
   - Iterate over `event.Records`.
   - For each record: base64-decode `record.kinesis.data`, `JSON.parse`, validate against `AnalyticsEventSchema` from `src/shared/validation.ts`.
   - On parse failure: add `{ itemIdentifier: record.kinesis.sequenceNumber }` to `batchItemFailures`. Log the error and the raw data (truncated to 500 chars to avoid log bloat).
   - On success: add to `rows` array.

4. Write unit tests in `tests/unit/analytics/eventId.test.ts`:
   - `deriveEventId` produces consistent output for the same inputs.
   - `deriveEventId` produces different output when any input field changes.
   - `deriveEventId` handles null `skill_id` and null `input_hash` correctly (no crash, no collision with empty-string variant).

5. Write unit tests in `tests/unit/analytics/consumer.test.ts`:
   - A valid Kinesis record is parsed and added to `rows`.
   - A record with invalid JSON is added to `batchItemFailures`.
   - A record failing Zod validation is added to `batchItemFailures`.
   - A batch with mixed valid/invalid records produces correct `batchItemFailures` entries.

**Verification:** `npx jest tests/unit/analytics/` passes. `npx tsc --noEmit` exits 0.

---

### Sub-task D: ClickHouse Client and Batch Insert

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `src/analytics/clickhouseClient.ts`, `src/analytics/consumer.ts`, `tests/unit/analytics/consumer.test.ts` |
| Depends on | IMPL-08-C (row shape defined), IMPL-08-B (CDK has secret ARN available) |
| Blocks | IMPL-08-E |

**Scope:**

1. Create `src/analytics/clickhouseClient.ts` implementing `getClickHouseClient()` as specified in §4.2. Export the function and the `ClickHouseSecret` interface. The module-level cached client is in this file.

2. Implement Phase 2 (batch insert) of the handler in `src/analytics/consumer.ts`:
   - If `rows` is empty after parsing (all records failed): return `{ batchItemFailures }` immediately. Do not attempt an empty INSERT.
   - Call `getClickHouseClient()`.
   - Call `client.insert({ table: 'analytics_events', values: rows, format: 'JSONEachRow' })`.
   - On success: return `{ batchItemFailures: [parsing failures] }`.
   - On transient error (categorized by HTTP status or error message pattern): add all `rows` records to `batchItemFailures`. Log error with batch size and error message.
   - On permanent error (HTTP 400 Bad Request): log at ERROR level with the full error and a sample of the offending rows (first 3). Add all `rows` records to `batchItemFailures`.

3. Update unit tests in `tests/unit/analytics/consumer.test.ts`:
   - Mock `getClickHouseClient` to return a mock with `insert` method.
   - Test: successful insert returns only parsing failures in `batchItemFailures`.
   - Test: empty `rows` (all parse failures) returns early without calling `insert`.
   - Test: insert throws (transient) → all rows in `batchItemFailures`, parsing failures also included.
   - Test: insert throws (permanent, HTTP 400) → all rows in `batchItemFailures`, error logged at ERROR level.
   - Test: batch with 0 valid records and 0 failures returns `{ batchItemFailures: [] }`.

**Note for Ada on mocking:** The `getClickHouseClient` function returns a lazily-initialized singleton. In tests, reset the module-level cache between tests to avoid test pollution. Use `jest.resetModules()` or inject the client as a parameter to a testable inner function. The recommended pattern is to export a `_setClickHouseClientForTesting(client)` function that tests use to inject a mock.

**Verification:** `npx jest tests/unit/analytics/` passes. `npx tsc --noEmit` exits 0.

---

### Sub-task E: End-to-End Verification and Operational Readiness

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | Planned |
| Files | `scripts/clickhouse-seed-verify.sql`, `docs/analytics-consumer.md` (operational notes only, no architecture changes) |
| Depends on | IMPL-08-D, IMPL-08-B (CDK deployed) |
| Blocks | IMPL-09, IMPL-10 Phase 3 mode |

**Scope:**

1. Deploy the CDK stack to the dev environment: `npx cdk deploy`.

2. Confirm the Kinesis event source mapping is active:
   ```bash
   aws lambda list-event-source-mappings \
     --function-name codevolve-analytics-consumer \
     --region us-east-2
   ```
   Check `State: Enabled`.

3. Trigger a test event by posting to `POST /skills` (which emits a Kinesis event via `src/shared/emitEvent.ts`). Wait 30 seconds (maximum batching window + Lambda execution time).

4. Run `scripts/clickhouse-seed-verify.sql` against the ClickHouse Cloud instance and confirm `total_rows` > 0 and `distinct_event_types` includes the event type emitted.

5. Trigger a parse failure by manually sending a malformed record to the Kinesis stream:
   ```bash
   aws kinesis put-record \
     --stream-name codevolve-events \
     --partition-key test \
     --data $(echo '{"not_an_analytics_event": true}' | base64) \
     --region us-east-2
   ```
   Confirm the Lambda logs show a parse failure and the DLQ does NOT receive a message (parse failures do not go to DLQ after 3 retries — only insert failures do; parse failures return immediately with `batchItemFailures` which Kinesis retries and then drops after retry exhaustion unless configured otherwise; verify behavior matches expectation).

6. Update `codevolve-config` to set `decision_engine.use_clickhouse = true` in DynamoDB. This unblocks the Decision Engine (IMPL-10) Phase 3 ClickHouse queries.

**Verification (IMPL-08 Completion Gate):**

All of the following must pass before IMPL-08 is marked Verified:

1. `npx tsc --noEmit` — exits 0, no TypeScript errors.
2. `npx jest tests/unit/analytics/` — all analytics consumer unit tests pass.
3. `npx cdk synth` — exits 0. Template contains `AnalyticsConsumerFn`, `AnalyticsConsumerDlq`, `AnalyticsConsumerDlqAlarm`, Kinesis event source mapping with `BisectBatchOnFunctionError: true`.
4. Manual deploy to dev: `npx cdk deploy` exits 0.
5. End-to-end smoke test: at least 1 event flows from Kinesis → ClickHouse and appears in `scripts/clickhouse-seed-verify.sql` output.
6. REVIEW-07 (Iris): verify analytics separation (no primary DB writes), idempotency logic, DLQ configuration, schema correctness against all 5 DESIGN-02 dashboard queries.

---

## 9. Operational Notes

### 9.1 Monitoring

| CloudWatch Metric | Source | Alert |
|------------------|--------|-------|
| `IteratorAge` | Kinesis/Lambda event source | > 60,000ms (1 minute) — consumer is falling behind |
| `Errors` | Lambda metrics | > 0 in 5 minutes |
| `Duration` | Lambda metrics | P95 > 45,000ms (approaching 60s timeout) |
| `ApproximateNumberOfMessagesVisible` | SQS DLQ | > 0 (see §6.3 alarm) |
| `ThrottledRecords` | Kinesis event source mapping | > 0 — consumer concurrency limit hit |

### 9.2 Kinesis Retention and Replay

The `codevolve-events` stream defaults to 24-hour retention. If the analytics consumer is down for more than 24 hours, events produced during the outage are permanently lost from Kinesis (they cannot be replayed). ClickHouse will have a gap in its data for that period.

**Mitigation options (if needed):**
- Increase Kinesis retention to 7 days (`aws kinesis increase-stream-retention-period --retention-period-hours 168`). Costs ~$0.02/shard-hour for extended retention.
- For Phase 3, 24-hour retention is acceptable — a >24-hour analytics outage is a serious operational incident regardless.

### 9.3 ClickHouse Schema Evolution

When adding a new column to `analytics_events`:

1. Add the column to ClickHouse first (ALTER TABLE ADD COLUMN with a default value).
2. Update `ClickHouseRow` interface in `src/analytics/toClickHouseRow.ts`.
3. Update `toClickHouseRow` mapping function.
4. Deploy the Lambda.

Always add columns with a default value so existing rows are not broken. Never remove a column without a migration ADR. Never rename a column (add a new one, migrate dashboards, then drop the old one).

### 9.4 ClickHouse Cloud Outage Behavior

If ClickHouse Cloud is unreachable:

1. The consumer Lambda's `client.insert()` throws.
2. All records in the batch are marked as `batchItemFailures`.
3. Kinesis retries the batch (up to `retryAttempts: 3` times).
4. After 3 retries, Kinesis routes the batch to the SQS DLQ.
5. The DLQ alarm fires. On-call is paged.
6. The primary API (`/resolve`, `/execute`, etc.) is completely unaffected — it has no runtime dependency on the consumer.
7. If ClickHouse recovers within 24 hours, the failed records cannot be replayed from DLQ (the DLQ does not contain the original Kinesis data). However, events emitted after the outage will flow normally. The outage window has a permanent analytics gap unless Kinesis retention is extended (§9.2).

---

*Last updated: 2026-03-22 — IMPL-08 plan authored by Jorven*
