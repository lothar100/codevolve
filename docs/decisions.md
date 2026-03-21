# codeVolve — Architectural Decision Records

> Maintained by Quimby. Recorded by Jorven. Never remove or modify past ADRs — supersede them with new ones.

---

## ADR-001: Technology Stack

**Status:** Accepted
**Date:** 2026-03-21

**Context:**

codeVolve is an AI-native registry of programming problems and solutions ("skills") designed primarily for consumption by AI agents (Claude Code, etc.) and secondarily by humans. The system must support low-latency skill resolution via vector search, on-demand execution of user-submitted code in multiple languages, event-driven analytics, and an automated feedback loop that triggers skill evolution. The expected access pattern is bursty — agents may issue many resolve/execute requests in short windows, then go idle. Cost predictability at low scale and the ability to scale without re-architecture are both critical, as is minimizing operational overhead for a small team.

**Decision:**

| Layer | Choice |
|-------|--------|
| Runtime | AWS Lambda (TypeScript) |
| Primary DB | DynamoDB |
| Search | OpenSearch Serverless |
| Caching | ElastiCache (Redis) with DynamoDB TTL as fallback |
| Event streaming | Kinesis Data Streams |
| Analytics store | ClickHouse (primary), BigQuery (considered alternative) |
| Embeddings | AWS Bedrock Titan Embeddings |
| IaC | AWS CDK v2 (TypeScript) |

**Rationale:**

### Runtime — AWS Lambda (TypeScript)

Serverless is chosen because codeVolve's traffic is inherently bursty and unpredictable. Paying per-invocation rather than for always-on compute keeps costs near zero during low-traffic periods while scaling automatically during bursts. Lambda removes the need to manage servers, patch OS images, or configure auto-scaling groups.

TypeScript is chosen over Python for the Lambda runtime because: (1) the API layer is request/response with JSON payloads, which TypeScript handles naturally with strong type safety; (2) CDK is natively TypeScript, so a single language spans infrastructure and application code; (3) TypeScript's type system catches contract mismatches at build time — critical when the Skill schema is the central data contract consumed by agents; (4) cold-start performance for Node.js Lambdas is significantly better than Python Lambdas with heavy dependencies.

### Primary DB — DynamoDB

The Skill and Problem data models have known access patterns: single-item lookups by ID, queries by tag/language/domain, and updates to individual fields (confidence, status). These are classic key-value and narrow-query patterns that DynamoDB handles efficiently. DynamoDB's single-digit-millisecond latency at any scale matches the low-latency requirement for `/resolve` and `/execute`. Its on-demand capacity mode aligns with the bursty traffic pattern — no capacity planning required.

A relational database (RDS/Aurora) was rejected because: (1) the data model does not require joins — skills and problems have a simple one-to-many relationship handled via GSIs; (2) relational databases require provisioned instances with ongoing cost regardless of traffic; (3) connection management from Lambda to RDS adds complexity (RDS Proxy, VPC configuration, cold-start latency from VPC attachment).

DynamoDB specifically (over other NoSQL options like MongoDB Atlas) was chosen because it is fully managed within AWS, integrates natively with Lambda IAM roles, supports DynamoDB Streams for change-data-capture if needed, and avoids cross-cloud networking.

### Search — OpenSearch Serverless

Vector search is fundamental to `/resolve`: an agent submits a natural-language intent, the system generates an embedding, and searches for the nearest skill. OpenSearch Serverless supports both k-NN vector search and traditional keyword/tag filtering in a single query, which is exactly what the skill router needs (combine semantic similarity with hard filters on language, domain, and tags).

Pinecone was rejected because: (1) it introduces a second cloud provider, adding network latency and operational surface area; (2) Pinecone is vector-only — tag/domain filtering would need to be done application-side or via metadata filters that are less expressive than OpenSearch's full query DSL; (3) OpenSearch Serverless is billed per OCU-hour with auto-scaling, keeping it within the AWS billing and IAM perimeter.

