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
Status: Accepted
Decided by: Jorven (ARCH-06)

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
