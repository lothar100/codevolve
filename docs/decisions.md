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

---

## ADR-005: Client-Side Vector Search — Phase 2 Implementation Specification
Date: 2026-03-21
Status: Accepted
Decided by: Jorven (ARCH-05)

### Context

ADR-004 established the principle of DynamoDB-stored embeddings with client-side cosine similarity, superseding the OpenSearch Serverless plan from ADR-001. ADR-004 did not specify the full implementation contract: the exact fields to embed, the concatenation format, the boost algorithm, the confidence threshold, the latency budget for Phase 2 at scale, or the precise migration trigger.

Additionally, ADR-004's migration trigger states "when `/resolve` p95 latency exceeds 100ms." That figure is ambiguous: 100ms is the post-OpenSearch target (i.e., what we expect after migration), not the Phase 2 acceptable threshold. At 5,000 skills with a DynamoDB scan and Lambda similarity loop, the estimated p95 is ~400ms. A trigger of "exceeds 100ms" would fire immediately and was not the intent. This ADR clarifies the migration trigger and documents the complete Phase 2 implementation.

### Options Considered

| Option | Description | Trade-off |
|--------|-------------|-----------|
| A — Migrate trigger: p95 > 100ms | As written in ADR-004 | Would trigger migration immediately at ~1,000 skills; contradicts the rationale of ADR-004 |
| B — Migrate trigger: 5,000 active skills (chosen) | Hard count-based trigger | Predictable; avoids latency measurement instability from cold starts and bursty traffic |
| C — Migrate trigger: p95 > 300ms | Latency-based leading indicator | Valid but harder to automate; depends on sustained traffic to measure p95 accurately |

### Decision

The Phase 2 implementation specification is fully defined in `docs/vector-search.md`. The key decisions recorded here are:

1. **Fields embedded:** `name`, `description`, `domain` (space-joined), `tags` (space-joined). Concatenation format: `{name}. {description} domain:{domain tokens} tags:{tag tokens}`.
2. **Model:** AWS Bedrock Titan Embed Text v2 (`amazon.titan-embed-text-v2:0`), 1024 dimensions, L2-normalized via `"normalize": true` in the InvokeModel request.
3. **Similarity:** Dot product of L2-normalized Float32Arrays (equivalent to cosine similarity). Computed in-process in the resolve Lambda after a full DynamoDB scan.
4. **Boost:** +0.05 per matching tag, +0.10 per matching domain, capped at +0.20 total. Final confidence = cosine_score + boost, capped at 1.0.
5. **Threshold:** Top candidate must have final confidence >= 0.70 to return a match. Below threshold: return 404 `NO_MATCH` and trigger `/evolve`.
6. **Phase 2 latency target:** p95 < 500ms at 5,000 skills. This supersedes the "p95 < 100ms" figure in ADR-004, which is correctly interpreted as the post-OpenSearch migration SLO, not the Phase 2 acceptable threshold.
7. **Migration trigger:** 5,000 active skills in the registry (hard count), not a latency threshold. When the registry reaches 5,000 active non-archived skills, begin the OpenSearch migration process as defined in `docs/vector-search.md` §3.4.

### Reasons

- A count-based migration trigger is operationally simple and predictable. It can be monitored with a DynamoDB metric or a scheduled Lambda counting active skills. A latency-based trigger requires sustained p95 measurement across a representative traffic window, which is unreliable at low call volumes.
- The 500ms Phase 2 target is conservative and honest. The latency model in `docs/vector-search.md` §5.1 estimates ~400ms p95 at 5,000 skills, giving 100ms headroom. If real-world measurements show this is tighter, the 300ms leading indicator in Option C can be used to start the migration earlier.
- Dot product on Float32Array in a tight loop is the fastest client-side similarity computation available in Node.js V8. Using Float32Array reduces memory pressure by 2x compared to `number[]` and enables potential SIMD optimizations in future V8 versions.

### Consequences

- **Positive:** Phase 2 `/resolve` is fully specified. Ada can implement IMPL-05 directly from `docs/vector-search.md` without requiring further architecture clarification.
- **Positive:** The latency target is achievable and honest. Avoids a migration being triggered prematurely or the team being surprised by latency that was always expected at this scale.
- **Positive:** Boost algorithm gives callers a meaningful way to improve match quality by providing precise tags and domains — incentivizes good tagging practice.
- **Negative:** ADR-004's "p95 < 100ms migration trigger" is technically superseded by this ADR. The original text is preserved in ADR-004 as written; this ADR's clarification takes precedence for implementation. Quimby should not modify ADR-004 retroactively.
- **Negative:** The 500ms p95 target is noticeable latency for interactive use. This is acceptable because Phase 2 consumers are agents (not humans), and a 500ms resolve is still far faster than re-deriving the answer from scratch.

---

## ADR-006: Lambda-per-Language Sandbox for `/execute`
Date: 2026-03-21
Status: Superseded by ADR-012
Decided by: Jorven (ARCH-06)