Weaviate was rejected because: (1) self-hosted Weaviate on ECS/EKS reintroduces operational overhead the serverless strategy is designed to eliminate; (2) Weaviate Cloud is another external dependency with its own auth and networking.

### Caching — ElastiCache (Redis) with DynamoDB TTL as fallback

The automated decision rules specify: "IF execution_count > threshold AND input_repeat_rate > threshold, cache the result." This means caching execution outputs keyed by (skill_id, input_hash). ElastiCache Redis provides sub-millisecond reads, TTL-based expiration, and is the standard caching layer within AWS.

DynamoDB TTL is available as a simpler alternative that avoids running a Redis cluster. The tradeoff: DynamoDB TTL-based caching keeps everything in a single service (simpler ops) but adds read cost and has higher latency (~5ms vs ~0.5ms). The decision is to start with DynamoDB TTL for simplicity during Phase 1-2, then migrate hot-path caching to ElastiCache in Phase 3+ when traffic justifies the additional infrastructure cost (~$15/month minimum for a t4g.micro node).

### Event streaming — Kinesis Data Streams

Every API call emits an analytics event (resolve, execute, validate, fail). Kinesis is chosen as the bridge between the primary system and the analytics store because: (1) it preserves event ordering within a shard, which matters for reconstructing agent session behavior; (2) it supports multiple consumers — the analytics store ingester and the decision engine Lambda can both read from the same stream independently; (3) Kinesis integrates natively with Lambda as an event source, so the decision engine runs automatically as events arrive.

SQS was rejected because: (1) SQS is point-to-point — multiple consumers require SNS fan-out, adding complexity; (2) SQS does not guarantee ordering (standard queues) or has low throughput (FIFO queues at 300 msg/s); (3) SQS messages are deleted after consumption, whereas Kinesis retains data for 24h+ allowing replay.

EventBridge was rejected because: (1) EventBridge is optimized for event routing with rules, not high-throughput streaming; (2) its 256KB event size limit and lower throughput ceiling are constraining for a telemetry pipeline; (3) EventBridge adds latency from rule evaluation that is unnecessary when the consumer topology is fixed.

### Analytics store — ClickHouse (self-hosted or ClickHouse Cloud)

Analytics events require OLAP-style queries: aggregations over time windows, percentile calculations (p50/p95 latency), GROUP BY on skill_id/domain/event_type, and sliding-window analysis for the decision engine. These are the exact queries ClickHouse is optimized for via columnar storage and vectorized execution.

ClickHouse is chosen over BigQuery because: (1) ClickHouse supports real-time ingestion with sub-second query latency, which is needed for live dashboards; (2) BigQuery is batch-oriented with higher query latency (seconds) and per-query pricing that becomes expensive with frequent dashboard refreshes; (3) ClickHouse can be self-hosted on a single EC2 instance for early stages or run on ClickHouse Cloud for managed operation; (4) ClickHouse's SQL dialect supports the exact window functions and approximate percentile functions the dashboards require.

BigQuery remains a viable alternative if the team prefers fully managed with zero operational overhead, accepts higher query latency, and wants to leverage BigQuery ML for future analytics. It would be adopted via a new ADR superseding this one.

### Embeddings — AWS Bedrock Titan Embeddings

Skill descriptions and agent intents must be embedded into vectors for semantic search. AWS Bedrock Titan Embeddings is chosen because: (1) it runs within AWS, so embedding generation does not cross cloud boundaries — no external API keys, no egress costs, no third-party rate limits; (2) IAM-based auth integrates with the existing Lambda execution roles; (3) Titan Embeddings v2 produces 1024-dimension vectors with quality competitive with OpenAI ada-002 for code/technical text.

