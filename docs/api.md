# codeVolve — API Reference

> Maintained by Quimby. Full contracts written by Jorven as part of ARCH-02.

Base URL: `https://api.codevolve.dev/v1`

---

## Table of Contents

- [Common Types](#common-types)
- [Common Headers](#common-headers)
- [Common Error Shape](#common-error-shape)
- [Pagination](#pagination)
- [POST /skills](#post-skills)
- [GET /skills/:id](#get-skillsid)
- [GET /skills/:id/versions](#get-skillsidversions)
- [GET /skills](#get-skills)
- [POST /skills/:id/promote-canonical](#post-skillsidpromote-canonical)
- [POST /skills/:id/archive](#post-skillsidarchive)
- [POST /skills/:id/unarchive](#post-skillsidunarchive)
- [POST /problems](#post-problems)
- [GET /problems/:id](#get-problemsid)
- [GET /problems](#get-problems)
- [POST /resolve](#post-resolve)
- [POST /execute](#post-execute)
- [POST /execute/chain](#post-executechain)
- [POST /validate/:skill_id](#post-validateskill_id)
- [POST /events](#post-events)
- [GET /analytics/dashboards/:type](#get-analyticsdashboardstype)
- [POST /evolve](#post-evolve) *(SQS-only — no HTTP endpoint)*

---

## Common Types

```typescript
// --- Enums ---

const SkillStatus = z.enum(["unsolved", "partial", "verified", "optimized", "archived"]);

const EventType = z.enum(["resolve", "execute", "validate", "fail", "archive", "unarchive"]);

const DashboardType = z.enum([
  "resolve-performance",
  "execution-caching",
  "skill-quality",
  "evolution-gap",
  "agent-behavior",
]);

const SupportedLanguage = z.enum([
  "python",
  "javascript",
  "typescript",
  "go",
  "rust",
  "java",
  "cpp",
  "c",
]);

// --- Reusable Schemas ---

const SkillInput = z.object({
  name: z.string().min(1).max(128),
  type: z.string().min(1).max(128),  // e.g. "number", "string[]", "Record<string, number>"
});

const SkillOutput = z.object({
  name: z.string().min(1).max(128),
  type: z.string().min(1).max(128),
});

const SkillExample = z.object({
  input: z.record(z.unknown()),      // key-value matching inputs schema
  output: z.record(z.unknown()),     // key-value matching outputs schema
});

const SkillTest = z.object({
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()),
});

const Skill = z.object({
  skill_id: z.string().uuid(),
  problem_id: z.string().uuid(),
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  version: z.number().int().positive(),             // auto-incrementing version number (sort key)
  version_label: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),  // semver display label, e.g. "1.0.0"
  is_canonical: z.boolean(),
  status: SkillStatus,
  language: SupportedLanguage,
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32),
  inputs: z.array(SkillInput).min(1),
  outputs: z.array(SkillOutput).min(1),
  examples: z.array(SkillExample).max(32),
  tests: z.array(SkillTest).max(128),
  implementation: z.string().max(1_000_000),  // inline code or s3:// ref
  confidence: z.number().min(0).max(1),
  latency_p50_ms: z.number().nonnegative().nullable(),
  latency_p95_ms: z.number().nonnegative().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const Problem = z.object({
  problem_id: z.string().uuid(),
  name: z.string().min(1).max(256),
  description: z.string().max(8192),
  difficulty: z.enum(["easy", "medium", "hard"]),
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32),
  constraints: z.string().max(4096).optional(),
  examples: z.array(z.object({
    input: z.record(z.unknown()),
    output: z.record(z.unknown()),
  })).optional().default([]),
  canonical_skill_id: z.string().uuid().nullable(),   // current canonical skill, or null if none
  skill_count: z.number().int().nonnegative(),         // denormalized count of associated skills
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const AnalyticsEvent = z.object({
  event_type: EventType,
  timestamp: z.string().datetime(),
  skill_id: z.string().uuid().nullable(),
  intent: z.string().max(1024).nullable(),
  latency_ms: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).nullable(),
  cache_hit: z.boolean(),
  input_hash: z.string().max(128).nullable(),
  success: z.boolean(),
});

const PaginationMeta = z.object({
  limit: z.number().int().positive(),
  next_token: z.string().nullable(),  // opaque string (base64-encoded DynamoDB ExclusiveStartKey). Null when no more pages.
});

const ApiError = z.object({
  error: z.object({
    code: z.string(),        // machine-readable, e.g. "SKILL_NOT_FOUND"
    message: z.string(),     // human-readable description
    details: z.record(z.unknown()).optional(),  // field-level validation errors, etc.
  }),
});
```

---

## Common Headers

All requests:

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes (POST/PUT) | Must be `application/json` |
| `Accept` | No | Defaults to `application/json` |
| `X-Request-Id` | No | Client-generated UUID for tracing. Server generates one if absent. |
| `X-Agent-Id` | No | Identifies the calling agent (e.g. `claude-code-1.0`). Used for agent-behavior analytics. |

All responses include:

| Header | Description |
|--------|-------------|
| `X-Request-Id` | Echo of client header, or server-generated UUID |
| `X-Response-Time-Ms` | Server-side processing time in milliseconds |

---

## Common Error Shape

All errors follow the `ApiError` schema above. Standard error codes:

| HTTP Status | Code | When |
|-------------|------|------|
| 400 | `VALIDATION_ERROR` | Request body or query params fail schema validation |
| 404 | `NOT_FOUND` | Resource does not exist or is archived (where applicable) |
| 409 | `CONFLICT` | Duplicate or state conflict (e.g. already canonical, already archived) |
| 422 | `PRECONDITION_FAILED` | Business rule violated (e.g. promoting skill with failing tests) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Rate Limits

Per-agent limits enforced via API Gateway usage plans (keyed by API key). Exceeding a limit returns `429 RATE_LIMITED`.

| Endpoint | Limit |
|----------|-------|
| `POST /resolve` | 100 req/min |
| `POST /execute` | 50 req/min |
| `POST /execute/chain` | 20 req/min |
| `POST /validate/:skill_id` | 30 req/min |
| `POST /events` | 10 req/min (batches of up to 100 events — effective throughput: 1,000 events/min) |
| `POST /evolve` | N/A — SQS-only, no HTTP endpoint |
| All other endpoints (CRUD, analytics reads) | 200 req/min |

API Gateway default throttle is 10,000 req/s at the account level; the per-agent limits above are the operative constraint.

---

## Pagination

List endpoints use cursor-based pagination (compatible with DynamoDB's `ExclusiveStartKey`). Query parameters:

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `limit` | integer | 20 | 100 | Number of items to return |
| `next_token` | string | — | — | Opaque cursor from a previous response's `pagination.next_token`. Omit for the first page. |

Response includes a `pagination` field using the `PaginationMeta` schema. When `pagination.next_token` is `null`, there are no more pages.

> **Note:** DynamoDB does not support cheap total counts. To count items, use a separate COUNT query or maintain a denormalized counter.

---

## POST /skills

Create a new skill.

### Request

```typescript
const CreateSkillRequest = z.object({
  problem_id: z.string().uuid(),
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  version_label: z.string().regex(/^\d+\.\d+\.\d+$/).default("0.1.0").optional(),  // semver display label; version_number is server-assigned
  status: SkillStatus.default("unsolved"),
  language: SupportedLanguage,
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),
  inputs: z.array(SkillInput).min(1),
  outputs: z.array(SkillOutput).min(1),
  examples: z.array(SkillExample).max(32).default([]),
  tests: z.array(SkillTest).max(128).default([]),
  implementation: z.string().max(1_000_000).default(""),
});
```

### Response

**201 Created**

```typescript
const CreateSkillResponse = z.object({
  skill: Skill,
});
```

Server-assigned fields: `skill_id` (new UUID), `is_canonical` (false), `version` (server-assigned, auto-incrementing integer starting at 1), `confidence` (0), `latency_p50_ms` (null), `latency_p95_ms` (null), `created_at`, `updated_at`.

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing required fields, invalid types, schema violation |
| 404 | `NOT_FOUND` | `problem_id` does not reference an existing problem |
| 409 | `CONFLICT` | Skill with same `skill_id` + `version` already exists (PK uniqueness) |

### Side Effects

- **DynamoDB write (Skills table)**: New item in Skills table.
- **DynamoDB write (Problems table)**: Increments `skill_count` on the referenced problem.
- **Kinesis event**: None (skill creation does not emit an analytics event; analytics events are for resolve/execute/validate/fail).
- **Embedding generation**: Generates embedding via Bedrock Titan v2 from `name`, `description`, `domain`, `tags` and stores directly on the skill record in DynamoDB.

---

## GET /skills/:id

Retrieve a single skill by ID.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | The `skill_id` |

### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `version` | integer | No | — | Specific version number to retrieve. When omitted, returns the latest version (query with descending sort on `version_number`, `Limit: 1`). |

### Response

**200 OK**

```typescript
const GetSkillResponse = z.object({
  skill: Skill,
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `id` is not a valid UUID |
| 404 | `NOT_FOUND` | Skill does not exist (or specified version does not exist) |

Note: Archived skills ARE returned by this endpoint. The `status` field will be `"archived"`.

### Side Effects

None.

---

## GET /skills/:id/versions

List all versions of a skill, ordered by `version_number` descending (latest first).

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | The `skill_id` |

### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `limit` | integer | No | 20 | Page size (1-100) |
| `next_token` | string | No | — | Opaque cursor from a previous response's `pagination.next_token` |

### Response

**200 OK**

```typescript
const SkillVersionSummary = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().positive(),             // version_number (sort key)
  version_label: z.string().optional(),             // semver display label, e.g. "1.0.0"
  status: SkillStatus,
  confidence: z.number().min(0).max(1),
  is_canonical: z.boolean(),
  created_at: z.string().datetime(),
});

const ListSkillVersionsResponse = z.object({
  skill_id: z.string().uuid(),
  versions: z.array(SkillVersionSummary),           // ordered by version_number desc
  pagination: PaginationMeta,
});
```

"Latest" is defined as the item with the highest `version_number`. Because `version_number` is a DynamoDB numeric sort key (`N`), descending sort is exact and correct (numeric ordering, not lexicographic).

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `id` is not a valid UUID |
| 404 | `NOT_FOUND` | No skill exists with the given `id` |

### Side Effects

None.

---

## GET /skills

List and filter skills. Returns non-archived skills by default.

### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `limit` | integer | No | 20 | Page size (1-100) |
| `next_token` | string | No | — | Opaque cursor from a previous response's `pagination.next_token` |
| `language` | string | No | — | Filter by language (exact match) |
| `domain` | string | No | — | Filter by domain (skill must include this domain). Repeatable: `?domain=sorting&domain=graphs` |
| `tag` | string | No | — | Filter by tag (skill must include this tag). Repeatable. |
| `status` | string | No | — | Filter by status. Repeatable: `?status=verified&status=optimized` |
| `problem_id` | string (UUID) | No | — | Filter by problem |
| `is_canonical` | boolean | No | — | Filter by canonical status |
| `include_archived` | boolean | No | false | If true, include archived skills in results |
| `sort_by` | string | No | — | Sort key — see note below |
| `sort_order` | string | No | `desc` | One of: `asc`, `desc` |
| `q` | string | No | — | Free-text search across `name` and `description` (basic substring match, not vector search) |

**`sort_by` — Phase 1 constraints:** Only `confidence` is supported. It maps to `GSI-language-confidence` and requires a `language` filter to be set. Requests using `created_at`, `updated_at`, or `name` will receive `400 UNSUPPORTED_SORT_KEY` — no GSI backs those fields in Phase 1.

### Response

**200 OK**

```typescript
const ListSkillsResponse = z.object({
  skills: z.array(Skill),
  pagination: PaginationMeta,
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid query parameter values (e.g. `limit` > 100, invalid `sort_by`) |

### Side Effects

None.

---

## POST /skills/:id/promote-canonical

Promote a skill to canonical status for its problem + language combination. Demotes the current canonical skill (if any) for that combination.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | The `skill_id` to promote |

### Request

No request body required.

### Response

**200 OK**

```typescript
const PromoteCanonicalResponse = z.object({
  skill: Skill,                                   // the promoted skill with is_canonical: true
  demoted_skill_id: z.string().uuid().nullable(),  // previous canonical skill, or null
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `id` is not a valid UUID |
| 404 | `NOT_FOUND` | Skill does not exist |
| 409 | `CONFLICT` | Skill is already canonical |
| 422 | `PRECONDITION_FAILED` | Skill has `confidence` < 0.85, or has no tests, or has failing tests, or `status` is not `verified` or `optimized`, or skill is archived |

### Side Effects

- **DynamoDB writes**: Update promoted skill `is_canonical = true`. If a previous canonical skill existed for same `problem_id` + `language`, update it to `is_canonical = false`.
- **Cache invalidation**: Invalidate cached resolve results for this `problem_id`.

---

## POST /skills/:id/archive

Soft-archive a skill. Archived skills are excluded from `/resolve` routing and `/skills` listings (unless `include_archived=true`). Never deletes data.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | The `skill_id` to archive |

### Request

No request body required.

### Response

**200 OK**

```typescript
const ArchiveSkillResponse = z.object({
  skill: Skill,  // with status: "archived"
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `id` is not a valid UUID |
| 404 | `NOT_FOUND` | Skill does not exist |
| 409 | `CONFLICT` | Skill is already archived |
| 422 | `PRECONDITION_FAILED` | Skill is currently canonical (must demote first) |

### Side Effects

- **DynamoDB write**: Set `status = "archived"`, set `archived_at`, update `updated_at`.
- **Cache invalidation**: Invalidate cached resolve results for this skill's `problem_id`.
- **Embedding removal**: Sets `embedding` to null on the skill record so it no longer appears in `/resolve` similarity results.

---

## POST /skills/:id/unarchive

Reverse archival of a skill, restoring it to active status.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | The `skill_id` to unarchive |

### Request

No request body required.

### Response

**200 OK**

```typescript
const UnarchiveSkillResponse = z.object({
  skill: Skill,  // with status restored to previous non-archived status (e.g. "verified", "partial")
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `id` is not a valid UUID |
| 404 | `NOT_FOUND` | Skill does not exist |
| 409 | `CONFLICT` | Skill is not archived |

### Side Effects

- **DynamoDB write**: Restore `status` to previous non-archived status (stored in `previous_status` on the archive audit record), remove `archived_at`, update `updated_at`.
- **Embedding restoration**: Regenerates embedding via Bedrock Titan v2 and stores on the skill record.

---

## POST /problems

Create a new problem.

### Request

```typescript
const CreateProblemRequest = z.object({
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(8192),
  difficulty: z.enum(["easy", "medium", "hard"]),
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),
  constraints: z.string().max(4096).optional(),
});
```

### Response

**201 Created**

```typescript
const CreateProblemResponse = z.object({
  problem: Problem,
});
```

Server-assigned fields: `problem_id` (new UUID), `created_at`, `updated_at`.

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing required fields, invalid types |
| 409 | `CONFLICT` | Problem with same `name` already exists |

### Side Effects

- **DynamoDB write**: New item in Problems table.

---

## GET /problems/:id

Get a problem and all its associated skills.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | The `problem_id` |

### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `include_archived_skills` | boolean | No | false | Include archived skills in the skills list |

### Response

**200 OK**

```typescript
const GetProblemResponse = z.object({
  problem: Problem,
  skills: z.array(Skill),   // all skills for this problem, sorted by confidence desc
  skill_count: z.number().int().nonnegative(),
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `id` is not a valid UUID |
| 404 | `NOT_FOUND` | Problem does not exist |

### Side Effects

None.

---

## GET /problems

List problems, optionally filtered by domain, difficulty, or status.

### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `domain` | string | No | — | Filter by domain (e.g. `"graphs"`, `"dynamic-programming"`) |
| `difficulty` | string | No | — | Filter by difficulty: `easy`, `medium`, `hard` |
| `status` | string | No | `"active"` | Filter by problem status |
| `limit` | integer | No | 20 | Page size (1-100) |
| `next_token` | string | No | — | Opaque cursor from a previous response's `pagination.next_token` |

**Access pattern:** When `domain` is provided, queries `GSI-status-domain` (efficient). When `domain` is omitted, falls back to a table scan with filter — prefer passing `domain` for performance.

### Response

**200 OK**

```typescript
const ListProblemsResponse = z.object({
  problems: z.array(Problem),
  pagination: PaginationMeta,
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid query parameter values |

### Side Effects

None (read-only).

---

## POST /resolve

Route a natural-language intent to the best matching skill. Embeds the intent via Bedrock, loads candidate skill embeddings from DynamoDB, and computes cosine similarity client-side in Lambda.

### Request

```typescript
const ResolveRequest = z.object({
  intent: z.string().min(1).max(1024),          // natural language description of what the caller needs
  language: SupportedLanguage.optional(),        // preferred language filter
  domain: z.array(z.string()).optional(),        // domain filter
  tags: z.array(z.string()).optional(),          // tag filter
  min_confidence: z.number().min(0).max(1).default(0),  // minimum confidence threshold
  top_k: z.number().int().min(1).max(20).default(5),    // number of candidates to return
});
```

### Response

**200 OK**

```typescript
const ResolveMatch = z.object({
  skill_id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  language: SupportedLanguage,
  version: z.number().int().positive(),
  version_label: z.string().optional(),
  status: SkillStatus,
  is_canonical: z.boolean(),
  confidence: z.number(),
  similarity_score: z.number().min(0).max(1),   // cosine similarity from vector search
  domain: z.array(z.string()),
  tags: z.array(z.string()),
});

const ResolveResponse = z.object({
  matches: z.array(ResolveMatch),              // ordered by similarity_score desc
  best_match: ResolveMatch.nullable(),          // top result, or null if no matches
  resolve_confidence: z.number().min(0).max(1), // max similarity_score, or 0
  evolve_triggered: z.boolean(),                // true if resolve_confidence < 0.7
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing `intent`, invalid filters |

Note: An empty result set is NOT an error. Returns `{ matches: [], best_match: null, resolve_confidence: 0, evolve_triggered: true }`.

### Side Effects

- **Kinesis event**: Emits `resolve` event with `intent`, `skill_id` (of best match or null), `confidence` (resolve_confidence), `latency_ms`, `success` (true if matches > 0), `cache_hit` (false for resolve).
- **Evolve trigger**: If `resolve_confidence` < 0.7, asynchronously enqueues the intent for the `/evolve` pipeline.

---

## POST /execute

Execute a skill with given inputs. Checks DynamoDB cache first (keyed by `skill_id` + `input_hash` with TTL).

### Request

```typescript
const ExecuteRequest = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().positive().optional(),  // specific version number; when omitted, uses latest version
  inputs: z.record(z.unknown()),               // key-value pairs matching the skill's input schema
  skip_cache: z.boolean().default(false),       // bypass cache read; does not affect cache write policy (writes are Decision Engine-controlled)
  timeout_ms: z.number().int().min(100).max(300_000).default(30_000),  // execution timeout
});
```

### Response

**200 OK**

```typescript
const ExecuteResponse = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().positive(),
  outputs: z.record(z.unknown()),              // key-value pairs matching the skill's output schema
  latency_ms: z.number().nonnegative(),
  cache_hit: z.boolean(),
  input_hash: z.string(),                      // SHA-256 of canonical JSON of inputs
  execution_id: z.string().uuid(),             // unique execution trace ID
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing `skill_id`, invalid `inputs` shape, inputs don't match skill's input schema |
| 404 | `NOT_FOUND` | Skill does not exist or is archived |
| 408 | `EXECUTION_TIMEOUT` | Execution exceeded `timeout_ms` |
| 504 | `EXECUTION_OOM` | Runner Lambda killed by OOM. Skill implementation exceeded 512 MB memory limit. |
| 422 | `EXECUTION_FAILED` | Skill execution threw a runtime error. `details` field contains error message and stack trace. |

### Side Effects

- **Cache read**: Check `codevolve-cache` DynamoDB table for `(skill_id, input_hash)`.
- **Execution**: If cache miss, run skill implementation in sandboxed Lambda runner for the skill's `language`.
- **Cache write**: Only when the Decision Engine has flagged this skill for caching (i.e. `execution_count > threshold AND input_repeat_rate > threshold`). Cache writes do not happen on every successful execution — caching is on-demand, triggered by the Decision Engine's automated rule. See `dynamo-schemas.md` §3 and `CLAUDE.md` Automated Decision Rules.
- **Kinesis event**: Emits `execute` event with `skill_id`, `latency_ms`, `cache_hit`, `input_hash`, `success`.
- **DynamoDB write**: Updates `latency_p50_ms` and `latency_p95_ms` on the Skill record (rolling percentile).

---

## POST /execute/chain

Execute a sequence of skills, piping outputs of one into inputs of the next. If any step fails, the chain halts and returns partial results.

### Request

```typescript
const ChainStep = z.object({
  skill_id: z.string().uuid(),
  input_mapping: z.record(z.string()).optional(),
  // Maps this step's input names to:
  //   - "$input.<field>" to reference chain-level inputs
  //   - "$steps[<index>].output.<field>" to reference a previous step's output
  //   - If omitted, passes previous step's full output as this step's input
});

const ExecuteChainRequest = z.object({
  steps: z.array(ChainStep).min(1).max(10),
  inputs: z.record(z.unknown()),               // initial inputs for the chain
  skip_cache: z.boolean().default(false),
  timeout_ms: z.number().int().min(100).max(600_000).default(60_000),  // total chain timeout
});
```

### Response

**200 OK**

```typescript
const ChainStepResult = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().positive(),
  outputs: z.record(z.unknown()),
  latency_ms: z.number().nonnegative(),
  cache_hit: z.boolean(),
  success: z.boolean(),
  error: z.string().nullable(),                // null if success, error message if failed
});

const ExecuteChainResponse = z.object({
  chain_id: z.string().uuid(),
  steps: z.array(ChainStepResult),
  final_outputs: z.record(z.unknown()).nullable(),  // last successful step's outputs, null if first step failed
  total_latency_ms: z.number().nonnegative(),
  completed_steps: z.number().int().nonnegative(),
  total_steps: z.number().int().positive(),
  success: z.boolean(),                         // true only if all steps succeeded
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Empty steps, invalid input_mapping references, invalid skill_ids |
| 404 | `NOT_FOUND` | Any referenced skill does not exist or is archived |
| 408 | `EXECUTION_TIMEOUT` | Total chain execution exceeded `timeout_ms` |

Note: Individual step failures do NOT return an error status. The response has `success: false` and the `steps` array shows which step failed. Only schema-level and timeout errors produce HTTP error codes.

### Side Effects

- **Cache read**: Per-step cache read behavior, same as `/execute`. Cache writes follow the same Decision Engine-controlled policy as `/execute` — writes only happen when the skill has been flagged for caching.
- **Kinesis events**: One `execute` event per step, plus one aggregate `execute` event for the full chain (with `input_hash` computed from chain inputs).
- **DynamoDB writes**: Latency updates per skill, same as `/execute`.

---

## POST /validate/:skill_id

Run a skill's test suite and update its confidence score. Used to establish or refresh a skill's quality metrics.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `skill_id` | string (UUID) | The skill to validate |

### Request

```typescript
const ValidateRequest = z.object({
  version: z.number().int().positive().optional(),          // specific version number; when omitted, uses latest version
  additional_tests: z.array(SkillTest).max(64).optional(),  // extra tests beyond the skill's built-in tests
  timeout_ms: z.number().int().min(1000).max(600_000).default(120_000),  // total validation timeout
});
```

Request body is optional. If omitted, runs only the skill's built-in tests.

### Response

**200 OK**

```typescript
const TestResult = z.object({
  test_index: z.number().int().nonnegative(),
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()),
  actual: z.record(z.unknown()).nullable(),   // null if execution failed
  passed: z.boolean(),
  latency_ms: z.number().nonnegative(),
  error: z.string().nullable(),               // runtime error message if execution failed
});

const ValidateResponse = z.object({
  skill_id: z.string().uuid(),
  total_tests: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  previous_confidence: z.number().min(0).max(1),
  new_confidence: z.number().min(0).max(1),   // updated confidence based on pass_rate
  status_changed: z.boolean(),
  new_status: SkillStatus,                    // status after validation
  results: z.array(TestResult),
});
```

**Confidence calculation**: `new_confidence = pass_rate` (simple for now; may incorporate latency and historical factors later).

**Status transitions after validation**:
- `pass_rate == 0` and no implementation: status stays `unsolved`
- `pass_rate > 0 && pass_rate < 1.0`: status becomes `partial`
- `pass_rate == 1.0`: status becomes `verified` (or stays `optimized` if already `optimized`)

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid `skill_id`, invalid `additional_tests` |
| 404 | `NOT_FOUND` | Skill does not exist |
| 408 | `EXECUTION_TIMEOUT` | Validation exceeded `timeout_ms` |
| 422 | `PRECONDITION_FAILED` | Skill has no tests (built-in or additional) — nothing to validate |

### Side Effects

- **Execution**: Runs each test in sandboxed Lambda, same as `/execute`.
- **DynamoDB write**: Updates `confidence`, `status`, `latency_p50_ms`, `latency_p95_ms`, `updated_at` on the Skill record.
- **Kinesis event**: Emits `validate` event with `skill_id`, `confidence` (new), `latency_ms` (total validation time), `success` (pass_rate == 1.0).
- **Evolve trigger**: If `new_confidence` < 0.7, asynchronously enqueues `skill_id` for the `/evolve` pipeline to attempt improvement.
- **Cache invalidation**: Invalidates cached execution results for this `skill_id` (since confidence/status changed).

---

## POST /events

Emit one or more analytics events to Kinesis. Events go to the analytics store (ClickHouse/BigQuery), never to DynamoDB.

### Request

```typescript
const EmitEventsRequest = z.object({
  events: z.array(
    z.object({
      event_type: EventType,
      skill_id: z.string().uuid().nullable().default(null),
      intent: z.string().max(1024).nullable().default(null),
      latency_ms: z.number().nonnegative(),
      confidence: z.number().min(0).max(1).nullable().default(null),
      cache_hit: z.boolean().default(false),
      input_hash: z.string().max(128).nullable().default(null),
      success: z.boolean(),
    })
  ).min(1).max(100),
});
```

Server-assigned fields: `timestamp` (server-side ISO8601, not client-provided).

### Response

**202 Accepted**

```typescript
const EmitEventsResponse = z.object({
  accepted: z.number().int().nonnegative(),   // number of events accepted
  kinesis_sequence_number: z.string(),         // Kinesis shard sequence for the batch
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Empty events array, invalid event shapes, batch size > 100 |

### Side Effects

- **Kinesis write**: All events written to the `codevolve-events` Kinesis stream as a `PutRecords` batch.
- **No DynamoDB writes**: Analytics events never touch the primary database.

---

## GET /analytics/dashboards/:type

Retrieve pre-aggregated dashboard data from the analytics store.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `type` | string | One of: `resolve-performance`, `execution-caching`, `skill-quality`, `evolution-gap`, `agent-behavior` |

### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `time_range` | string | No | `24h` | One of: `1h`, `6h`, `24h`, `7d`, `30d` |
| `skill_id` | string (UUID) | No | — | Filter to a specific skill (where applicable) |
| `language` | string | No | — | Filter by language |
| `domain` | string | No | — | Filter by domain |

### Response

**200 OK**

Response shape varies by dashboard type. All share a common wrapper:

```typescript
const DashboardResponse = z.object({
  type: DashboardType,
  time_range: z.string(),
  generated_at: z.string().datetime(),
  data: z.unknown(),  // type-specific payload, see below
});
```

#### `resolve-performance` data

```typescript
const ResolvePerformanceData = z.object({
  latency_p50_ms: z.number(),
  latency_p95_ms: z.number(),
  embedding_search_time_p50_ms: z.number(),
  embedding_search_time_p95_ms: z.number(),
  total_resolves: z.number().int(),
  high_confidence_rate: z.number(),           // % of resolves with confidence > 0.9
  low_confidence_rate: z.number(),            // % of resolves with confidence < 0.7
  no_match_rate: z.number(),                  // % of resolves with 0 matches
  time_series: z.array(z.object({
    bucket: z.string().datetime(),
    resolve_count: z.number().int(),
    avg_latency_ms: z.number(),
    high_confidence_pct: z.number(),
  })),
});
```

#### `execution-caching` data

```typescript
const ExecutionCachingData = z.object({
  total_executions: z.number().int(),
  cache_hit_rate: z.number(),
  cache_miss_rate: z.number(),
  avg_latency_ms: z.number(),
  input_repetition_rate: z.number(),          // % of executions with a previously-seen input_hash
  top_skills: z.array(z.object({
    skill_id: z.string(),
    name: z.string(),
    execution_count: z.number().int(),
    cache_hit_rate: z.number(),
    avg_latency_ms: z.number(),
  })).max(20),
  time_series: z.array(z.object({
    bucket: z.string().datetime(),
    execution_count: z.number().int(),
    cache_hit_rate: z.number(),
    avg_latency_ms: z.number(),
  })),
});
```

#### `skill-quality` data

```typescript
const SkillQualityData = z.object({
  total_skills: z.number().int(),
  avg_confidence: z.number(),
  status_distribution: z.object({
    unsolved: z.number().int(),
    partial: z.number().int(),
    verified: z.number().int(),
    optimized: z.number().int(),
    archived: z.number().int(),
  }),
  lowest_confidence_skills: z.array(z.object({
    skill_id: z.string(),
    name: z.string(),
    confidence: z.number(),
    failure_rate: z.number(),
  })).max(20),
  competing_implementations: z.array(z.object({
    problem_id: z.string(),
    problem_name: z.string(),
    skill_count: z.number().int(),
    confidence_spread: z.number(),            // max confidence - min confidence
  })).max(20),
  confidence_over_time: z.array(z.object({
    bucket: z.string().datetime(),
    avg_confidence: z.number(),
    validation_count: z.number().int(),
  })),
});
```

#### `evolution-gap` data

```typescript
const EvolutionGapData = z.object({
  total_unresolved_intents: z.number().int(),
  low_confidence_resolves: z.number().int(),
  failed_executions: z.number().int(),
  evolve_queue_depth: z.number().int(),
  top_unresolved_intents: z.array(z.object({
    intent: z.string(),
    occurrence_count: z.number().int(),
    last_seen: z.string().datetime(),
  })).max(20),
  low_coverage_domains: z.array(z.object({
    domain: z.string(),
    skill_count: z.number().int(),
    avg_confidence: z.number(),
    resolve_miss_rate: z.number(),
  })).max(20),
  recent_evolve_jobs: z.array(z.object({
    evolve_id: z.string(),
    intent: z.string(),
    status: z.enum(["queued", "in_progress", "completed", "failed"]),
    created_at: z.string().datetime(),
    result_skill_id: z.string().uuid().nullable(),
  })).max(20),
});
```

#### `agent-behavior` data

```typescript
const AgentBehaviorData = z.object({
  total_agents: z.number().int(),
  resolve_to_execute_rate: z.number(),         // % of resolves followed by execute within 60s
  repeated_resolve_rate: z.number(),           // % of resolves for same intent within 5 min
  abandoned_execution_rate: z.number(),        // resolves with no subsequent execute
  chain_usage_rate: z.number(),                // % of executions that are chains
  avg_chain_length: z.number(),
  top_agents: z.array(z.object({
    agent_id: z.string(),
    resolve_count: z.number().int(),
    execute_count: z.number().int(),
    chain_count: z.number().int(),
  })).max(20),
  time_series: z.array(z.object({
    bucket: z.string().datetime(),
    resolve_count: z.number().int(),
    execute_count: z.number().int(),
    conversion_rate: z.number(),
  })),
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid `type`, invalid `time_range`, invalid filter params |

### Side Effects

None. Reads from analytics store only.

---

## POST /evolve — SQS-only, no HTTP endpoint

> **The evolve pipeline is not HTTP-accessible.** There is no API Gateway route for `/evolve`. The `evolveFn` Lambda is triggered exclusively by the SQS gap queue, which is populated by the Decision Engine when a `/resolve` returns low confidence (< 0.7) or no matching skill is found. Callers cannot enqueue evolve jobs directly via HTTP.

The contract below documents the SQS message shape that the Decision Engine writes to the gap queue, and the processing behavior of `evolveFn`. It is retained here for internal reference — it does not describe an HTTP endpoint.

Trigger asynchronous skill generation or improvement. The Decision Engine enqueues work for a Claude Code agent to create a new skill (from an unresolved intent) or improve an existing weak skill.

### Request

```typescript
const EvolveRequest = z.object({
  // Exactly one of the following two modes:
  intent: z.string().min(1).max(1024).optional(),      // generate new skill from intent
  skill_id: z.string().uuid().optional(),               // improve existing skill

  // Required context:
  language: SupportedLanguage,
  domain: z.array(z.string().min(1).max(64)).min(1).max(16),
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),

  // Optional guidance:
  problem_id: z.string().uuid().optional(),             // link to existing problem
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  constraints: z.string().max(4096).optional(),         // additional constraints for the agent
}).refine(
  (data) => (data.intent != null) !== (data.skill_id != null),
  { message: "Provide exactly one of 'intent' or 'skill_id'" }
);
```

### Response

**202 Accepted**

```typescript
const EvolveResponse = z.object({
  evolve_id: z.string().uuid(),                // reference ID for this evolve request
  status: z.literal("queued"),
  intent: z.string().nullable(),
  skill_id: z.string().uuid().nullable(),
});
```

> **Phase 4 note:** Full job status tracking (poll URL, `GET /evolve/:evolve_id`, persistent job records) is deferred to Phase 4 when `/evolve` is fully implemented. In the current phase, this endpoint is fire-and-forget — it returns a reference `evolve_id` but there is no poll URL and no DynamoDB job record is created. Job tracking will be backed by a `codevolve-evolve-jobs` table defined in Phase 4.

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Neither or both of `intent`/`skill_id` provided, invalid fields |
| 404 | `NOT_FOUND` | `skill_id` does not exist, or `problem_id` does not exist |
| 409 | `CONFLICT` | An evolve job for the same `intent` or `skill_id` is already queued/in-progress |

### Side Effects

- **Kinesis write**: Emits evolve request to `codevolve-events` Kinesis stream for async pickup by the Claude Code agent pipeline.
- **Kinesis event**: Emits `fail` event if triggered by low confidence (the gap that caused this evolve is a "failure" in analytics terms). No event if manually triggered.
- **No DynamoDB write**: Evolve job persistence is deferred to Phase 4. The `evolve_id` in the response is generated server-side but not stored.
- **Async processing**: Claude Code agent picks up the job from Kinesis, generates/improves a skill, calls `POST /skills` and `POST /validate/:skill_id`.

---

## GET /

Discovery document. Returns the full endpoint index, auth schemes, rate limits, and pointers to docs. Designed for AI agents arriving at the API without prior context. No authentication required.

### Response

**200 OK**

```typescript
const DiscoveryResponse = z.object({
  service: z.literal("codevolve"),
  version: z.string(),
  description: z.string(),
  base_url: z.string(),
  docs_url: z.string(),     // https://codevolve.dev/docs
  openapi_url: z.string(),  // future: https://api.codevolve.dev/v1/openapi.json
  auth_schemes: z.record(z.string()),
  rate_limits: z.record(z.string()),
  endpoints: z.array(z.object({
    method: z.string(),
    path: z.string(),
    auth: z.enum(["none", "api_key", "cognito"]),
    description: z.string(),
  })),
});
```

### Side Effects

None.

---

## Appendix: Full Endpoint Summary

| Method | Path | Success | Auth | Emits Event |
|--------|------|---------|------|-------------|
| GET | `/` | 200 | No | No |
| POST | `/skills` | 201 | Yes | No (embedding async) |
| GET | `/skills/:id` | 200 | Yes | No |
| GET | `/skills/:id/versions` | 200 | Yes | No |
| GET | `/skills` | 200 | Yes | No |
| POST | `/skills/:id/promote-canonical` | 200 | Yes | No |
| POST | `/skills/:id/archive` | 200 | Yes | No |
| POST | `/skills/:id/unarchive` | 200 | Yes | No |
| POST | `/problems` | 201 | Yes | No |
| GET | `/problems/:id` | 200 | Yes | No |
| GET | `/problems` | 200 | Yes | No |
| POST | `/resolve` | 200 | Yes | Yes (`resolve`) |
| POST | `/execute` | 200 | Yes | Yes (`execute`) |
| POST | `/execute/chain` | 200 | Yes | Yes (`execute` per step) |
| POST | `/validate/:skill_id` | 200 | Yes | Yes (`validate`) |
| POST | `/events` | 202 | Yes | Yes (passthrough) |
| GET | `/analytics/dashboards/:type` | 200 | Yes | No |
| POST | `/evolve` | 202 | Yes | Conditional (`fail`) |