> **Superseded 2026-04-07 by ADR-012.** The Lambda runner model was not carried forward. codeVolve switched to a local CLI tool execution model: skills are fetched from the registry and run by the caller in their own environment. No runner Lambdas (`codevolve-runner-python312`, `codevolve-runner-node22`) exist in the current architecture.

### Context

`POST /execute` runs untrusted skill implementations — code submitted by agents or humans to solve specific problems. That code must be executed in an isolated environment where it cannot: access the network, read or write shared state, invoke AWS services, or interfere with other concurrent executions.

Phase 2 requires support for two languages: Python 3.12 and JavaScript (Node 22). The execution model must be safe, operationally simple, and achievable without introducing container registries or long-running compute.

Three isolation approaches were considered: separate Lambda per language, Docker containers on ECS Fargate, and Lambda container images backed by ECR.

### Options Considered

| Option | Description | Cold start | Ops overhead | Per-execution cost | Language addition |
|--------|-------------|------------|--------------|-------------------|-------------------|
| A — Lambda per language (chosen) | Separate Lambda function per language. Runner Lambdas have minimal IAM (CloudWatch Logs only). The `/execute` Lambda invokes runner synchronously via `InvokeCommand`. | ~200–500ms (warm: ~0ms) | Low — standard Lambda deployment via CDK | Lambda pricing per 512 MB invocation | New Lambda function + CDK construct |
| B — ECS Fargate containers | Long-running containers per language, invoked via an internal HTTP call or SQS. Allows richer sandboxing (seccomp profiles, user namespacing). | N/A (always on) | High — ECS cluster, task definitions, load balancer, VPC configuration | Always-on compute cost even at zero traffic | New task definition, ECS service update |
| C — Lambda container images (ECR) | Lambda functions backed by custom Docker images stored in ECR. Allows arbitrary OS-level tooling. | ~1–3s (cold start from ECR pull is slow without provisioned concurrency) | Medium — ECR repo, image build pipeline, CDK container image bundling | Lambda pricing + ECR storage | New Dockerfile, ECR repo, image pipeline |

### Decision

Option A: separate Lambda per language. Two runner functions are defined for Phase 2:

| Runner function name | Language | Runtime |
|---------------------|----------|---------|
| `codevolve-runner-python312` | Python | Python 3.12 |
| `codevolve-runner-node22` | JavaScript | Node.js 22 |

The `/execute` orchestration Lambda (`codevolve-execute`) invokes runners synchronously using `InvokeCommand` with `InvocationType: "RequestResponse"`. Runner function names are injected as environment variables (`RUNNER_LAMBDA_PYTHON`, `RUNNER_LAMBDA_NODE`) so they are never hardcoded in handler code.

### Reasons

**Cold start performance:** Standard Lambda cold starts for Python 3.12 and Node 22 (without container images) are 200–500ms. This is acceptable for Phase 2 — the total execution budget is 10 seconds, and cold starts are amortized across warm invocations. ECS Fargate has no cold start but carries always-on cost; Lambda container image cold starts of 1–3 seconds consume a meaningful fraction of the 10-second execution budget.

**IAM scoping:** Runner Lambdas have CloudWatch Logs write access only. An explicit deny on all other AWS service calls is set in their execution role. This ensures a skill implementation that attempts to call DynamoDB, S3, Bedrock, or any other AWS service receives an `AccessDeniedException` rather than succeeding. This is the primary isolation mechanism — Lambda's own ephemeral execution environment prevents cross-invocation state leakage.

**No container registry overhead:** Lambda container images require an ECR repository, image build pipeline, and ECR pull on cold start. Standard Lambda zip deployments have no such dependency chain and deploy in seconds via CDK. For two languages at Phase 2 scale, container images add complexity without meaningful benefit.

**Language addition path:** Adding a new language in Phase 3+ requires one new Lambda function definition, one CDK construct, and one entry in the runner lookup map in `src/execution/runners.ts`. This is a small, contained change that can be reviewed and deployed independently. Compare to Fargate, where a new language requires a new task definition, ECS service update, and load balancer routing rule.

**Operational simplicity:** The entire stack (orchestration Lambda + runner Lambdas) is deployed with `cdk deploy` and managed with standard Lambda tooling (CloudWatch Logs, X-Ray tracing, Lambda metrics). No ECS cluster to monitor, no ECR lifecycle policies to manage.

### Consequences