OpenAI Embeddings were rejected because: (1) external API dependency introduces a failure mode outside AWS's control; (2) requires managing API keys as secrets; (3) adds network latency for every skill creation and every `/resolve` call; (4) OpenAI's rate limits could throttle skill ingestion during bulk seeding of the initial ~100 problems.

### IaC — AWS CDK v2 (TypeScript)

CDK v2 is chosen because: (1) infrastructure is defined in the same language (TypeScript) as the application, reducing context-switching and enabling shared types between app code and infrastructure definitions; (2) CDK's L2 constructs provide sensible defaults for Lambda, DynamoDB, API Gateway, and Kinesis, reducing boilerplate compared to CloudFormation or SAM; (3) CDK's `cdk diff` and `cdk synth` enable safe, reviewable deployments.

Terraform was rejected because: (1) it introduces HCL as a second language; (2) state management (S3 backend + DynamoDB lock table) is additional infrastructure to manage; (3) Terraform's AWS provider often lags behind CDK for new services.

SAM was rejected because: (1) SAM is YAML/JSON-based with limited abstraction; (2) SAM's scope is narrower — it handles Lambda + API Gateway well but is less ergonomic for DynamoDB, Kinesis, OpenSearch, and ElastiCache.

SST was rejected because: (1) SST v3 (Ion) moved to Pulumi/Terraform under the hood, combining the downsides of both; (2) SST's abstractions are opinionated in ways that may conflict with codeVolve's specific architecture; (3) smaller community and less battle-tested for production workloads.

**Alternatives considered:**

- **ECS Fargate** instead of Lambda: rejected due to always-on cost and operational overhead for a bursty workload.
- **Aurora Serverless v2** instead of DynamoDB: rejected due to VPC requirements from Lambda, higher baseline cost, and unnecessary relational features.
- **Pinecone / Weaviate** instead of OpenSearch: rejected to avoid cross-cloud dependencies and operational overhead (see above).
- **SQS / EventBridge** instead of Kinesis: rejected due to consumer model and ordering limitations (see above).
- **BigQuery** instead of ClickHouse: remains a viable alternative; rejected for now due to query latency and cost model (see above).
- **OpenAI Embeddings** instead of Bedrock Titan: rejected to stay within AWS perimeter (see above).
- **Terraform / SAM / SST** instead of CDK: rejected for language consistency and abstraction level (see above).

**Consequences:**

- **Positive:** Entire stack is AWS-native, simplifying IAM, networking, and billing. Single language (TypeScript) across app and infra code. Pay-per-use cost model for all compute. No servers to manage.
- **Positive:** Vector search + structured filtering in a single OpenSearch query simplifies the skill router.
- **Positive:** Kinesis provides durable, replayable event stream that decouples the primary system from analytics.
- **Negative:** DynamoDB's query model requires careful GSI design upfront; changing access patterns later is expensive.
- **Negative:** OpenSearch Serverless has a minimum cost (~$700/month for 2 OCUs) that is significant at low scale. Must evaluate whether to defer OpenSearch until Phase 2 and use DynamoDB-only search initially.
- **Negative:** ClickHouse self-hosted requires an EC2 instance and basic operational knowledge. ClickHouse Cloud mitigates this but adds cost.
- **Negative:** AWS lock-in across every layer. Migrating to another cloud would be a full rewrite.

---

## ADR-002: Analytics Separation

**Status:** Accepted
**Date:** 2026-03-21

**Context:**

codeVolve emits analytics events on every API call: resolve, execute, validate, and fail. These events power five dashboards (resolve performance, execution/caching, skill quality, evolution/gap detection, agent behavior) and drive automated decision rules (auto-cache triggers, optimization flags, gap detection for `/evolve`). The question is whether to store these events in the primary DynamoDB tables alongside skill and problem data, or in a separate analytics-optimized store.

The CLAUDE.md design rules state explicitly: "Never store analytics events in primary DynamoDB tables." This ADR documents the technical rationale behind that rule.

**Decision:**

