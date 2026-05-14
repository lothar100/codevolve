# codeVolve — API Reference

> Maintained by Quimby. Full contracts written by Jorven as part of ARCH-02.

Base URL: `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1`

---

## MCP Quickstart

Public beta supports the same core flow through the MCP server:

`resolve or exact lookup -> fetch skill -> run locally -> report feedback`

Set these environment variables before starting the MCP server:

```powershell
$env:CODEVOLVE_API_URL = "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1"
$env:CODEVOLVE_API_KEY = "<cvk_... key for write actions>"
```

Read-only routing and fetch actions do not require a key, but `feedback_skill` and `submit_skill` do. A typical first run is:

1. Bootstrap a beta key with `POST /auth/register`.
2. Call `resolve_skill` for intent routing.
3. Call `get_skill`, or read `codevolve://skills/{skill_id}`, to inspect the implementation and tests.
4. Run the implementation locally in your own environment.
5. Call `feedback_skill` with aggregate `pass_count`, `fail_count`, and `total_tests`.

Preferred MCP surfaces in beta:

- `resolve_skill`: route a natural-language intent through `POST /intent`
- `get_skill`: fetch one skill by UUID
- `feedback_skill`: report local test results through `POST /validate/{skill_id}`
- `codevolve://skills/{skill_id}`: read the full skill payload as a resource

`validate_skill` remains a compatibility alias for `feedback_skill`; use `feedback_skill` in new onboarding and launch materials.

---

## Table of Contents