- **Positive:** Cold start within execution budget. No container registry. IAM-enforced isolation. Language addition is a single CDK construct.
- **Positive:** Runner Lambdas are fully observable via CloudWatch Logs and Lambda metrics (invocation count, error rate, duration). These feed directly into the analytics pipeline via Kinesis events emitted by the `/execute` handler.
- **Positive:** Runner Lambda timeout (10 seconds) is enforced by the Lambda service itself — no application-level timeout logic required in the runner handler. The `/execute` Lambda catches the timeout via the `FunctionError` field on the `InvokeCommand` response.
- **Negative:** Adding a new language requires a new Lambda deployment (not just a configuration change). Acceptable for Phase 2 — languages are not added frequently and each addition is a deliberate architectural decision.
- **Negative:** The `new Function(...)` sandbox in the Node 22 runner does not provide V8-level isolation (no separate V8 heap, no memory quota enforcement below the 512 MB Lambda limit). If skill code consumes excessive CPU without throwing, it will exhaust the Lambda timeout. Lambda's 10-second timeout is the operative safety net.
- **Negative:** Lambda concurrent execution limits apply. If many `/execute` calls arrive simultaneously, runner Lambda concurrency may throttle. Mitigated by setting reserved concurrency on runner Lambdas and returning 429 when throttled, rather than allowing Lambda to queue unbounded invocations. Reserved concurrency configuration is a IMPL-06 CDK detail.
- **Accepted trade-off:** True process-level isolation (seccomp, user namespacing, cgroups) is not provided by this approach. This is acceptable for Phase 2 where the skill registry is a controlled environment with human review of skill implementations. If codeVolve opens to untrusted public contributions in Phase 5, a WASM-based sandbox or Firecracker microVM approach should be evaluated in a new ADR.

---

## ADR-007: Decision Engine Scheduling
Date: 2026-03-21
Status: Accepted
Decided by: Jorven (ARCH-07)

### Context

The Decision Engine is a scheduled Lambda that evaluates four automated rules on every invocation: auto-cache trigger, optimization flag, gap detection, and archive evaluation. It must run periodically without being triggered by API requests, and it must not run concurrently with itself. The two scheduling options are a rate-based EventBridge rule (e.g., `rate(5 minutes)`) and a cron-based rule (e.g., `cron(0/5 * * * ? *)` for every 5 minutes, or `cron(0 4 * * ? *)` for once daily at 04:00 UTC).

The archive evaluation sub-rule has a different cadence requirement (once per 24 hours at approximately 04:00 UTC) from the other three rules (every 5 minutes). This creates a secondary design question: should the Decision Engine Lambda be invoked on two separate schedules, or should a single schedule drive all rules with internal gating for the archive evaluation?

### Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A — Single rate-based schedule, 5-minute interval, internal 24h gate for archive (chosen) | One EventBridge rule at `rate(5 minutes)`. Archive evaluation is internally gated: the Lambda checks whether 23 hours have elapsed since the last archive run. | Single schedule to manage. All rules run from one entry point. Archive gate is testable in unit tests. No timezone configuration required. | Lambda invokes 288 times per day but only runs archive evaluation once. Invocations are cheap — this is not a cost concern. |
| B — Two separate EventBridge rules | One rule at `rate(5 minutes)` for auto-cache and optimization flag. A second rule at `cron(0 4 * * ? *)` for archive evaluation only. | Archive evaluation schedule is explicit in the infrastructure layer. | Two rules, two Lambda functions or one Lambda with two entry points. More CDK constructs to manage. Cron expressions are timezone-sensitive and harder to test. EventBridge cron uses UTC implicitly but this must be documented and remembered. |
| C — Single cron-based schedule, once daily | One rule at `cron(0 4 * * ? *)`. Archive evaluation, auto-cache, and optimization flag all run once per day. | Fewest Lambda invocations. Simplest schedule. | Auto-cache and optimization flag become stale for 24 hours. A skill that crosses the auto-cache threshold at 04:01 UTC waits 24 hours to be flagged. Reduces responsiveness of the feedback loop. |

### Decision

Option A: single rate-based EventBridge schedule at `rate(5 minutes)`. The archive evaluation is internally gated by a `last_archive_evaluation` timestamp in `codevolve-config`. The gate condition is: run archive evaluation if `last_archive_evaluation` is absent or more than 23 hours ago.

### Reasons

**Operational simplicity:** One EventBridge rule, one Lambda entry point, one CDK construct. The internal gate is logic rather than infrastructure — it is testable as a unit test, visible in Lambda logs, and configurable via the `codevolve-config` table without a CDK deployment.

**Rate vs cron:** A rate-based rule has no timezone dependency. `rate(5 minutes)` starts immediately on deploy and fires every 5 minutes regardless of clock alignment. A cron expression (`cron(0/5 * * * ? *)` is equivalent) adds no precision benefit and is harder to read and audit in the AWS Console.

**Responsiveness:** The 5-minute cadence means auto-cache and optimization flags are applied within 5 minutes of a skill crossing a threshold, rather than waiting up to 24 hours. This is important during high-activity periods (e.g., bulk skill seeding) when many skills may cross thresholds simultaneously.

**Archive timing:** The 04:00 UTC target for archive evaluation is achieved by setting the initial `last_archive_evaluation` timestamp to the prior 04:00 UTC at deploy time. Each day's archive run will occur within 5 minutes of 04:00 UTC (bounded by the 5-minute schedule tick and the gate's 23-hour window). Maximum daily drift is 5 minutes, which is acceptable.

### Consequences