Analytics events are stored in a dedicated ClickHouse instance (or BigQuery), completely separate from the primary DynamoDB tables. Kinesis Data Streams bridges the two systems: Lambdas emit events to Kinesis, and a separate consumer writes them to the analytics store. The primary system has zero runtime dependency on the analytics store.

**Rationale:**

### 1. Write amplification concerns

Every API call generates at least one analytics event. A single `/execute` call may generate multiple events (resolve lookup, cache check, execution, validation). At scale, analytics writes would outnumber primary data writes by 10-100x. Storing these in DynamoDB would mean: (1) the majority of write capacity is consumed by analytics, not by the core product operations (skill CRUD, status updates); (2) DynamoDB's on-demand pricing charges per write request unit — high-volume analytics writes would dominate the bill despite being low-value individually; (3) write-heavy analytics traffic could trigger DynamoDB's adaptive capacity throttling, potentially impacting primary operations that share the same table.

### 2. Query pattern differences (OLTP vs OLAP)

The primary system's access patterns are OLTP: get a skill by ID, query skills by tag, update a single skill's confidence score. These are point reads and narrow queries that DynamoDB excels at.

The analytics system's access patterns are OLAP: "What is the p95 latency for skill X over the last 7 days?", "What are the top 10 most-executed skills this week?", "What is the cache hit rate grouped by domain?", "Which intents resolved with confidence < 0.7 in the last 24 hours?" These queries require scanning large volumes of time-series data, computing aggregations, and returning sorted/grouped results.

DynamoDB cannot efficiently answer OLAP queries. A query like "p95 latency over 7 days" would require scanning all events for that period (expensive), pulling them into application memory (slow), and computing the percentile client-side. ClickHouse answers the same query in milliseconds by scanning columnar data with vectorized execution.

### 3. Cost implications

DynamoDB charges per read/write request unit and per GB stored. Analytics events are high-volume, append-only, and rarely read individually — exactly the wrong cost profile for DynamoDB. A single day of moderate traffic (10,000 API calls) generates 10,000+ events. Over a month, that is 300,000+ rows. DynamoDB would charge for every write and for every scan-heavy dashboard query.

ClickHouse stores columnar data with aggressive compression (10-20x for event data), making storage 10-20x cheaper per GB. Queries scan compressed columns rather than full rows, making reads dramatically cheaper. The cost difference grows superlinearly with volume.

### 4. Scaling characteristics

DynamoDB scales well for OLTP but its cost scales linearly with analytics volume. There is no "bulk scan discount." As event volume grows, dashboard query costs grow proportionally.

ClickHouse's columnar storage and vectorized execution mean that doubling event volume does not double query time — column scans are I/O-bound and compress well. ClickHouse is designed to scan billions of rows per second on modest hardware.

### 5. Why ClickHouse/BigQuery and not DynamoDB for analytics

Beyond the OLTP/OLAP mismatch described above:

- **No native aggregation:** DynamoDB has no SUM, AVG, COUNT, or percentile functions. All aggregation must happen in application code after scanning data out.
- **No time-series optimization:** DynamoDB has no concept of time-ordered columnar storage. Time-range queries require a GSI on timestamp and still return full rows.
- **No window functions:** The decision engine rules require sliding-window computations (execution count over last N hours, input repeat rate over last N days). These are native SQL window functions in ClickHouse but would require complex application logic against DynamoDB.
- **No JOIN equivalent:** Dashboard 5 (Agent Behavior) requires correlating resolve events with execute events for the same agent session. ClickHouse handles this with JOIN or window functions; DynamoDB would require multiple queries and client-side correlation.

### 6. How Kinesis bridges the two systems

Kinesis serves as the decoupling layer:

