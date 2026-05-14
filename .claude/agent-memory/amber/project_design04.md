---
name: DESIGN-04 Mountain Visualization Data Shape
description: Key decisions from DESIGN-04 — mountain endpoint response schema, aggregation strategy, caching, color mapping, and open questions for IMPL-09
type: project
---

## Status
Completed 2026-03-21. Written to docs/platform-design.md §DESIGN-04. tasks/todo.md updated to [✓].

## Key Decisions

**Endpoint:** GET /analytics/dashboards/mountain (IMPL-09, Phase 3)

**Response shape:** Per-problem aggregates only. No full skill records, no embeddings, no implementation code. Each MountainProblem includes: problem_id, name, difficulty, domain, skill_count, dominant_status, skill_status_distribution (5 status buckets), execution_count_30d, and canonical_skill (nullable).

**dominant_status logic (server-computed, not client-derived):**
- optimized > verified > partial > unsolved (any skill of the higher status wins)
- Archived skills never count toward dominant_status

**Color mapping (consistent with existing system colors):**
- unsolved: #6B7280 (gray)
- partial: #F59E0B (amber)
- verified: #3B82F6 (blue)
- optimized: #10B981 (green)
- archived: #374151 (dark gray, hidden by default)

**Cache strategy:** DynamoDB codevolve-cache table, PK = "MOUNTAIN_CACHE", SK = derived from sorted query params (e.g., "v1:domain=sorting:language=python:limit=100:offset=0"). TTL = 5 minutes. Cache write failure must never fail the HTTP response.

**Aggregation source:** DynamoDB only (not ClickHouse). execution_count_30d is approximate (lifetime count from skill records, not true 30-day window). This is intentional to avoid coupling mountain to analytics infrastructure availability.

**Aggregation access pattern:**
1. Query codevolve-problems GSI-status-domain (status="active", optional domain filter)
2. Promise.all of codevolve-skills GSI-problem-status queries per problem (100 queries in parallel for default limit)
3. In-Lambda aggregation
4. Post-aggregation language filter (cannot push to GSI)
5. Cache write

**Pagination:** Offset-based (not cursor). Default limit=100, max=500.

**Response size estimate:** ~435 bytes/problem uncompressed. 1,000 problems = ~435 KB raw, ~60-80 KB gzipped. API Gateway compression should be enabled (min 1 KB).

## Open Questions for IMPL-09
1. execution_count_30d naming — lifetime count, not true 30-day window. Rename to execution_count_total?
2. Domain filter hits only domain_primary (domain[0]) — full array match deferred to Phase 5.
3. Archived problem toggle (?include_archived=true) deferred to DESIGN-05.
