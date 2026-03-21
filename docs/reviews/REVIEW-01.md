# REVIEW-01: DynamoDB Schemas (ARCH-01) and API Contracts (ARCH-02)

> Reviewer: Iris (review agent)
> Date: 2026-03-21
> Files reviewed: `docs/dynamo-schemas.md` (ARCH-01), `docs/api.md` (ARCH-02)
> References: `CLAUDE.md`, `docs/decisions.md` (ADR-001 through ADR-004)

---

## 1. Summary

**Verdict: Request Changes**

Both documents are thorough and well-structured. The DynamoDB schema design is thoughtful, with good use of sparse GSIs, composite keys, and a dedicated audit table. The API contracts are detailed with comprehensive Zod schemas, error codes, and side-effect documentation. However, there are several critical inconsistencies between the two specs that will cause implementation bugs if not resolved before Ada begins work. The most severe is the `is_archived` vs `status: "archived"` divergence, which represents two conflicting approaches to the same concept. There are also gaps in pagination design, missing version parameters, and some GSI access patterns that will not work as described.

---

## 2. Critical Issues

These must be resolved before implementation begins.

### C-01: `is_archived` field in api.md vs `status: "archived"` in dynamo-schemas.md

**Severity: Critical**
**Files: Both**

The two specs use fundamentally different mechanisms for archival:

- **dynamo-schemas.md**: Skills have `status` with valid values `unsolved | partial | verified | optimized | archived`. Archiving means setting `status = "archived"`. There is no `is_archived` attribute.
- **api.md**: The Skill Zod schema (line 90) defines `is_archived: z.boolean()` as a separate field alongside `status: SkillStatus`, and `SkillStatus` does NOT include `"archived"` (line 38: `z.enum(["unsolved", "partial", "verified", "optimized"])`).

This is a direct contradiction. The archive endpoint in api.md says "Set `is_archived = true`" (line 404), while dynamo-schemas.md says archiving sets `status = "archived"` and uses `archived_at` as the timestamp.

**Impact**: Ada will not know which approach to implement. The GSI designs depend on this choice -- `GSI-problem-status` and `GSI-status-updated` both use `status` as a key, so if archiving is a boolean flag separate from status, those GSIs will not correctly filter archived skills.

**Recommendation**: Unify on a single approach. The dynamo-schemas.md approach (`status: "archived"`) is cleaner because:
1. It keeps status as a single enum with clear state transitions
2. It works naturally with `GSI-problem-status` and `GSI-status-updated` for filtering
3. The `archived_at` timestamp provides the same information as a boolean flag

If choosing this approach, api.md must:
- Add `"archived"` to the `SkillStatus` enum
- Remove `is_archived` from the Skill schema
- Update archive/unarchive endpoint descriptions to reference `status` changes
- Update `GET /skills` to filter by `status != "archived"` by default instead of `is_archived = false`

### C-02: Offset-based pagination with DynamoDB

**Severity: Critical**
**File: api.md, Section: Pagination**

api.md defines offset-based pagination (`limit` + `offset`). DynamoDB does not support offset-based pagination -- it uses cursor-based pagination via `ExclusiveStartKey`. Implementing offset-based pagination against DynamoDB requires fetching and discarding `offset` items, which is expensive and gets progressively slower as `offset` increases.

For `offset=1000, limit=20`, DynamoDB must read 1020 items and discard the first 1000. This is both slow and costly (you pay for all 1020 read capacity units).

**Impact**: The `GET /skills` endpoint with large offsets will be unacceptably slow and expensive. At 1000+ skills, this becomes a real problem.

**Recommendation**: Switch to cursor-based pagination:
```typescript
const PaginationMeta = z.object({
  limit: z.number().int().positive(),
  next_cursor: z.string().nullable(),  // opaque base64 ExclusiveStartKey
  has_more: z.boolean(),
});
```
Remove `offset` and `total` (computing `total` requires a full scan in DynamoDB). If `total` is needed, maintain it as a denormalized counter or accept the scan cost on a dedicated count endpoint.