1. API Lambdas emit events to Kinesis synchronously (fire-and-forget from the Lambda's perspective — the Kinesis PutRecord call takes ~10ms and the Lambda does not wait for downstream processing).
2. An analytics ingester (Lambda triggered by Kinesis) batches events and writes them to ClickHouse. This consumer runs independently of the primary system.
3. The decision engine (a second Kinesis consumer or a scheduled Lambda querying ClickHouse) evaluates automated rules and triggers actions (cache warming, optimization flags, `/evolve` calls).

This architecture means the primary API path is: receive request -> process -> emit event to Kinesis -> return response. The analytics pipeline runs asynchronously and cannot slow down or block the primary path.

### 7. Failure isolation — analytics store down, primary unaffected

If the ClickHouse instance goes down:

- **Primary system is completely unaffected.** `/resolve`, `/execute`, `/validate`, and all CRUD operations continue to work normally because they only depend on DynamoDB and OpenSearch.
- **Kinesis retains events** for 24 hours (default) or up to 365 days (extended retention). No events are lost during an analytics outage.
- **The ingester consumer** will accumulate a backlog in Kinesis. When ClickHouse recovers, the consumer processes the backlog and catches up. Kinesis's iterator-based consumption model handles this automatically.
- **Dashboards go stale** but do not error — they simply show data up to the point of the outage.
- **Decision engine pauses** — no auto-cache or optimization triggers fire, but this is acceptable because these are enhancement operations, not critical path.

If the analytics store were co-located in DynamoDB and DynamoDB experienced throttling due to analytics query load, the primary system would be directly impacted. Separation eliminates this failure mode entirely.

**Alternatives considered:**

- **Store analytics in DynamoDB with a separate table:** Mitigates some concerns (no write amplification on the Skills table) but still suffers from OLAP query inefficiency, high scan costs, and lack of aggregation functions. Rejected.
- **Store analytics in DynamoDB and replicate to ClickHouse via DynamoDB Streams:** Adds complexity of DynamoDB Streams + transformation Lambda. Still pays for DynamoDB write costs on the analytics side. Rejected in favor of writing directly to Kinesis (which the Lambdas already integrate with) and skipping DynamoDB entirely for analytics.
- **Use Amazon Timestream:** Purpose-built for time-series but has limited SQL support, lower query flexibility than ClickHouse, and higher cost per GB at scale. Rejected.
- **Use Amazon Redshift Serverless:** Full OLAP capability but higher minimum cost, slower cold-start query times, and more operational complexity than ClickHouse. Viable but rejected for initial phases.

**Consequences:**

- **Positive:** Primary system performance is completely isolated from analytics load. DynamoDB costs remain proportional to product operations only.
- **Positive:** ClickHouse provides sub-second dashboard queries over millions of events, enabling real-time monitoring and fast decision-engine cycles.
- **Positive:** Kinesis provides a durable buffer that absorbs spikes and tolerates downstream failures without event loss.
- **Positive:** The analytics store can be replaced (ClickHouse to BigQuery, or vice versa) without any changes to the primary system — only the Kinesis consumer changes.
- **Negative:** Two datastores to operate (DynamoDB + ClickHouse) instead of one. Mitigated by using ClickHouse Cloud for managed operation.
- **Negative:** Event schema must be maintained in two places (the Kinesis producer in Lambda and the ClickHouse table DDL). Mitigated by sharing a TypeScript event type definition that generates both.
- **Negative:** Analytics data is eventually consistent (seconds of delay via Kinesis). Dashboards do not reflect the absolute latest state. This is acceptable for analytics use cases.

---

## ADR-003: DynamoDB TTL for Caching (supersedes ElastiCache in ADR-001)

**Status:** Accepted
**Date:** 2026-03-21
**Supersedes:** ADR-001 caching decision (ElastiCache with DynamoDB TTL fallback)

**Context:**

ADR-001 proposed ElastiCache (Redis) as the primary cache with DynamoDB TTL as a fallback, noting that "the decision is to start with DynamoDB TTL for simplicity during Phase 1-2, then migrate to ElastiCache in Phase 3+." On review, ElastiCache introduces unnecessary cost and operational complexity at this stage. The minimum cost for a `t4g.micro` Redis node is ~$15/month even with zero traffic, and it requires VPC configuration that adds Lambda cold-start latency.

**Decision:**

Use **DynamoDB TTL exclusively** for the cache layer. The `codevolve-cache` table (already designed in ARCH-01) serves as the sole cache. No ElastiCache.

**Rationale:**

- DynamoDB TTL provides automatic expiration at zero additional cost (only pay for reads/writes).
- Cache reads at ~5ms latency are acceptable — the execution itself takes 100ms+, so cache read latency is <5% of total response time.
- Eliminates VPC requirement for Lambda, keeping cold starts fast (~200ms vs ~1s+ with VPC).
- One fewer service to manage, monitor, and pay for.
- If sub-millisecond cache reads become necessary at scale, ElastiCache can be introduced later with no schema changes — just add a cache-aside layer in front of DynamoDB.

**Consequences:**

- **Positive:** Simpler architecture, lower cost, no VPC complexity.
- **Negative:** ~5ms cache reads instead of ~0.5ms. Acceptable for current scale.

---

## ADR-004: DynamoDB Embeddings with Client-Side Similarity (supersedes OpenSearch in ADR-001)

**Status:** Accepted
**Date:** 2026-03-21
**Supersedes:** ADR-001 search decision (OpenSearch Serverless)

**Context:**

ADR-001 chose OpenSearch Serverless for vector search in `/resolve`. However, OpenSearch Serverless has a minimum cost of ~$700/month (2 OCUs), which is prohibitive for a project with fewer than 1,000 skills in its initial phases. The skill registry starts with ~100 seeded problems and grows slowly. At this scale, loading all embeddings into memory and computing cosine similarity client-side is fast, simple, and free.

**Decision:**

Store embedding vectors directly in DynamoDB on the `codevolve-skills` table. The `/resolve` endpoint loads candidate skill embeddings from DynamoDB (filtered by language/domain/tags via GSI), computes cosine similarity in the Lambda function, and returns the top-k matches. No OpenSearch.

**Rationale:**

- At 100-1,000 skills, loading embeddings and computing similarity takes <50ms in a Lambda function. Well within the p95 <100ms target when combined with DynamoDB reads.
- Bedrock Titan Embeddings v2 produces 1024-dimension vectors. Each vector is ~8KB as a DynamoDB number list. 1,000 skills = ~8MB of embedding data — trivially fits in Lambda memory.
- Eliminates $700/month minimum OpenSearch cost. DynamoDB reads for 1,000 embeddings cost fractions of a cent.
- When the registry grows past ~5,000-10,000 skills and client-side similarity becomes slow, migrate to OpenSearch Serverless at that point. The embedding format is compatible — just bulk-index from DynamoDB.

**Implementation:**

- Add `embedding` attribute (List of Numbers, 1024 dimensions) to `codevolve-skills` table.
- On skill creation, generate embedding via Bedrock Titan v2 and store in DynamoDB.
- `/resolve` flow: query GSI for candidate skills -> batch-read embeddings -> embed intent via Bedrock -> compute cosine similarity -> rank -> return top-k.
- Archive sets embedding to null. Unarchive regenerates it.

**Migration trigger:** When `/resolve` p95 latency exceeds 100ms due to embedding scan volume, introduce OpenSearch Serverless and bulk-index existing embeddings.

**Consequences:**

- **Positive:** Saves ~$700/month. Zero additional infrastructure. Simpler deployment.
- **Positive:** Embedding data lives alongside skill data — no sync issues between DynamoDB and a separate index.
- **Negative:** `/resolve` latency scales linearly with skill count. Acceptable up to ~5,000-10,000 skills.
- **Negative:** No built-in full-text search — `q` parameter on `GET /skills` uses DynamoDB `contains()` filter, which is slow for large datasets. Acceptable at current scale.
