# codeVolve — DynamoDB Table Schemas

> Maintained by Quimby. Designed by Jorven (ARCH-01). Ada implements directly from this spec.

---

## Table of Contents

1. [codevolve-problems](#1-codevolve-problems)
2. [codevolve-skills](#2-codevolve-skills)
3. [codevolve-cache](#3-codevolve-cache)
4. [codevolve-archive](#4-codevolve-archive)
5. [Cross-Table Access Pattern Summary](#5-cross-table-access-pattern-summary)

---

## 1. codevolve-problems

### Key Schema

| Key | Attribute | Type |
|-----|-----------|------|
| Partition Key | `problem_id` | `S` (UUID v4) |
| Sort Key | — | — |

### Attributes

| Attribute | DynamoDB Type | Description |
|-----------|---------------|-------------|
| `problem_id` | `S` | UUID v4. Primary identifier. |
| `name` | `S` | Human-readable problem name. |
| `description` | `S` | Full problem statement. |
| `difficulty` | `S` | `easy`, `medium`, `hard`. |
| `domain` | `L` (of `S`) | Domain tags, e.g. `["sorting", "graphs"]`. |
| `tags` | `L` (of `S`) | Freeform tags for filtering. |
| `constraints` | `S` | Input constraints description. |
| `examples` | `L` (of `M`) | Example input/output pairs. Each map: `{ input: M, output: M }`. |
| `skill_count` | `N` | Denormalized count of associated skills. Updated on skill create/archive. |
| `canonical_skill_id` | `S` | Points to the current canonical skill for this problem. Null if none. |
| `status` | `S` | `active` or `archived`. |
| `created_at` | `S` | ISO 8601 timestamp. |
| `updated_at` | `S` | ISO 8601 timestamp. |

### Global Secondary Indexes

| GSI Name | Partition Key | Sort Key | Projected Attributes | Purpose |
|----------|--------------|----------|----------------------|---------|
| `GSI-status-domain` | `status` (S) | `domain_primary` (S) | ALL | List active problems filtered by primary domain. `domain_primary` is a denormalized copy of `domain[0]`. |

### Access Patterns

| API Endpoint | Operation | Key / Index Used |
|-------------|-----------|------------------|
| `POST /problems` | PutItem | `problem_id` (table PK) |
| `GET /problems/:id` | GetItem | `problem_id` (table PK) |
| `GET /problems/:id` (skills) | Query | codevolve-skills `GSI-problem-status` (see Skills table) |
| `POST /skills/:id/archive` | UpdateItem (decrement `skill_count`) | `problem_id` (table PK) |
| `POST /skills/:id/unarchive` | UpdateItem (increment `skill_count`) | `problem_id` (table PK) |
| `POST /skills/:id/promote-canonical` | UpdateItem (`canonical_skill_id`) | `problem_id` (table PK) |
| Decision Engine (archive eval) | Query | `GSI-status-domain` (scan active problems) |

### Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Capacity mode | On-demand | Low-to-moderate write volume; unpredictable read spikes during seeding. |
| TTL attribute | — | Problems are never deleted; archived via `status` field. |
| Streams | None | No downstream consumers needed; archive changes go through Lambda. |

---

## 2. codevolve-skills

This is the core table. Most API endpoints read or write it.

### Key Schema

| Key | Attribute | Type |
|-----|-----------|------|
| Partition Key | `skill_id` | `S` (UUID v4) |
| Sort Key | `version_number` | `N` (auto-incrementing integer, starting at 1) |

**Design note:** Composite key `(skill_id, version_number)` allows storing multiple versions of the same skill. The latest/active version is retrieved with `ScanIndexForward: false, Limit: 1` (sorts correctly because `N` type sorts numerically) or by querying with a known version number. A `version_label` attribute (S, semver string like "1.0.0") is stored as a regular (non-key) attribute for display purposes. When a skill is created, `version_number` is server-assigned starting at 1, and `version_label` defaults to `"0.1.0"`. Subsequent updates auto-increment `version_number`.

### Attributes

| Attribute | DynamoDB Type | Description |
|-----------|---------------|-------------|
| `skill_id` | `S` | UUID v4. Partition key. |
| `version_number` | `N` | Auto-incrementing integer starting at 1. Sort key. |
| `version_label` | `S` | Semver display string (e.g. `"0.1.0"`). Regular attribute, not a key. |
| `problem_id` | `S` | UUID v4. References codevolve-problems. |
| `name` | `S` | Skill name. |
| `description` | `S` | What this skill does. |
| `is_canonical` | `BOOL` | Whether this is the canonical solution for its problem. |
| `status` | `S` | One of: `unsolved`, `partial`, `verified`, `optimized`, `archived`. |
| `language` | `S` | Programming language, e.g. `python`, `javascript`. |
| `domain` | `L` (of `S`) | Domain tags inherited from or extending the problem. |
| `tags` | `L` (of `S`) | Freeform tags for filtering. |
| `inputs` | `L` (of `M`) | Input schema. Each map: `{ name: S, type: S }`. |
| `outputs` | `L` (of `M`) | Output schema. Each map: `{ name: S, type: S }`. |
| `examples` | `L` (of `M`) | Example I/O pairs. Each map: `{ input: M, output: M }`. |
| `tests` | `L` (of `M`) | Test cases. Each map: `{ input: M, expected: M }`. |
| `implementation` | `S` | Inline code string or S3 reference (`s3://codevolve-skills/{skill_id}/{version}`). |
| `confidence` | `N` | Float 0.0 -- 1.0. Updated by `/validate`. |
| `latency_p50_ms` | `N` | Median execution latency in milliseconds. |
| `latency_p95_ms` | `N` | 95th percentile execution latency in milliseconds. |
| `embedding` | `L` (of `N`) | 1024-dimension vector from Bedrock Titan v2. Used for client-side cosine similarity in `/resolve`. Set on create, null when archived. |
| `execution_count` | `N` | Denormalized counter. Incremented by `/execute`. |
| `last_executed_at` | `S` | ISO 8601. Updated by `/execute`. |
| `optimization_flagged` | `BOOL` | Set by Decision Engine when `latency_p95 > threshold AND usage_high`. |
| `created_at` | `S` | ISO 8601 timestamp. |
| `updated_at` | `S` | ISO 8601 timestamp. |
| `archived_at` | `S` | ISO 8601. Set when `status` changes to `archived`. Null otherwise. |

### Global Secondary Indexes

| GSI Name | Partition Key | Sort Key | Projected Attributes | Purpose |
|----------|--------------|----------|----------------------|---------|
| `GSI-problem-status` | `problem_id` (S) | `status` (S) | ALL | `GET /problems/:id` — fetch all skills for a problem. Filter by status to exclude archived. |
| `GSI-language-confidence` | `language` (S) | `confidence` (N) | ALL | `GET /skills` — list skills by language, sorted by confidence descending. Used by `/resolve` for tag-based filtering after vector search. |
| `GSI-status-updated` | `status` (S) | `updated_at` (S) | ALL | Decision Engine — query skills by status (e.g. all `verified` skills, all `optimized` skills). Archive evaluation scans non-archived statuses. |
| `GSI-canonical` | `is_canonical_status` (S) | `problem_id` (S) | KEYS_ONLY + `skill_id`, `name`, `language`, `confidence` | Fast lookup of canonical skills. `is_canonical_status` is a composite string: `"true#verified"` or `"true#optimized"` — only populated when `is_canonical = true`, otherwise omitted (sparse index). |

**Sparse index note:** `GSI-canonical` uses a synthetic attribute `is_canonical_status` that is only written when `is_canonical = true`. Items where `is_canonical = false` omit this attribute entirely and do not appear in the index. This keeps the index small.

### Access Patterns

| API Endpoint | Operation | Key / Index Used |
|-------------|-----------|------------------|
| `POST /skills` | PutItem | `skill_id` + `version_number` (table PK/SK) |
| `GET /skills/:id` | Query (latest version) | `skill_id` (table PK), `ScanIndexForward: false, Limit: 1` (numeric sort key ensures correct ordering) |
| `GET /skills/:id?version=N` | GetItem | `skill_id` + `version_number` (table PK/SK) |
| `GET /skills/:id/versions` | Query (all versions, latest first) | `skill_id` (table PK), `ScanIndexForward: false` — returns all version items for this skill ordered by `version_number` descending. |
| `GET /skills` (filter by language) | Query | `GSI-language-confidence` |
| `GET /skills` (filter by tag/domain) | Query + FilterExpression | `GSI-language-confidence` with `contains(tags, :tag)` or `contains(domain, :domain)` filter |
| `GET /problems/:id` (all skills) | Query | `GSI-problem-status` with `problem_id = :pid` |
| `POST /skills/:id/promote-canonical` | UpdateItem | `skill_id` + `version_number` (table PK/SK). Sets `is_canonical = true`, writes `is_canonical_status`. |
| `POST /resolve` | Query + client-side cosine similarity | `GSI-language-confidence` to load candidates with embeddings, then compute similarity in Lambda. |
| `POST /execute` | GetItem (read skill) + UpdateItem (increment `execution_count`) | `skill_id` + `version_number` (table PK/SK) |
| `POST /execute/chain` | BatchGetItem | Multiple `skill_id` + `version_number` lookups (table PK/SK) |
| `POST /validate/:skill_id` | UpdateItem (`confidence`, `status`) | `skill_id` + `version_number` (table PK/SK) |
| `POST /evolve` | PutItem (new skill) | `skill_id` + `version_number` (table PK/SK) |
| `POST /skills/:id/archive` | UpdateItem (`status = archived`, set `archived_at`) | `skill_id` + `version_number` (table PK/SK) |
| `POST /skills/:id/unarchive` | UpdateItem (`status` reverted, remove `archived_at`) | `skill_id` + `version_number` (table PK/SK) |
| Decision Engine (optimization flag) | Query + UpdateItem | `GSI-status-updated` to find candidates; table PK/SK to update. |
| Decision Engine (archive eval) | Query | `GSI-status-updated` with status != `archived`. |

### Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Capacity mode | On-demand | Core table with unpredictable traffic from multiple agents. On-demand auto-scales. |
| TTL attribute | — | Skills are never deleted. Archived via `status` field. |
| Streams | **Enabled** (NEW_AND_OLD_IMAGES) | Stream feeds Kinesis for analytics event emission on skill create, status change, and confidence updates. |

**Stream consumers:**
- Kinesis Data Stream — emits analytics events for all skill mutations.

---

## 3. codevolve-cache

Caches execution results keyed on `(skill_id, input_hash)` to avoid redundant computation.

### Key Schema

| Key | Attribute | Type |
|-----|-----------|------|
| Partition Key | `skill_id` | `S` (UUID v4) |
| Sort Key | `input_hash` | `S` (SHA-256 hex of canonical input JSON) |

### Attributes

| Attribute | DynamoDB Type | Description |
|-----------|---------------|-------------|
| `skill_id` | `S` | References codevolve-skills. Partition key. |
| `input_hash` | `S` | SHA-256 hex digest of the canonicalized input JSON. Sort key. |
| `version_number` | `N` | Integer version number of the skill version that produced this result. Matches the `version_number` sort key (`N`) on the codevolve-skills table. |
| `output` | `M` | The cached execution output (map structure matching skill's output schema). |
| `input_snapshot` | `M` | Copy of the original input for debugging and cache validation. |
| `hit_count` | `N` | Number of times this cache entry has been served. |
| `last_hit_at` | `S` | ISO 8601. Updated on each cache hit. |
| `created_at` | `S` | ISO 8601. When the cache entry was first written. |
| `ttl` | `N` | Unix epoch seconds. DynamoDB TTL — entry auto-expires. |

### Global Secondary Indexes

| GSI Name | Partition Key | Sort Key | Projected Attributes | Purpose |
|----------|--------------|----------|----------------------|---------|
| `GSI-skill-hitcount` | `skill_id` (S) | `hit_count` (N) | KEYS_ONLY + `input_hash`, `version_number`, `last_hit_at` | Analytics: find most-hit cache entries per skill. Decision Engine uses this for cache management. |

### Access Patterns

| API Endpoint | Operation | Key / Index Used |
|-------------|-----------|------------------|
| `POST /execute` (cache check) | GetItem | `skill_id` + `input_hash` (table PK/SK) |
| `POST /execute` (cache write) | PutItem | `skill_id` + `input_hash` (table PK/SK). Only written when the Decision Engine has flagged this skill for caching (`execution_count > threshold AND input_repeat_rate > threshold`). Not written on every successful execution — this is cache-on-demand, not cache-everything. |
| `POST /execute` (cache hit update) | UpdateItem (`hit_count`, `last_hit_at`) | `skill_id` + `input_hash` (table PK/SK) |
| `POST /execute/chain` (cache check) | BatchGetItem | Multiple `skill_id` + `input_hash` lookups. |
| Decision Engine (auto-cache trigger) | PutItem | `skill_id` + `input_hash` (table PK/SK). Pre-populates cache for high-repeat inputs. |
| Decision Engine (cache analytics) | Query | `GSI-skill-hitcount` — identify high-value cache entries. |

### TTL Policy

| Setting | Value |
|---------|-------|
| TTL attribute | `ttl` |
| Default TTL | 24 hours (86400 seconds) from creation. |
| Extended TTL | 7 days (604800 seconds) for entries with `hit_count >= 10`. Decision Engine extends TTL on high-value entries. |
| Refresh on hit | No. TTL is only extended by the Decision Engine batch process, not on individual hits. This avoids hot-key write amplification. |

### Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Capacity mode | On-demand | Cache reads are bursty; `/execute` is the highest-throughput endpoint. |
| TTL attribute | `ttl` (N) | Auto-expire stale cache entries. |
| Streams | None | Cache mutations are not analytically interesting. `/execute` handler emits analytics events to Kinesis directly. |

### Cache Invalidation Rules

- When a new `version_number` is written for a skill (new PutItem in codevolve-skills), all cache entries for that `skill_id` with a different `version_number` are invalidated. Invalidation is performed by the Skills table DynamoDB Stream consumer, which issues a Query on `skill_id` + DeleteItem for stale entries.
- When a skill is archived, all cache entries for that `skill_id` are deleted in a batch cleanup triggered by the archive handler.

---

## 4. codevolve-archive

Tracks archive and unarchive operations. This is an audit log table, not a store of archived records. Archived skills and problems remain in their original tables with `status: "archived"`.

### Key Schema

| Key | Attribute | Type |
|-----|-----------|------|
| Partition Key | `entity_id` | `S` (UUID v4 — either a `skill_id` or `problem_id`) |
| Sort Key | `action_timestamp` | `S` (ISO 8601 timestamp) |

### Attributes

| Attribute | DynamoDB Type | Description |
|-----------|---------------|-------------|
| `entity_id` | `S` | The `skill_id` or `problem_id` that was archived/unarchived. Partition key. |
| `action_timestamp` | `S` | ISO 8601 timestamp of the action. Sort key. Enables chronological audit trail per entity. |
| `entity_type` | `S` | `skill` or `problem`. |
| `action` | `S` | `archive` or `unarchive`. |
| `reason` | `S` | Why the action was taken. E.g. `"decision_engine:low_usage"`, `"manual:admin"`, `"decision_engine:superseded"`. |
| `triggered_by` | `S` | `decision_engine`, `api_manual`, or `admin`. |
| `previous_status` | `S` | The entity's status before the action (e.g. `verified`, `partial`, `archived`). |
| `skill_version` | `S` | For skill archives: which version was archived. Null for problems. |
| `metadata` | `M` | Optional additional context. E.g. `{ "execution_count": 0, "last_executed_at": "...", "confidence": 0.4 }`. |

### Global Secondary Indexes

| GSI Name | Partition Key | Sort Key | Projected Attributes | Purpose |
|----------|--------------|----------|----------------------|---------|
| `GSI-type-action` | `entity_type` (S) | `action_timestamp` (S) | ALL | Query all skill archives or all problem archives in chronological order. Used by Decision Engine reporting and admin dashboards. |
| `GSI-action-timestamp` | `action` (S) | `action_timestamp` (S) | KEYS_ONLY + `entity_id`, `entity_type`, `reason` | Query all recent archives or unarchives. Used for audit reporting and reversibility tracking. |

### Access Patterns

| API Endpoint | Operation | Key / Index Used |
|-------------|-----------|------------------|
| `POST /skills/:id/archive` | PutItem | `entity_id` + `action_timestamp` (table PK/SK) |
| `POST /skills/:id/unarchive` | PutItem | `entity_id` + `action_timestamp` (table PK/SK) |
| Decision Engine (archive eval) | PutItem | `entity_id` + `action_timestamp` (table PK/SK) |
| Admin: view archive history for entity | Query | `entity_id` (table PK), sorted by `action_timestamp` |
| Admin: list recent archives | Query | `GSI-action-timestamp` with `action = "archive"` |
| Admin: list all skill archives | Query | `GSI-type-action` with `entity_type = "skill"` |

### Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Capacity mode | On-demand | Very low write volume (archive eval runs every 24h). On-demand avoids paying for idle provisioned capacity. |
| TTL attribute | — | Archive records are never deleted. Permanent audit trail. |
| Streams | None | No downstream consumers. Archive events are emitted to Kinesis by the archive handler Lambda directly. |

---

## 5. Cross-Table Access Pattern Summary

This maps every API endpoint to the DynamoDB tables and indexes it touches.

| API Endpoint | codevolve-problems | codevolve-skills | codevolve-cache | codevolve-archive |
|-------------|-------------------|-----------------|----------------|-------------------|
| `POST /skills` | UpdateItem (increment `skill_count`) | PutItem (PK/SK: `skill_id` + `version_number`) | — | — |
| `GET /skills/:id` | — | Query (PK, latest `version_number`) | — | — |
| `GET /skills/:id/versions` | — | Query (PK, all `version_number` items, descending) | — | — |
| `GET /skills` | — | Query (`GSI-language-confidence` + filters) | — | — |
| `POST /skills/:id/promote-canonical` | UpdateItem (`canonical_skill_id`) | UpdateItem (PK/SK: `skill_id` + `version_number`, `is_canonical`, `is_canonical_status`) | — | — |
| `POST /problems` | PutItem (PK) | — | — | — |
| `GET /problems/:id` | GetItem (PK) | Query (`GSI-problem-status`) | — | — |
| `POST /resolve` | — | GetItem or Query (`GSI-language-confidence`) | — | — |
| `POST /execute` | — | GetItem (`skill_id` + `version_number`) + UpdateItem (`execution_count`) | GetItem (PK/SK) + conditional PutItem + UpdateItem (`hit_count`) | — |
| `POST /execute/chain` | — | BatchGetItem (`skill_id` + `version_number`) | BatchGetItem (PK/SK) | — |
| `POST /validate/:skill_id` | — | UpdateItem (`skill_id` + `version_number`: `confidence`, `status`) | — | — |
| `POST /events` | — | — | — | — |
| `GET /analytics/dashboards/:type` | — | — | — | — |
| `POST /evolve` | — | PutItem (`skill_id` + `version_number`: new skill) | — | — |
| `POST /skills/:id/archive` | UpdateItem (decrement `skill_count`) | UpdateItem (`skill_id` + `version_number`: `status`, `archived_at`) | Delete (batch, all entries for skill) | PutItem (PK/SK) |
| `POST /skills/:id/unarchive` | UpdateItem (increment `skill_count`) | UpdateItem (`skill_id` + `version_number`: `status`, remove `archived_at`) | — | PutItem (PK/SK) |
| Decision Engine | Query (`GSI-status-domain`) | Query (`GSI-status-updated`) + UpdateItem | Query (`GSI-skill-hitcount`) + PutItem (auto-cache) + UpdateItem (TTL extend) | PutItem |

**Note:** `POST /events` and `GET /analytics/dashboards/:type` do not touch DynamoDB. Events go to Kinesis/ClickHouse. Dashboard data is read from ClickHouse/BigQuery.

---

## Key Design Decisions

1. **Skills table uses composite key `(skill_id, version_number)`** — supports version history without a separate versions table. `version_number` is a numeric (`N`) auto-incrementing integer, which sorts correctly in DynamoDB (unlike semver strings which sort lexicographically). Latest version is retrieved via descending sort key query with `Limit: 1`. A `version_label` (semver string) is stored as a regular attribute for display.

2. **Sparse GSI for canonical skills** — the `GSI-canonical` index only contains items where `is_canonical = true` by omitting the `is_canonical_status` attribute on non-canonical items. This keeps the index small and fast.

3. **Archive table is an audit log, not a data store** — archived entities remain in-place in their original tables with `status: "archived"`. The archive table records the action history for auditing and reversibility.

4. **Cache invalidation on version change** — handled by the Skills table DynamoDB Stream consumer, which deletes stale cache entries when a new skill version is written. This ensures cached outputs always correspond to the current skill implementation.

5. **On-demand capacity for all tables** — at the current project stage, traffic patterns are unpredictable (agent-driven, bursty). On-demand avoids capacity planning overhead. Revisit after traffic patterns stabilize in Phase 5.

6. **Streams only on codevolve-skills** — the Skills table is the only one with downstream consumers (Kinesis analytics). Other tables emit events through their Lambda handlers directly.

7. **Embeddings stored in DynamoDB** — per ADR-004, embedding vectors are stored directly on skill records instead of a separate OpenSearch index. Client-side cosine similarity in Lambda handles `/resolve` at current scale (<5,000 skills). Migrate to OpenSearch when p95 latency exceeds 100ms.

---

## Phase 4 — Future Tables

These tables are not implemented yet. They will be defined when the corresponding features are built out.

### codevolve-evolve-jobs (Phase 4)

Will track the lifecycle of async `/evolve` jobs — from queue intake through Claude Code agent processing to completion or failure. Required to support `GET /evolve/:evolve_id` status polling and the `recent_evolve_jobs` field in the `evolution-gap` analytics dashboard.

This table is deliberately deferred because `/evolve` is currently fire-and-forget (Kinesis-only, no DynamoDB write). Full job tracking will be designed as part of the Phase 4 implementation plan.

---

*Last updated: 2026-03-21 -- ARCH-01 initial design by Jorven*