- [MCP Quickstart](#mcp-quickstart)
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
- [POST /intent](#post-intent)
- [POST /chains](#post-chains)
- [POST /execute](#post-execute)
- [POST /validate/:skill_id](#post-validateskill_id)
- [POST /events](#post-events)
- [GET /analytics/dashboards/:type](#get-analyticsdashboardstype)

---

## Common Types

```typescript
// --- Enums ---

const SkillStatus = z.enum(["unsolved", "partial", "verified", "optimized", "archived"]);

const EventType = z.enum([
  "resolve",
  "execute",
  "validate",
  "fail",
  "archive",
  "unarchive",
  "evolve",
  "evolve_failed",
  "promote_canonical",
  "archive_warning",
]);

const DashboardType = z.enum([
  "intent-performance",
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
  "shell",
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

## Auth Posture

Public beta uses a mixed auth model:

- `none`: discovery, health, public registry reads, intent routing, chain planning, local execution telemetry, and analytics dashboard reads
- `api_key`: skill/problem writes, canonical promotion, validation feedback, and API key management
- `cognito`: internal or future human-user surfaces such as account status controls and trusted-mountain preferences

The current API Gateway posture intentionally keeps read and routing surfaces open so agents can discover, inspect, and route without prior onboarding. Execution still happens locally even when an endpoint itself is unauthenticated.

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
| `POST /intent` | 100 req/min |
| `POST /chains` | 20 req/min |
| `POST /execute` | 50 req/min |
| `POST /validate/:skill_id` | 30 req/min |
| `POST /events` | 10 req/min (batches of up to 100 events — effective throughput: 1,000 events/min) |
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
- **No server-side cache invalidation in beta**: Public beta does not operate a server-managed execution cache or read-through cache contract.

---

## POST /skills/:id/archive

Soft-archive a skill. Archived skills are excluded from intent routing and `/skills` listings (unless `include_archived=true`). Never deletes data.

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
- **No server-side cache invalidation in beta**: Public beta does not operate a server-managed execution cache or read-through cache contract.
- **Embedding removal**: Sets `embedding` to null on the skill record so it no longer appears in intent-routing similarity results.

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

## POST /intent

Route a natural-language intent to the best matching skill summary. The router ranks precomputed candidates using embeddings and metadata, then returns the best matches and implementation references. The caller still fetches the implementation and executes locally.

### Request

```typescript
const IntentRequest = z.object({
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
const IntentMatch = z.object({
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

const IntentResponse = z.object({
  matches: z.array(IntentMatch),              // ordered by similarity_score desc
  best_match: IntentMatch.nullable(),         // top result, or null if no matches
  intent_confidence: z.number().min(0).max(1), // max similarity_score, or 0
  evolve_triggered: z.boolean(),              // true if intent_confidence < 0.7
  chain_suggestion: z.object({
    kind: z.literal("intent_chain"),
    rationale: z.string(),
    overall_confidence: z.number().min(0).max(1),
    steps: z.array(z.object({
      step: z.number().int().positive(),
      intent: z.string(),
      confidence: z.number().min(0).max(1),
      best_match: IntentMatch.nullable(),
      input_mapping: z.record(z.string()),
    })).min(2),
  }).optional(),
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing `intent`, invalid filters |

Note: An empty result set is NOT an error. Returns `{ matches: [], best_match: null, intent_confidence: 0, evolve_triggered: true }`.

### Side Effects

- **Kinesis event**: Emits `resolve` event with `intent`, `skill_id` (of best match or null), `confidence` (intent_confidence), `latency_ms`, `success` (true if matches > 0), `cache_hit` (false for intent routing).
- **No server-side execution**: This path only routes and scores. It does not run the skill.
- **Optional chain suggestion**: Composition-shaped requests may also include `chain_suggestion`, which gives an ordered local execution plan without suppressing `best_match`.
- **Evolve trigger**: If `intent_confidence` < 0.7, asynchronously enqueues the intent for the `/evolve` pipeline.

---

## POST /chains

Resolve an ordered local-execution chain from explicit steps or from a prior `/intent` chain suggestion. The API returns a structured plan for the caller to execute locally; it does not run any step server-side.

### Request

```typescript
const ExplicitChainStep = z.object({
  intent: z.string().min(1).max(1024).optional(),
  skill_id: z.string().uuid().optional(),
  language: SupportedLanguage.optional(),
  domain: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  input_mapping: z.record(z.string()).optional(),
}).refine((step) => step.intent !== undefined || step.skill_id !== undefined);

const ChainSuggestion = IntentResponse.shape.chain_suggestion.unwrap();

const ChainRequest = z.object({
  steps: z.array(ExplicitChainStep).min(2).max(10).optional(),
  suggestion: ChainSuggestion.optional(),
});
```

### Response

**200 OK**

```typescript
const ChainPlanStep = z.object({
  step: z.number().int().positive(),
  intent: z.string().nullable(),
  input_mapping: z.record(z.string()),
  best_match: IntentMatch.nullable(),
  confidence: z.number().min(0).max(1),
  resolved: z.boolean(),
});

const ChainResponse = z.object({
  chain_id: z.string().uuid(),
  source: z.enum(["explicit", "suggestion"]),
  rationale: z.string(),
  overall_confidence: z.number().min(0).max(1),
  ready_for_local_execution: z.boolean(),
  unresolved_steps: z.number().int().nonnegative(),
  steps: z.array(ChainPlanStep),
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing both `steps` and `suggestion`, invalid step shape |

### Side Effects

- **No server-side execution**: The API returns a plan only.
- **Kinesis event**: Emits a `resolve` analytics event with a `chain:`-prefixed intent so analytics can distinguish chain planning from direct single-skill routing.

---

## POST /execute

Record a local execution report for a skill. The caller runs the skill in its own environment and submits execution metadata here. This endpoint does not run the skill server-side.

### Request

```typescript
const ExecuteRequest = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().positive().optional(),  // specific version number; when omitted, uses latest version
  inputs: z.record(z.unknown()),               // key-value pairs matching the skill's input schema
  latency_ms: z.number().nonnegative().default(0),  // caller-observed local execution time
  cache_hit: z.boolean().default(false),            // whether the caller served the run from a local memo/cache
  success: z.boolean().default(true),               // whether the caller considers the local run successful
});
```

### Response

**200 OK**

```typescript
const ExecuteResponse = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().positive(),
  execution_id: z.string().uuid(),             // unique execution trace ID
  input_hash: z.string(),                      // SHA-256 of canonical JSON of inputs
  cache_hit: z.boolean(),
  success: z.boolean(),
  acknowledged: z.boolean(),
});
```

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing `skill_id`, invalid `inputs` shape, inputs don't match skill's input schema |
| 404 | `NOT_FOUND` | Skill does not exist or is archived |

### Side Effects

- **No server-side execution**: The caller runs the skill locally; the API only records the result metadata.
- **Kinesis event**: Emits `execute` telemetry with `skill_id`, `latency_ms`, `cache_hit`, `input_hash`, `success`.
- **No server-side cache write**: Caching, if any, belongs to the caller or a separate explicit cache contract. The API should not imply a hosted runner cache.
- **DynamoDB write**: Increments `execution_count` and updates `last_executed_at` on the Skill record.

---

## POST /validate/:skill_id

Record caller-reported test feedback for a skill and update its confidence score. In the current model the caller runs tests locally and reports the results; the API updates the skill record from that feedback report. It does not launch a test runner, compare per-test outputs, or manage a server-side execution cache.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `skill_id` | string (UUID) | The skill to validate |

### Request

```typescript
const ValidateRequest = z.object({
  version: z.number().int().positive().optional(),   // specific version number; when omitted, uses latest version
  pass_count: z.number().int().nonnegative(),
  fail_count: z.number().int().nonnegative(),
  total_tests: z.number().int().positive(),
});
```

Compatibility note: callers may also send `test_pass_count`, `test_fail_count`, and `test_total`. The handler normalizes those aliases to the canonical `pass_count`, `fail_count`, and `total_tests` fields. If `total_tests` is omitted but pass/fail counts are present, the handler infers `total_tests = pass_count + fail_count`.

### Response

**200 OK**

```typescript
const ValidateResponse = z.object({
  skill_id: z.string().uuid(),
  version: z.number().int().positive(),
  total_tests: z.number().int().nonnegative(),
  pass_count: z.number().int().nonnegative(),
  fail_count: z.number().int().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  previous_confidence: z.number().min(0).max(1),
  new_confidence: z.number().min(0).max(1),   // updated confidence based on pass_rate
  confidence: z.number().min(0).max(1),       // compatibility alias of new_confidence
  status_changed: z.boolean(),
  new_status: SkillStatus,                    // status after validation
  status: SkillStatus,                        // compatibility alias of new_status
  last_validated_at: z.string().datetime(),
});
```

**Confidence calculation**: `new_confidence = pass_rate` (simple for now; may incorporate latency and historical factors later).

**Status transitions after validation**:
- `current_status == "unsolved"` and `pass_rate == 0`: status stays `unsolved`
- `fail_count == 0` and `pass_rate == 1.0` and current status is `verified` or `optimized`: status becomes or stays `optimized`
- `fail_count == 0` and `pass_rate >= 0.85`: status becomes `verified`
- all other cases: status becomes `partial`

### Errors

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid `skill_id`, invalid counts, or `pass_count + fail_count != total_tests` |
| 404 | `NOT_FOUND` | Skill does not exist |
| 409 | `SKILL_ARCHIVED` | Skill is archived and cannot be validated |

### Side Effects

- **No server-side execution**: The caller runs the tests locally.
- **DynamoDB write**: Updates `confidence`, `status`, `last_validated_at`, `test_pass_count`, and `test_fail_count` on the Skill record.
- **Kinesis event**: Emits `validate` event with `skill_id`, `confidence` (new), `latency_ms` (total validation time), `success` (pass_rate == 1.0).
- **Evolve trigger**: If `new_confidence` < 0.7, asynchronously enqueues `skill_id` for the `/evolve` pipeline to attempt improvement.
- **No server-side execution-cache invalidation in beta**: Public beta does not operate `codevolve-cache`.

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

Retrieve pre-aggregated dashboard data from the analytics store. These analytics endpoints exist in public beta, but the dashboard/mountain web frontend is not part of the public-beta contract. External beta users should treat these as API surfaces, not a committed hosted UI experience.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `type` | string | One of: `intent-performance`, `execution-caching`, `skill-quality`, `evolution-gap`, `agent-behavior` |

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

#### `intent-performance` data

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
  docs_url: z.string(),     // current public onboarding surface; defaults to the discovery URL unless PUBLIC_DOCS_URL is configured
  openapi_url: z.string(),  // e.g. https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/openapi.json
  auth_schemes: z.record(z.string()),
  rate_limits: z.record(z.string()),
  mcp: z.object({
    transport: z.literal("stdio"),
    env: z.object({
      CODEVOLVE_API_URL: z.string(),
      CODEVOLVE_API_KEY: z.string(),
      CODEVOLVE_AGENT_ID: z.string(),
    }),
    first_steps: z.array(z.string()).min(1),
    tools: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })).min(1),
    resources: z.array(z.object({
      uri: z.string(),
      description: z.string(),
    })).min(1),
    compatibility_aliases: z.array(z.object({
      name: z.string(),
      preferred_replacement: z.string(),
    })),
  }),
  endpoints: z.array(z.object({
    method: z.string(),
    path: z.string(),
    auth: z.enum(["none", "api_key", "cognito"]),
    description: z.string(),
  })),
});
```

Discovery reflects the current beta contract:

- `POST /intent` is the primary entry point for routing
- `POST /execute` records caller-owned local execution telemetry only
- `POST /validate/:skill_id` records caller-reported feedback counts rather than running tests server-side
- `mcp` exposes the stdio bootstrap env vars, first-step guidance, primary tools, resource URIs, and the `validate_skill` -> `feedback_skill` compatibility alias
- no server-managed execution cache is part of the public-beta surface

### Side Effects

None.

---

## Appendix: Full Endpoint Summary

| Method | Path | Success | Auth | Emits Event |
|--------|------|---------|------|-------------|
| GET | `/` | 200 | `none` | No |
| POST | `/skills` | 201 | `api_key` | No (embedding async) |
| GET | `/skills/:id` | 200 | `none` | No |
| GET | `/skills/:id/versions` | 200 | `none` | No |
| GET | `/skills` | 200 | `none` | No |
| POST | `/skills/:id/promote-canonical` | 200 | `api_key` | No |
| POST | `/skills/:id/archive` | 200 | `none` | No |
| POST | `/skills/:id/unarchive` | 200 | `none` | No |
| POST | `/problems` | 201 | `api_key` | No |
| GET | `/problems/:id` | 200 | `none` | No |
| GET | `/problems` | 200 | `none` | No |
| POST | `/intent` | 200 | `none` | Yes (`resolve`) |
| POST | `/execute` | 200 | `none` | Yes (`execute`) |
| POST | `/chains` | 200 | `none` | Yes (`resolve`, `intent` prefixed with `chain:`) |
| POST | `/validate/:skill_id` | 200 | `api_key` | Yes (`validate`) |
| POST | `/events` | 202 | `none` | Yes (passthrough) |
| GET | `/analytics/dashboards/:type` | 200 | `none` | No |
| POST | `/auth/register` | 201 | `none` | No |
| POST | `/auth/keys` | 201 | `api_key` | No |
| GET | `/auth/keys` | 200 | `api_key` | No |
| DELETE | `/auth/keys/:key_id` | 204 | `api_key` | No |
| POST | `/auth/accounts/:account_id/status` | 200 | `cognito` | No |
| GET | `/users/me/trusted-mountain` | 200 | `cognito` | No |
| POST | `/users/me/trusted-mountain` | 200 | `cognito` | No |
| DELETE | `/users/me/trusted-mountain/:skill_id` | 204 | `cognito` | No |
| POST | `/skills/:id/unarchive` | `none` |
| GET | `/problems` | `none` |
| GET | `/problems/:id` | `none` |
| POST | `/problems` | `api_key` |
| POST | `/intent` | `none` |
| POST | `/chains` | `none` |
| POST | `/execute` | `none` |
| POST | `/validate/:skill_id` | `api_key` |
| GET | `/analytics/dashboards/:type` | `none` |
| POST | `/auth/register` | `none` |
| POST | `/auth/keys` | `api_key` |
| GET | `/auth/keys` | `api_key` |
| DELETE | `/auth/keys/:key_id` | `api_key` |
| POST | `/auth/accounts/:account_id/status` | `cognito` |
| GET | `/users/me/trusted-mountain` | `cognito` |
| POST | `/users/me/trusted-mountain` | `cognito` |
| DELETE | `/users/me/trusted-mountain/:skill_id` | `cognito` |