### C-03: `GET /skills/:id` does not specify which version to return

**Severity: Critical**
**Files: Both**

The Skills table uses composite key `(skill_id, version)`. When a client calls `GET /skills/:id`, dynamo-schemas.md says to query with `ScanIndexForward: false, Limit: 1` to get the latest version. However, api.md does not:
1. Expose a `version` query parameter to fetch a specific version
2. Document what "latest version" means (highest semver? most recently created?)
3. Provide an endpoint to list all versions of a skill

**Impact**: Clients cannot retrieve a specific version of a skill. The `/execute` endpoint accepts `skill_id` but not `version` -- it will always execute the latest version, which may differ from the version the client resolved via `/resolve`.

**Recommendation**:
- Add optional `?version=1.0.0` query param to `GET /skills/:id`
- Add `GET /skills/:id/versions` endpoint to list all versions
- The `/execute` and `/validate` endpoints should accept an optional `version` parameter
- Clarify that "latest" means highest semver (lexicographic sort on the sort key works for semver if zero-padded, but standard semver like `1.0.0` vs `10.0.0` does NOT sort correctly as strings)

### C-04: Semver string sort key does not sort correctly in DynamoDB

**Severity: Critical**
**File: dynamo-schemas.md, Section 2**

DynamoDB sorts string sort keys lexicographically. Semver strings do not sort correctly under lexicographic ordering:
- `"1.0.0" < "10.0.0" < "2.0.0"` (lexicographic)
- But semantically: `"1.0.0" < "2.0.0" < "10.0.0"`

The design note says "latest version is retrieved with `ScanIndexForward: false, Limit: 1`" -- this will return the lexicographically LAST version, not the semantically latest.

**Impact**: Once version numbers exceed single digits (e.g., version 10.0.0), the "get latest version" pattern breaks silently.

**Recommendation**: Either:
1. Zero-pad version components: `001.000.000` (ugly but sortable)
2. Use a numeric sort key like `version_number` (N) that auto-increments, and store the semver string as a regular attribute
3. Use an ISO timestamp as the sort key (most practical -- `created_at` would serve as SK, with `version` as a regular attribute)

### C-05: Missing `skill_count` and `canonical_skill_id` from Problem API schema

**Severity: Critical**
**Files: api.md, dynamo-schemas.md**

The Problem schema in dynamo-schemas.md includes `skill_count` and `canonical_skill_id` as attributes. The Problem Zod schema in api.md (lines 107-117) does NOT include either field. However, `GET /problems/:id` response does include `skill_count` at the top level (line 516), and `canonical_skill_id` is not exposed anywhere in the API.

**Impact**: Clients have no way to know which skill is canonical for a problem without listing all skills and checking `is_canonical`. The `canonical_skill_id` stored in DynamoDB is invisible to the API.

**Recommendation**: Add `canonical_skill_id` and `skill_count` to the Problem response schema (either in the Problem type or as top-level fields in GetProblemResponse as `skill_count` already is).

### C-06: `POST /skills` does not increment `skill_count` on Problems table

**Severity: Critical**
**File: api.md**

The cross-table access pattern summary in dynamo-schemas.md (Section 5) shows that `POST /skills` should do an `UpdateItem` on codevolve-problems to increment `skill_count`. However, api.md's side effects for `POST /skills` (line 243-245) only mention DynamoDB write to Skills table and embedding generation. The problem's `skill_count` increment is missing.

**Impact**: `skill_count` will be permanently zero unless this side effect is documented and implemented.

**Recommendation**: Add to `POST /skills` side effects: "Updates `skill_count` on the referenced problem in codevolve-problems (increment by 1)."

---

## 3. Non-Critical Issues

These should be fixed but will not block initial implementation.

### N-01: Missing `version` parameter on `/execute` and `/validate` requests