- **Positive:** Single schedule, single entry point, single CloudWatch log group. Operationally clean.
- **Positive:** Internal gate for archive evaluation is unit-testable. The scheduling behavior for the archive sub-rule can be verified without deploying to AWS.
- **Positive:** Rate-based schedules start immediately on deploy. No clock alignment required for the first invocation.
- **Negative:** Lambda is invoked 288 times per day (every 5 minutes). On 287 of those invocations, Rules 1-3 run and Rule 4 is skipped. This generates 287 Lambda invocations per day with sub-second execution time (~10ms to check the 24h gate and then run Rules 1-3). At Lambda pricing, 287 invocations × ~10ms × 512MB = negligible cost (under $0.01/month).
- **Negative:** Double-execution window exists when the Lambda is redeployed (EventBridge fires the new version before the old version's invocation has completed). Mitigated by `reservedConcurrentExecutions: 1` on the Lambda, which causes Lambda to throttle the second invocation rather than running two copies. EventBridge retries the throttled invocation with its own retry logic.
- **Accepted trade-off:** Archive evaluation may drift up to 5 minutes from the 04:00 UTC target each day. Over a month, drift could accumulate to ~2.5 hours. The gate uses a fixed 23-hour window (not clock-aligned), so the maximum daily drift is bounded by the schedule interval (5 minutes), not by accumulated drift. In practice, drift is near zero because each gate check snaps to the 5-minute tick closest to 04:00 UTC.

---

## ADR-008: Analytics Consumer — ClickHouse Cloud, ReplacingMergeTree, and SQS DLQ
Date: 2026-03-22
Status: Accepted
Decided by: Jorven (IMPL-08 planning)

### Context

IMPL-08 implements the Kinesis → ClickHouse analytics event consumer. Three concrete design decisions required documentation beyond the general ADR-002 (analytics separation) rationale: (1) whether to use ClickHouse Cloud or self-hosted EC2, (2) which ClickHouse table engine to use for idempotent writes, and (3) how to handle DLQ for a Kinesis event source mapping.

### Options Considered

**ClickHouse deployment:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A — ClickHouse Cloud (chosen) | Managed hosted service | No EC2 to manage, automated backups, HA out of the box, free tier adequate for Phase 3 | Additional cost at scale, vendor dependency |
| B — Self-hosted EC2 | Single EC2 instance (t3.medium) | Full control, lower cost at high volume | EC2 management, OS patching, manual backups, single point of failure |
| C — BigQuery | GCP managed OLAP | Fully managed, no servers | Cross-cloud (GCP vs AWS), query latency (seconds not ms), per-query cost model |

**ClickHouse table engine for idempotency:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A — ReplacingMergeTree with event_id (chosen) | Deduplicates rows sharing the same `event_id` during background merge | Idempotent without application-layer checks, no separate DynamoDB dedup table | Deduplication is eventual (not immediate); requires `FINAL` for strict queries |
| B — Application-layer dedup (DynamoDB set of event_ids) | Check DynamoDB before each insert | Immediate consistency | 100 DynamoDB reads per batch, adds 5-20ms latency, DynamoDB cost |
| C — MergeTree (no dedup) | Standard append-only engine | Fastest insert | Kinesis at-least-once delivery causes duplicate rows in dashboards |

**DLQ for Kinesis event source mapping:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A — SQS Standard Queue DLQ (chosen) | Kinesis routes failed batches to SQS after retry exhaustion | Native Lambda event source mapping support, 14-day retention for investigation | DLQ messages do not contain original Kinesis data (only metadata) |
| B — Kinesis stream as DLQ | Re-route failed records to a second Kinesis stream | Full record data preserved | Manual re-routing logic required; Kinesis does not natively support Kinesis-to-Kinesis DLQ on event source mappings |
| C — No DLQ | Silent drop after retry exhaustion | Simplest setup | Undetectable permanent failures; analytics gaps not alertable |

### Decision

1. **ClickHouse Cloud** for managed operation. The free tier is sufficient for Phase 3 (~10K events/day). When volume exceeds the free tier, evaluate cost against a t3.medium EC2 instance.
2. **ReplacingMergeTree with SHA-256 `event_id`** for idempotency. The `event_id` is derived deterministically from `skill_id + event_type + timestamp + input_hash`. Eventual deduplication is acceptable for analytics use cases.
3. **SQS Standard Queue DLQ** with a CloudWatch alarm (depth > 0). The DLQ is an alert mechanism, not a replay mechanism — failed records within Kinesis retention can be replayed by resetting the consumer's shard iterator.

### Reasons

ClickHouse Cloud eliminates the operational overhead that self-hosted EC2 would impose on a small team. The free tier cost is zero. BigQuery's cross-cloud network adds latency and complexity.

ReplacingMergeTree is the idiomatic ClickHouse solution for at-least-once ingestion pipelines. Avoiding a DynamoDB dedup check keeps the consumer stateless and removes a dependency on the primary datastore (ADR-002 mandates the analytics pipeline be independent of DynamoDB at runtime).

SQS DLQ is the only Lambda-native option for Kinesis event source mapping failure destinations. The alternative (no DLQ) creates undetectable analytics gaps.

### Consequences

- **Positive:** Consumer Lambda has zero runtime dependency on DynamoDB or primary tables. Full analytics isolation.
- **Positive:** `ReplacingMergeTree` deduplication requires no application code — the database engine handles it.
- **Positive:** DLQ alarm provides immediate operational visibility on consumer failures.
- **Negative:** Duplicate rows may be visible in ClickHouse between insert and background merge. Mitigated by `FINAL` keyword on time-sensitive queries.
- **Negative:** DLQ messages do not contain the original Kinesis record data. Replaying events after retry exhaustion requires resetting the Kinesis shard iterator (only possible within retention window).
- **Accepted trade-off:** 90-day TTL on `analytics_events` means events older than 90 days are permanently deleted from ClickHouse. Decision Engine historical analysis is limited to a 90-day window. This is acceptable — the Decision Engine's longest lookback window is 30 days (Query A in `docs/decision-engine.md` §3.3).

---

## ADR-009: Test Runner Reuse and Confidence Score Formula
Date: 2026-03-22
Status: Accepted (runner-reuse clause superseded by ADR-012)
Decided by: Jorven (ARCH-08)

> **Partial supersession 2026-04-07:** The runner-reuse clause of this ADR (Decision point 1 — "Reuse existing runner Lambdas") is superseded by ADR-012. `/validate` no longer invokes runner Lambdas; it accepts caller-reported test results. The confidence score formula (Decision point 2 — `pass_count / total_tests`) remains in effect and is unchanged.

### Context

ARCH-08 designs the `/validate` endpoint, the `/evolve` SQS consumer, and the canonical promotion gate. Two decisions require explicit documentation: (1) whether `/validate` should introduce new test execution infrastructure or reuse the existing runner Lambdas from IMPL-06, and (2) what formula to use for computing a skill's `confidence` score from test results.

### Options Considered

**Test execution infrastructure:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A — Reuse runner Lambdas (chosen) | `/validate` invokes `codevolve-runner-python312` / `codevolve-runner-node22` with the same `InvokeCommand` pattern as `/execute` | Zero new Lambda functions, zero new container images, execution semantics guaranteed identical between execute and validate, sandbox isolation already in place | Runner Lambdas are invoked once per test case (N invocations for N tests), not in batch — cold start overhead applies if runner is cold |
| B — New dedicated test-runner Lambda per language | Separate Lambda that accepts a batch of test cases and runs all of them in a single invocation | Single cold start per validation run, batch execution | Duplicates the runner Lambda pattern, creates two code paths for the same execution logic, drift risk between execute and validate semantics |
| C — Docker-based test runner (ECS/Fargate) | Container that runs all tests for a skill in one job | Full OS-level isolation, arbitrary language support | ECS cold start is 30-60s (incompatible with 5-min Lambda validation timeout at scale), Fargate pricing, significant new infrastructure |

**Confidence score formula:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A — Simple pass rate: `pass_count / total_tests` (chosen) | Raw ratio of passing tests | Transparent, maps directly to canonical gate threshold (0.85 = 85% pass rate), easy to reason about, no calibration required | Does not account for test complexity, test coverage quality, or historical failure patterns |
| B — Weighted pass rate (weight by test complexity or latency) | Assign weights to tests by difficulty tier | Rewards skills that pass harder tests | Requires a complexity scoring system that does not exist yet; arbitrary weights introduce bias without data to calibrate them |
| C — Historical confidence decay | Blend test pass rate with real-world execution failure rate from analytics | More accurate reflection of real-world reliability | Requires ClickHouse query at validation time (violates analytics separation from primary path); Decision Engine already handles real-world confidence decay separately |
| D — Bayesian update from prior confidence | Blend previous confidence with new pass rate | Smooth updates, avoids wild swings | Obscures the relationship between current tests and current confidence; a skill with 10 passing tests should be at 1.0 regardless of prior history |

### Decision

1. **Reuse existing runner Lambdas** (`codevolve-runner-python312`, `codevolve-runner-node22`) for test execution in `/validate`. The handler invokes the appropriate runner once per test case, using the same `InvokeCommand` pattern specified in `docs/execution-sandbox.md` §8.3.

2. **Confidence formula: `pass_count / total_tests`** (simple pass rate). This is the authoritative confidence value written to DynamoDB after each validation run. Zero tests yields confidence 0.0, all passing yields 1.0.

### Reasons

**Runner reuse:** The core architectural constraint is that no skill implementation can access the network or filesystem, and that execution semantics must be identical between `/execute` (production path) and `/validate` (test path). Reusing the same runner Lambdas guarantees this. A test that passes validation will pass execution, because the same runtime environment is used. Introducing a separate test runner would create a divergence risk where validation and production execution differ in language version, sandbox policy, or timeout behavior — the kind of divergence that makes high confidence scores misleading.

The N-invocation-per-test-case overhead is acceptable. The default validation timeout is 120 seconds. With 128 tests (the maximum per skill) and a 10s runner timeout per test, the worst-case wall-clock time is 128 × 10s = 1,280s — well above the timeout budget. In practice, the 120s total timeout budget gates this: a skill with 128 slow tests will hit the timeout and fail remaining tests, which appropriately reduces its confidence score. Fast tests (< 100ms) complete 128 test cases in well under 120s.

**Simple pass rate:** The canonical gate threshold (`confidence >= 0.85`) needs to have a clear, auditable meaning. With a simple pass rate, `0.85` means "at least 85% of the skill's defined tests pass." This is easy to explain to contributors, easy to verify in logs, and easy to reason about when debugging a promotion failure. Weighted or blended formulas would require contributors to understand a calibration model before they could predict whether their skill will be promotable. This complexity is premature at Phase 4 — we have no execution history data against which to calibrate weights.

The Decision Engine already handles the real-world confidence decay use case (Phase 3, IMPL-10): it reads ClickHouse execution failure events and may write back a lowered confidence score to DynamoDB. This separation is intentional — `/validate` reflects test-time quality (deterministic, controlled), while the Decision Engine reflects runtime quality (probabilistic, observed). Merging these two signals into a single formula at validation time would couple the analytics pipeline into the synchronous API path, violating ADR-002.

### Consequences

- **Positive:** Validation and execution use identical sandbox environments. A passing validation test is a reliable signal that the skill will execute correctly in production.
- **Positive:** Confidence score has an unambiguous, auditable meaning for contributors and operators.
- **Positive:** No new Lambda functions, container images, or execution infrastructure introduced in Phase 4.
- **Negative:** N runner Lambda invocations per validation run (one per test case). For skills with many slow tests, this multiplies cold start overhead. Mitigated by the 120s total timeout budget.
- **Negative:** Simple pass rate is a blunt instrument — a skill that passes 9 of 10 trivial tests and fails 1 edge case gets the same score as a skill that passes 9 of 10 hard tests. Accepted for Phase 4; Phase 5 may introduce test weighting if contributor feedback identifies this as a problem.
- **Accepted trade-off:** `additional_tests` (supplied in the `/validate` request body) count toward confidence but are not persisted to the skill record. A skill that passes all its built-in tests plus 64 additional tests gets a high confidence score, but that score reflects the full combined test set. If the additional tests are not re-supplied on the next validation run, the confidence score will recalculate based only on built-in tests. This is intentional — confidence should always reflect the skill's own test suite, not a one-time augmented run.
## ADR-010: Edge Caching — CloudFront + API Gateway Response Cache + Tag-Based Invalidation
Date: 2026-03-22
Status: Proposed
Decided by: Jorven (ARCH-09)

### Context

codeVolve's read traffic is heavily skewed toward a small set of GET endpoints: `GET /skills/:id`, `GET /skills`, `GET /problems/:id`, `GET /problems`, and `GET /analytics/dashboards/:type`. These endpoints are served by Lambda functions backed by DynamoDB — every request makes at least one DynamoDB read. As agent traffic scales (automated agents issuing many resolve→execute→get-skill flows), the DynamoDB read cost grows linearly with request volume even when the underlying data has not changed.

Additionally, Phase 5 introduces the mountain visualization frontend — a React + Three.js single-page application that must be globally distributed. Serving it from an S3 bucket directly, without a CDN, means high-latency delivery outside us-east-2 and no cache benefits for static assets.

The following factors drive the edge caching design:

1. `GET /skills*` and `GET /problems*` are the dominant read pattern. Skills and problems change infrequently (minutes to hours between updates in production). A 60-second cache is a useful deflection window.
2. `GET /analytics/dashboards/:type` is fetched by dashboard refresh cycles. The underlying ClickHouse data is already eventually consistent (Kinesis delay). Serving it stale by up to 300 seconds adds no meaningful information loss beyond what the pipeline already introduces.
3. `POST /resolve`, `POST /execute`, and all write endpoints (`POST /skills`, `POST /problems`, etc.) must never be cached. Their responses are request-specific or cause state changes.
4. The mountain visualization frontend consists entirely of static assets (HTML, JS bundles, CSS, image assets) with content-hashed filenames generated by the Vite/React build. These can be cached at CDN edge for one year per asset; a new deploy changes the hash, not the cache key.
5. Cache invalidation must be reliable. A skill promoted to canonical or a problem updated must not remain stale at edge beyond the next write.

Three options were considered for the CDN layer: CloudFront (AWS-native), Fastly (third-party), and no CDN (API Gateway only with response caching enabled).

### Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A — CloudFront + API Gateway caching (chosen) | CloudFront distribution in front of API Gateway (regional) and S3 (frontend static). API Gateway stage-level cache for GET endpoints as a second layer. | AWS-native, no third-party dependency. Tag-based invalidation via CloudFront API. PriceClass_100 limits edge to US/Europe/Asia (adequate for current audience). OAC for S3 origin is security-best-practice. | Adds two layers to debug (CloudFront edge + API GW cache). Tag-based invalidation has ~seconds latency, not instant. API GW caching adds $0.02/hr per 0.5GB cache. |
| B — Fastly CDN only | Replace API Gateway with Fastly as the front door. Fastly's VCL gives fine-grained cache control. | Sophisticated purge API (instant). Excellent global PoP coverage. | Cross-cloud dependency. API keys to manage. Not AWS-native. Increases operational surface. Overkill for current scale. |
| C — No CDN, API Gateway caching only | Enable API Gateway built-in response cache at stage level. No CloudFront. | Simplest configuration. One layer. | No global CDN — API Gateway regional endpoint (us-east-2) adds round-trip latency for non-US callers. No CDN delivery for the mountain frontend (must serve from S3 directly, or API Gateway with S3 proxy, both suboptimal). Cache invalidation only via API GW flush API (invalidates entire stage cache or specific resources — coarser than CloudFront tag-based). |

### Decision

Option A: CloudFront distribution in front of both the API Gateway regional endpoint and the S3 bucket hosting the mountain visualization frontend. API Gateway stage-level response caching is also enabled as a second caching layer for GET endpoints, acting as a shield against Lambda cold starts when CloudFront cache misses occur.

### Reasons

**AWS-native and within existing perimeter.** CloudFront integrates with the existing IAM roles, Route 53 (for future custom domain), ACM (TLS), and WAF. No additional credentials, API keys, or cross-cloud billing relationships.

**Two-layer defense reduces Lambda invocations.** CloudFront serves the first cache hit. On a miss, the request reaches API Gateway, which may serve from its own cache. Only a true miss at both layers reaches the Lambda function and DynamoDB. At any meaningful scale this translates directly to DynamoDB read cost reduction.

**Tag-based CloudFront invalidation is cost-effective at scale.** Path-based invalidation charges $0.005 per path per invalidation beyond the first 1,000/month. At scale, invalidating `/skills/*` on every skill write would exhaust the free tier quickly. Tag-based invalidation groups related resources (e.g., all skill resources under the tag `skills`) and invalidates them in a single API call that counts as one invalidation — not one per cached path. This is the correct pattern for a registry with many individual skill URLs.

**PriceClass_100 matches the current agent audience.** AI agents and developers are concentrated in North America, Europe, and Asia-Pacific. PriceClass_100 covers these regions at lower cost than PriceClass_All (~40% cheaper), while still providing sub-100ms edge latency from the locations that matter.

**OAC over OAI for S3.** Origin Access Control (OAC) is the current AWS-recommended pattern for S3 origins, superseding the legacy Origin Access Identity (OAI). OAC supports all S3 bucket types including those with Object Ownership settings enforced, and uses SigV4 for signing requests to S3.

**Stale-while-revalidate for dashboards.** The `GET /analytics/dashboards/:type` endpoint returns aggregated ClickHouse data. Since the Kinesis pipeline introduces seconds-to-minutes of delay, serving cached dashboard data up to 300 seconds stale (with `stale-while-revalidate=60`) is within the existing eventual-consistency contract. Callers already cannot see data fresher than the Kinesis + ClickHouse pipeline allows.

### Consequences

- **Positive:** DynamoDB read costs for GET-heavy endpoints reduced proportionally to cache hit rate. At 80% hit rate on `GET /skills/:id`, reads are reduced by 5x.
- **Positive:** Mountain visualization frontend served globally with sub-50ms asset delivery from CloudFront edge PoPs. Static assets with 1-year cache TTL (content-hashed) have near-zero origin pull rate after initial warm.
- **Positive:** API Gateway Lambda cold start exposure reduced — API GW cache absorbs bursts without triggering new Lambda invocations.
- **Negative:** Stale reads are possible for up to 60 seconds on skill/problem GETs (90 seconds with `stale-while-revalidate=30`). This is acceptable for a skill registry where data does not change second-by-second, and is disclosed in API documentation.
- **Negative:** Cache invalidation on writes adds ~100ms of latency to write operations (CloudFront invalidation API call is asynchronous but must be initiated synchronously within the Lambda handler). The invalidation itself propagates to edge PoPs within seconds; the write response is not delayed waiting for full propagation.
- **Negative:** API Gateway response caching has a minimum cost of ~$14.40/month per 0.5GB cache size even at zero traffic. This is justified once GET traffic exceeds ~50,000 requests/day.
- **Accepted trade-off:** Two caching layers mean two potential sources of stale data during debugging. Mitigated by: (1) consistent Cache-Control headers that document TTLs, (2) `X-Cache` response header from CloudFront indicating HIT/MISS, (3) API GW cache can be flushed per-resource via the AWS Console or API during incident response.
- **Accepted trade-off:** CloudFront tag-based invalidation is eventually consistent — propagation to all edge PoPs takes 5–30 seconds. A user who hits a different edge node during this window may receive stale data. Acceptable given the 60-second base TTL makes this window already acknowledged.

---

## ADR-012: Local CLI Execution Model
Date: 2026-04-07
Status: Accepted
Decided by: Jorven

### Context

The original codeVolve architecture (ADR-006, ARCH-06) treated skill execution as a server-side operation: a caller POSTed inputs to `/execute`, the orchestration Lambda looked up the skill implementation, and invoked a sandboxed runner Lambda (`codevolve-runner-python312` or `codevolve-runner-node22`) that ran the code in an isolated environment. This model was designed to prevent untrusted skill implementations from accessing the network, filesystem, or AWS services.

During Phase 3 implementation, this design proved to be solving the wrong problem. codeVolve's core value proposition is to save AI agent API token usage by providing pre-written, retrievable scripts — scripts that agents then run in their own environments, using their own credentials and installed tools. Server-side execution inverts this: it prevents skills from using the caller's environment (their file system, their AWS credentials, their installed CLIs), which is exactly what many useful skills need. A skill that "lists S3 buckets" or "runs a local test suite" cannot work inside a sandboxed Lambda with CloudWatch-only IAM permissions.

The sandboxed model also introduced unnecessary infrastructure complexity: two additional Lambda functions, Docker-or-zip deployment per language, IAM cross-invocation grants, and per-language runner maintenance. This overhead scales with every new language added.

### Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A — Server-side sandboxed Lambda execution (original) | `/execute` invokes a runner Lambda per language; runner executes skill code in isolation | Prevents untrusted code from accessing network/FS; output deterministically computed server-side | Prevents legitimate use cases (caller's credentials, FS, CLIs); adds runner Lambda infrastructure per language; cannot sandbox arbitrary CLI tools or scripts |
| B — Local CLI execution model (chosen) | Skills are local CLI tools / scripts. Registry stores and retrieves implementations. `/execute` logs the call for analytics only. Caller runs the skill locally. | Callers use their own environment, credentials, and tools; zero runner infrastructure; any language, any tool, any CLI; simpler API surface | Registry cannot verify outputs; confidence scores are caller-reported; no server-side isolation guarantee |
| C — Hybrid: optional local or server-side | Registry supports both models; skill metadata declares which it supports | Maximum flexibility | Two code paths to maintain; API surface ambiguity; harder to reason about security model |

### Decision

Option B: the local CLI execution model. Skills stored in the registry are local CLI tools and scripts. The registry's role is **discoverability and retrieval** only — it never executes skill implementations. Execution is always the caller's responsibility.

The API surface reflects this:
- `POST /resolve` — returns the best matching skill (including its implementation text or an S3 reference to it).
- `POST /execute` — accepts caller-reported execution metadata (skill_id, inputs, latency_ms, success) and logs an analytics event. It does not run code.
- `POST /validate` — accepts caller-reported test results (pass/fail counts) and updates the skill's confidence score. It does not run tests.

### Reasons

**Execution in the caller's environment is the feature.** The use case is: an AI agent (Claude Code, etc.) fetches a skill and runs it locally — where it has access to the user's filesystem, AWS credentials, installed CLIs, and project context. A sandboxed Lambda with no network access and no filesystem cannot replicate this. The sandbox is incompatible with the core value proposition.

**Eliminating runner Lambdas removes significant operational surface.** Each supported language required a separate Lambda function, IAM role, deployment artifact, cold-start budget, and concurrency limit. Removing these collapses two layers of the call graph and eliminates the `lambda:InvokeFunction` cross-invocation IAM grants, runner timeout budget management, and per-language deployment pipelines.

**Simplicity at the right layer.** The registry is a database with a search API. Making it also an execution engine was scope creep. The caller already has an execution environment; there is no need for the registry to replicate one.

**Confidence and validation via caller-reported results.** The concern about server-side verification (can we trust caller-reported pass/fail?) is mitigated by the analytics feedback loop: if a skill is marked passing but fails in practice, real-world failure events are emitted to Kinesis, processed by the Decision Engine, and the confidence score is lowered automatically. Trust-but-verify via analytics is sufficient for a registry whose primary consumers are AI agents, not anonymous public contributors.

### Consequences

- **Positive:** Any language, any CLI tool, any script is a valid skill. Skills can use the caller's AWS credentials, filesystem, Docker, git, npm — whatever the caller's environment has.
- **Positive:** Runner Lambda infrastructure (`codevolve-runner-python312`, `codevolve-runner-node22`) is eliminated. CDK stack is simpler. No per-language deployment pipeline.
- **Positive:** `/execute` and `/validate` are lightweight analytics-logging endpoints. Their Lambda functions have minimal IAM (DynamoDB write + Kinesis PutRecord only).
- **Positive:** The execution model matches how AI agents (Claude Code) already work: fetch an artifact, run it locally.
- **Negative:** The registry cannot guarantee skill correctness at query time. A skill marked `confidence: 0.9` has passed 90% of caller-reported tests, not server-verified tests. This is a weaker guarantee than server-side execution, but acceptable given the analytics-driven feedback loop.
- **Negative:** Skills that require specific OS-level dependencies (e.g., `ffmpeg`, `aws-cli v2`, Python 3.12) will fail silently if the caller's environment lacks those dependencies. This is inherent to the local execution model and must be disclosed in skill metadata (the `tags` and `description` fields should document prerequisites).
- **Consequences for ADR-006:** ADR-006 (Lambda-per-Language Sandbox) is superseded. The runner Lambda architecture it describes was not implemented in the final system.
- **Consequences for ADR-009:** The runner-reuse clause of ADR-009 is superseded. `/validate` accepts caller-reported results. The confidence formula (`pass_count / total_tests`) from ADR-009 is unchanged.