**Severity: Medium**
**File: api.md**

`POST /execute` accepts `skill_id` but not `version`. The dynamo-schemas.md access pattern for `/execute` shows `GetItem (PK/SK)` which requires both `skill_id` AND `version`. Without `version` in the request, the Lambda must first query for the latest version (extra read), then execute it.

Similarly, `POST /validate/:skill_id` does not accept a version parameter.

**Recommendation**: Add `version: z.string().regex(/^\d+\.\d+\.\d+$/).optional()` to both `ExecuteRequest` and `ValidateRequest`. When omitted, default to latest version.

### N-02: `GET /skills` sort options don't map well to DynamoDB

**Severity: Medium**
**File: api.md**

The `sort_by` parameter accepts `created_at`, `updated_at`, `confidence`, `name`. Only `confidence` is a GSI sort key (`GSI-language-confidence`). Sorting by `created_at`, `updated_at`, or `name` would require either:
1. A full scan + client-side sort (expensive)
2. Additional GSIs (cost)

None of these sort keys are available on the existing GSIs.

**Recommendation**: Either limit `sort_by` to values that map to existing GSIs (confidence when filtering by language), or document that non-indexed sorts are limited to the first 1000 results and performed client-side.

### N-03: `POST /skills` default version is `0.1.0` in api.md but `1.0.0` in dynamo-schemas.md

**Severity: Medium**
**Files: Both**

api.md (line 208): `version: z.string().regex(/^\d+\.\d+\.\d+$/).default("0.1.0")`
dynamo-schemas.md (line 83): "When a skill is created, `version` defaults to `1.0.0`"

**Recommendation**: Align on a single default. `0.1.0` makes more sense for a newly created skill that hasn't been validated yet.

### N-04: `POST /skills` conflict detection is imprecise

**Severity: Medium**
**File: api.md**

The 409 CONFLICT condition says "Skill with same `problem_id` + `name` + `language` + `version` already exists." But the DynamoDB primary key is `(skill_id, version)`, not `(problem_id, name, language, version)`. Enforcing uniqueness on that composite would require either:
1. A GSI with that composite key (not defined)
2. A scan/query + client-side check (expensive and racy)
3. A conditional PutItem on a different key structure

**Recommendation**: Either:
- Define a GSI to enforce this uniqueness constraint
- Use a deterministic `skill_id` derived from `(problem_id, name, language)` so the PK itself enforces uniqueness
- Simplify to just "same `skill_id` + `version` already exists" which the PK naturally enforces

### N-05: `POST /evolve` references SQS but ADR-001 chose Kinesis

**Severity: Low**
**File: api.md, line 1064**

Side effects say "Enqueues evolve job to SQS/Kinesis for async processing." ADR-001 explicitly rejected SQS in favor of Kinesis. The mention of SQS is inconsistent.

**Recommendation**: Change to "Enqueues evolve job to Kinesis" or, if a dedicated queue makes more sense for evolve jobs (which are low-volume, need exactly-once processing), document this as a deliberate exception to ADR-001.

### N-06: `POST /evolve` references a DynamoDB evolve job record but no table is defined

**Severity: Medium**
**File: api.md, line 1065**

Side effects say "Creates evolve job record (for status tracking)" and the response includes a `poll_url` for checking status. But dynamo-schemas.md defines no `codevolve-evolve-jobs` table.

**Recommendation**: Either add an evolve jobs table to dynamo-schemas.md, or clarify that evolve job tracking is deferred to a later phase and the current `/evolve` endpoint is a fire-and-forget stub.

### N-07: `examples` field on Problem table uses different structure than CLAUDE.md

**Severity: Low**
**File: dynamo-schemas.md**

The Problem `examples` attribute is defined as `L (of M)` with each map `{ input: M, output: M }`. The Problem Zod schema in api.md does not include `examples` at all. CLAUDE.md shows examples on Skills but not Problems.

This is not necessarily wrong (problems having examples makes sense), but the api.md Problem schema should include it if the DynamoDB table stores it.

**Recommendation**: Add `examples` to the Problem Zod schema in api.md, or remove it from the DynamoDB table if it's not needed.

### N-08: `POST /execute` cache write policy is inconsistent

**Severity: Medium**
**Files: Both**

api.md (line 635) says cache writes happen "if execution succeeds and not `skip_cache`" -- implying ALL successful executions are cached.

dynamo-schemas.md (line 195) says cache writes only happen "when Decision Engine has flagged this skill for caching, or on explicit cache-trigger."

These are two different caching strategies: cache-everything vs cache-on-demand.

**Recommendation**: Align on one strategy. The CLAUDE.md automated decision rules suggest cache-on-demand (`IF execution_count > threshold AND input_repeat_rate > threshold -> cache`). Document the chosen approach clearly in both specs.

### N-09: Rate limiting is mentioned but not specified

**Severity: Medium**
**File: api.md**

The error table includes 429 `RATE_LIMITED` but no rate limits are defined. What are the limits per endpoint? Per agent? Per API key?

**Recommendation**: Define rate limits, even as rough starting points. For example:
- `/resolve`: 100 req/min per agent
- `/execute`: 50 req/min per agent
- `/events`: 10 req/min (batch of 100 = 1000 events/min)
- API Gateway has a default throttle of 10,000 req/s -- document whether this is sufficient or needs customization.

### N-10: No `GET /problems` list endpoint

**Severity: Medium**
**File: api.md**

CLAUDE.md does not list a `GET /problems` (list all problems) endpoint, and api.md does not define one. However, the Problems table has `GSI-status-domain` specifically for listing active problems by domain. Without a list endpoint, this GSI is only used by the Decision Engine.

**Recommendation**: Consider adding `GET /problems` with domain/difficulty/status filters. The GSI already supports it.

---

## 4. Observations

Things to watch, not necessarily requiring changes.

### O-01: Embedding loading for `/resolve` may be expensive at scale

The `/resolve` flow loads ALL candidate skill embeddings from DynamoDB via `GSI-language-confidence`, then computes cosine similarity in Lambda. At 1,000 skills with 1024-dim embeddings (~8KB each), this is ~8MB of data per resolve call. DynamoDB charges for read capacity units proportional to item size. At 10 resolves/second, this is 80MB/s of DynamoDB reads.

ADR-004 acknowledges this and sets the migration trigger at p95 > 100ms. This is reasonable but should be monitored from day one.

### O-02: DynamoDB Streams on Skills table may duplicate analytics events

dynamo-schemas.md says Streams are enabled on codevolve-skills for analytics event emission. But api.md says Lambda handlers emit events directly to Kinesis (e.g., `/execute` emits an `execute` event). If both mechanisms are active, the same logical event could be emitted twice: once by the handler and once by the stream consumer.

**Recommendation**: Clarify which mutations emit events via Streams vs direct Kinesis writes. A clean split: CRUD mutations (create, status change) via Streams; operational events (resolve, execute, validate) via direct Kinesis writes from the handler.

### O-03: Concurrent promote-canonical race condition

Two concurrent `POST /skills/:id/promote-canonical` calls for different skills on the same problem could both succeed, leaving two canonical skills. The dynamo-schemas.md does not specify a ConditionExpression for this operation.

**Recommendation**: Use a DynamoDB transaction (TransactWriteItems) that atomically:
1. Sets the new skill's `is_canonical = true`
2. Sets the old canonical skill's `is_canonical = false`
3. Updates the problem's `canonical_skill_id`

With a condition on the problem's `canonical_skill_id` matching the expected previous value. This prevents the race.

### O-04: Archive during execution

If a skill is archived while an `/execute` call is in progress, the execution will complete but the result may be written to the cache for an archived skill. The archive handler then deletes all cache entries. Depending on timing, the new cache entry might be written AFTER the archive cleanup.

**Recommendation**: The cache write in `/execute` should check that the skill is not archived before writing. A simple approach: include `status != "archived"` as a ConditionExpression on the cache PutItem (though the cache table doesn't store skill status -- so either skip caching if the skill was archived mid-execution, or accept the minor inconsistency since the cache entry will TTL-expire anyway).

### O-05: `implementation` field at 1MB max should be validated at API Gateway

api.md sets `implementation: z.string().max(1_000_000)`. API Gateway has a default payload limit of 10MB, so this won't be rejected at the gateway level. But Lambda has a 6MB synchronous invocation payload limit. A request with a 1MB implementation plus other fields could approach this limit.

**Recommendation**: Set an explicit API Gateway request body limit (e.g., 2MB) and document it. Consider moving large implementations to S3 upload with a presigned URL flow for anything over 256KB.

### O-06: `POST /skills` does not emit a Kinesis analytics event

api.md explicitly states "Kinesis event: None" for skill creation. But dynamo-schemas.md says DynamoDB Streams on the Skills table feeds Kinesis for analytics. This means skill creation WILL produce an analytics-relevant stream event even though the handler doesn't emit one directly. This is fine but should be explicitly documented to avoid confusion.

### O-07: Auth is marked "Yes" on all endpoints but not defined

The appendix table shows Auth: Yes for all endpoints, but no authentication mechanism is defined anywhere (API keys, IAM auth, Cognito, etc.). This is acceptable for Phase 1 if auth is deferred, but should be called out as a known gap.

---

## 5. Specific Line-by-Line Findings

### dynamo-schemas.md

| Line(s) | Finding | Severity |
|---------|---------|----------|
| 83 | Default version `1.0.0` conflicts with api.md default `0.1.0` | Medium (N-03) |
| 95 | `status` includes `archived` but api.md `SkillStatus` does not | Critical (C-01) |
| 107 | `embedding` attribute is `L (of N)` -- at 1024 floats, this item will be ~10KB. Confirm DynamoDB 400KB item limit is not a concern with large implementations | Observation |
| 119-122 | `GSI-language-confidence` projects ALL attributes including `embedding`. Each item in this GSI will be ~10KB+. At 1000 skills queried for `/resolve`, this is 10MB+ of read capacity | Observation (O-01) |
| 122 | `GSI-canonical` sparse index design is clever and correct | Positive |
| 131 | `ScanIndexForward: false, Limit: 1` for latest version assumes lexicographic sort = semver sort, which is wrong | Critical (C-04) |
| 152 | DynamoDB Streams NEW_AND_OLD_IMAGES is the right choice for analytics -- gives both before/after for status changes | Positive |
| 220 | Cache invalidation on version change via Stream consumer -- good, but needs to handle the case where many cache entries exist (could be a slow batch delete) | Observation |

### api.md

| Line(s) | Finding | Severity |
|---------|---------|----------|
| 38 | `SkillStatus` does not include `"archived"` -- conflicts with dynamo-schemas.md | Critical (C-01) |
| 90 | `is_archived: z.boolean()` -- field does not exist in DynamoDB schema | Critical (C-01) |
| 99 | `implementation: z.string().max(1_000_000)` -- Lambda payload limit concern | Observation (O-05) |
| 107-117 | Problem schema missing `skill_count`, `canonical_skill_id`, `examples`, `status` | Critical (C-05), Low (N-07) |
| 131-136 | `PaginationMeta` with `total` and `offset` -- expensive with DynamoDB | Critical (C-02) |
| 186-192 | Offset-based pagination definition -- does not map to DynamoDB | Critical (C-02) |
| 208 | Default version `0.1.0` conflicts with dynamo-schemas.md `1.0.0` | Medium (N-03) |
| 239 | CONFLICT detection on `(problem_id, name, language, version)` -- no supporting GSI | Medium (N-04) |
| 301 | `sort_by` options don't map to GSI sort keys | Medium (N-02) |
| 404 | Archive side effects reference `is_archived` instead of `status` | Critical (C-01) |
| 598-603 | `ExecuteRequest` has no `version` parameter despite table PK requiring it | Medium (N-01) |
| 635 | Cache-everything vs cache-on-demand inconsistency with dynamo-schemas.md | Medium (N-08) |
| 1064 | SQS reference contradicts ADR-001 | Low (N-05) |
| 1065 | Evolve job record references non-existent table | Medium (N-06) |

---

## 6. ADR-003/004 Alignment Check

### ADR-003 (DynamoDB TTL caching)

- **dynamo-schemas.md**: Correctly defines `codevolve-cache` table with `ttl` attribute (N), TTL policy, and DynamoDB TTL configuration. Fully aligned.
- **api.md**: `/execute` correctly references "DynamoDB cache" and "DynamoDB TTL". No stale references to ElastiCache or Redis found.
- **CLAUDE.md**: Updated to reference "DynamoDB TTL" and "DynamoDB cache". Architecture diagram updated. Aligned.

**Status**: ADR-003 is properly reflected in both specs. No issues.

### ADR-004 (DynamoDB embeddings with client-side similarity)

- **dynamo-schemas.md**: Correctly defines `embedding` attribute on Skills table. `/resolve` access pattern correctly shows `GSI-language-confidence` query + client-side cosine similarity. Aligned.
- **api.md**: `/resolve` description correctly says "loads candidate skill embeddings from DynamoDB, and computes cosine similarity client-side in Lambda." No references to OpenSearch. Aligned.
- **CLAUDE.md**: Architecture diagram updated to show "DynamoDB embeddings + cosine similarity". Phase 2 updated. Aligned.
- **Stale references**: ADR-001 in decisions.md still references OpenSearch Serverless as chosen tech. This is expected (ADRs are never modified, only superseded). No action needed.
- **ADR-002** (line 177) still says "they only depend on DynamoDB and OpenSearch" -- this should be updated since ADR-004 supersedes OpenSearch. However, per the ADR maintenance rule ("never remove or modify past ADRs"), this is acceptable as-is. A note could be added.

**Status**: ADR-004 is properly reflected. Minor stale reference in ADR-002 is acceptable per ADR conventions.

---

## 7. Action Summary

| ID | Type | Summary | Priority |
|----|------|---------|----------|
| C-01 | Critical | Unify `is_archived` (api.md) vs `status: "archived"` (dynamo-schemas.md) | Must fix |
| C-02 | Critical | Replace offset-based pagination with cursor-based | Must fix |
| C-03 | Critical | Add version parameter to GET/execute/validate endpoints | Must fix |
| C-04 | Critical | Fix semver string sort key (does not sort correctly in DynamoDB) | Must fix |
| C-05 | Critical | Add `canonical_skill_id` and `skill_count` to Problem API schema | Must fix |
| C-06 | Critical | Document `skill_count` increment in POST /skills side effects | Must fix |
| N-01 | Medium | Add optional `version` to /execute and /validate requests | Should fix |
| N-02 | Medium | Align sort_by options with available GSIs | Should fix |
| N-03 | Medium | Align default version between specs | Should fix |
| N-04 | Medium | Clarify or fix skill uniqueness constraint | Should fix |
| N-05 | Low | Remove SQS reference from /evolve | Should fix |
| N-06 | Medium | Define evolve jobs table or clarify deferral | Should fix |
| N-07 | Low | Add `examples` to Problem API schema | Should fix |
| N-08 | Medium | Align cache write strategy between specs | Should fix |
| N-09 | Medium | Define rate limits | Should fix |
| N-10 | Medium | Consider adding GET /problems list endpoint | Should fix |

---

*Reviewed by Iris -- REVIEW-01 complete. Jorven should address all critical items before Ada begins implementation.*
