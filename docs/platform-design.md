# codeVolve — Platform Design

> Maintained by Quimby. Written by Amber.

---

## DESIGN-01: Skill Contract UX

### Overview

This spec defines the contributor experience for creating, updating, and versioning skills in codeVolve. It covers field classification, validation messaging, submission flows, versioning semantics, and minimal examples. Both AI agents (primary consumers) and human contributors (via future UI) are addressed.

---

### 1. Field Classification for Skill Creation

When a contributor POSTs to `POST /skills`, fields fall into three categories: **Required** (must be provided), **Optional** (have sensible defaults), and **Inferred** (computed by the system, never supplied by the contributor).

| Field | Category | Default | Notes |
|-------|----------|---------|-------|
| `problem_id` | Required | — | Must reference an existing, non-archived problem. UUID v4. |
| `name` | Required | — | 1-256 characters. Should be descriptive and unique within problem+language+version. |
| `description` | Required | — | Up to 4096 characters. Used for embedding generation. Quality matters for routing. |
| `language` | Required | — | One of: `python`, `javascript`, `typescript`, `go`, `rust`, `java`, `cpp`, `c`. |
| `domain` | Required | — | 1-16 string tags. At least one required. Typically inherited from the problem. |
| `inputs` | Required | — | At least one input. Each entry needs `name` (1-128 chars) and `type` (1-128 chars). |
| `outputs` | Required | — | At least one output. Same shape as inputs. |
| `version` | Optional | `"0.1.0"` | Semver string. Use default for initial submissions. |
| `status` | Optional | `"unsolved"` | One of: `unsolved`, `partial`, `verified`, `optimized`. Most contributors start with `unsolved` or `partial`. |
| `tags` | Optional | `[]` | Up to 32 freeform tags for discoverability. |
| `examples` | Optional | `[]` | Up to 32 example I/O pairs. Strongly recommended for routing quality. |
| `tests` | Optional | `[]` | Up to 128 test cases. Required before the skill can become canonical. |
| `implementation` | Optional | `""` | Inline code or S3 reference. Up to 1MB. Empty string means no implementation yet (status should be `unsolved`). |
| `skill_id` | Inferred | UUID v4 (generated) | Server generates a new UUID. Never supply this. |
| `is_canonical` | Inferred | `false` | Always `false` on creation. Set via `POST /skills/:id/promote-canonical`. |
| `is_archived` | Inferred | `false` | Always `false` on creation. Set via `POST /skills/:id/archive`. |
| `confidence` | Inferred | `0` | Set to 0 on creation. Updated by `POST /validate/:skill_id`. |
| `latency_p50_ms` | Inferred | `null` | Populated after first execution via `/execute`. |
| `latency_p95_ms` | Inferred | `null` | Populated after first execution via `/execute`. |
| `embedding` | Inferred | 1024-dim vector | Generated server-side via Bedrock Titan v2 from `name`, `description`, `domain`, and `tags`. |
| `execution_count` | Inferred | `0` | Incremented by `/execute`. |
| `last_executed_at` | Inferred | `null` | Updated by `/execute`. |
| `optimization_flagged` | Inferred | `false` | Set by Decision Engine. |
| `created_at` | Inferred | Current ISO 8601 timestamp | Server-generated. |
| `updated_at` | Inferred | Current ISO 8601 timestamp | Server-generated. Same as `created_at` on initial creation. |

---

### 2. Contributor-Facing Validation Messages

Every validation rule produces a specific, actionable error message. Errors are returned in the standard `ApiError` shape with `code: "VALIDATION_ERROR"` and a `details` object mapping field paths to error messages.

#### Response shape for validation errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Skill creation failed: 2 validation errors.",
    "details": {
      "name": "Name is required and must be between 1 and 256 characters.",
      "inputs": "At least one input is required. Provide an array with at least one { name, type } object."
    }
  }
}
```

#### Field-level validation messages

**`problem_id`**

| Rule | Error Message |
|------|---------------|
| Missing | `"problem_id is required. Provide the UUID of the problem this skill solves."` |
| Not a valid UUID | `"problem_id must be a valid UUID v4 (e.g. '550e8400-e29b-41d4-a716-446655440000')."` |
| Problem does not exist | `"No problem found with id '{problem_id}'. Verify the problem exists via GET /problems/:id."` |
| Problem is archived | `"Problem '{problem_id}' is archived. Skills cannot be added to archived problems."` |

**`name`**

| Rule | Error Message |
|------|---------------|
| Missing or empty | `"Name is required and must be between 1 and 256 characters."` |
| Exceeds 256 characters | `"Name must be at most 256 characters. Received {length} characters."` |

**`description`**

| Rule | Error Message |
|------|---------------|
| Missing | `"Description is required. Provide a clear explanation of what this skill does (up to 4096 characters)."` |
| Exceeds 4096 characters | `"Description must be at most 4096 characters. Received {length} characters. Move detailed documentation to the implementation comments."` |

**`language`**

| Rule | Error Message |
|------|---------------|
| Missing | `"Language is required. Supported values: python, javascript, typescript, go, rust, java, cpp, c."` |
| Invalid value | `"'{value}' is not a supported language. Supported values: python, javascript, typescript, go, rust, java, cpp, c."` |

**`domain`**

| Rule | Error Message |
|------|---------------|
| Missing or empty array | `"At least one domain tag is required. Provide an array like [\"sorting\", \"arrays\"]."` |
| Exceeds 16 entries | `"Domain array must contain at most 16 entries. Received {count}."` |
| Entry empty or exceeds 64 chars | `"Each domain tag must be between 1 and 64 characters. Entry at index {i} is invalid."` |

**`tags`**

| Rule | Error Message |
|------|---------------|
| Exceeds 32 entries | `"Tags array must contain at most 32 entries. Received {count}."` |
| Entry empty or exceeds 64 chars | `"Each tag must be between 1 and 64 characters. Tag at index {i} is invalid."` |

**`inputs`**

| Rule | Error Message |
|------|---------------|
| Missing or empty array | `"At least one input is required. Provide an array with at least one { name, type } object."` |
| Entry missing `name` | `"Input at index {i} is missing 'name'. Each input must have a name (1-128 characters)."` |
| Entry missing `type` | `"Input at index {i} is missing 'type'. Each input must have a type (1-128 characters), e.g. 'number', 'string[]'."` |
| `name` or `type` exceeds 128 chars | `"Input at index {i}: '{field}' must be at most 128 characters."` |

**`outputs`**

| Rule | Error Message |
|------|---------------|
| Missing or empty array | `"At least one output is required. Provide an array with at least one { name, type } object."` |
| Entry missing `name` | `"Output at index {i} is missing 'name'. Each output must have a name (1-128 characters)."` |
| Entry missing `type` | `"Output at index {i} is missing 'type'. Each output must have a type (1-128 characters)."` |
| `name` or `type` exceeds 128 chars | `"Output at index {i}: '{field}' must be at most 128 characters."` |

**`version`**

| Rule | Error Message |
|------|---------------|
| Invalid format | `"Version must be a valid semver string (e.g. '1.0.0', '0.1.0'). Received '{value}'."` |

**`status`**

| Rule | Error Message |
|------|---------------|
| Invalid value | `"Status must be one of: unsolved, partial, verified, optimized. Received '{value}'."` |

**`examples`**

| Rule | Error Message |
|------|---------------|
| Exceeds 32 entries | `"Examples array must contain at most 32 entries. Received {count}."` |
| Entry missing `input` | `"Example at index {i} is missing 'input'. Each example must have { input, output } objects."` |
| Entry missing `output` | `"Example at index {i} is missing 'output'. Each example must have { input, output } objects."` |

**`tests`**

| Rule | Error Message |
|------|---------------|
| Exceeds 128 entries | `"Tests array must contain at most 128 entries. Received {count}."` |
| Entry missing `input` | `"Test at index {i} is missing 'input'. Each test must have { input, expected } objects."` |
| Entry missing `expected` | `"Test at index {i} is missing 'expected'. Each test must have { input, expected } objects."` |

**`implementation`**

| Rule | Error Message |
|------|---------------|
| Exceeds 1MB | `"Implementation must be at most 1,000,000 characters. Consider uploading large implementations to S3 and providing an s3:// reference."` |

#### Business logic errors (non-schema)

| Condition | HTTP Status | Code | Message |
|-----------|-------------|------|---------|
| `problem_id` not found | 404 | `NOT_FOUND` | `"No problem found with id '{problem_id}'. Verify the problem exists via GET /problems/:id."` |
| `problem_id` is archived | 404 | `NOT_FOUND` | `"Problem '{problem_id}' is archived. Skills cannot be added to archived problems."` |
| Duplicate skill (same problem_id + name + language + version) | 409 | `CONFLICT` | `"A skill named '{name}' in {language} version {version} already exists for problem '{problem_id}'. Use a different version number or update the existing skill."` |
| Embedding generation failure | 500 | `INTERNAL_ERROR` | `"Skill was saved but embedding generation failed. The skill will not appear in /resolve results until the embedding is regenerated. Contact support or retry by updating the skill."` |

---

### 3. Contributor Submission Flow

#### 3.1 Success Path

```
Contributor                          API (Lambda)                     AWS Services
    │                                    │                                │
    ├── POST /skills (JSON body) ──────► │                                │
    │                                    ├── 1. Parse & validate (Zod)    │
    │                                    │      Schema passes ✓           │
    │                                    ├── 2. Verify problem_id ───────►│ DynamoDB GetItem
    │                                    │      Problem exists ✓      ◄───┤
    │                                    ├── 3. Check uniqueness ────────►│ DynamoDB Query
    │                                    │      No duplicate ✓        ◄───┤
    │                                    ├── 4. Generate skill_id (UUID)  │
    │                                    ├── 5. Set inferred fields       │
    │                                    │      (confidence=0, etc.)      │
    │                                    ├── 6. Write skill ─────────────►│ DynamoDB PutItem
    │                                    │                            ◄───┤
    │                                    ├── 7. Increment problem         │
    │                                    │      skill_count ─────────────►│ DynamoDB UpdateItem
    │                                    │                            ◄───┤
    │                                    ├── 8. Generate embedding ──────►│ Bedrock Titan v2
    │                                    │      (async, non-blocking) ◄───┤
    │                                    ├── 9. Store embedding ─────────►│ DynamoDB UpdateItem
    │                                    │                            ◄───┤
    │  ◄── 201 Created (full Skill) ────┤                                │
    │                                    │                                │
```

**Step-by-step detail:**

1. **Schema validation** -- The request body is parsed against the `CreateSkillRequest` Zod schema. All required fields are checked, defaults are applied for optional fields. If validation fails, return `400 VALIDATION_ERROR` immediately with field-level error messages (see Section 2).

2. **Problem existence check** -- `GetItem` on `codevolve-problems` for the given `problem_id`. If not found or archived, return `404 NOT_FOUND`.

3. **Uniqueness check** -- Query `codevolve-skills` `GSI-problem-status` for existing skills matching `problem_id` + `name` + `language` + `version`. If a match exists, return `409 CONFLICT`.

4. **Generate identifiers** -- Server generates a new UUID v4 for `skill_id`.

5. **Set inferred fields** -- `is_canonical = false`, `is_archived = false`, `confidence = 0`, `latency_p50_ms = null`, `latency_p95_ms = null`, `execution_count = 0`, `created_at = now()`, `updated_at = now()`.

6. **DynamoDB write** -- `PutItem` to `codevolve-skills` with key `(skill_id, version)`.

7. **Update problem** -- `UpdateItem` on `codevolve-problems` to increment `skill_count`.

8. **Embedding generation** -- Asynchronously calls Bedrock Titan v2 with the concatenation of `name`, `description`, `domain`, and `tags`. The embedding is a 1024-dimension float vector.

9. **Store embedding** -- `UpdateItem` on the skill record to set the `embedding` attribute.

**What the contributor receives on success:**

```json
HTTP/1.1 201 Created
Content-Type: application/json
X-Request-Id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
X-Response-Time-Ms: 142

{
  "skill": {
    "skill_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "problem_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Two Sum - Hash Map",
    "description": "Finds two numbers in an array that add up to a target using a hash map for O(n) lookup.",
    "version": "0.1.0",
    "is_canonical": false,
    "is_archived": false,
    "status": "partial",
    "language": "python",
    "domain": ["arrays", "hash-tables"],
    "tags": ["two-pointer-alternative", "leetcode-1"],
    "inputs": [
      { "name": "nums", "type": "number[]" },
      { "name": "target", "type": "number" }
    ],
    "outputs": [
      { "name": "indices", "type": "number[]" }
    ],
    "examples": [
      { "input": { "nums": [2, 7, 11, 15], "target": 9 }, "output": { "indices": [0, 1] } }
    ],
    "tests": [
      { "input": { "nums": [2, 7, 11, 15], "target": 9 }, "expected": { "indices": [0, 1] } },
      { "input": { "nums": [3, 2, 4], "target": 6 }, "expected": { "indices": [1, 2] } }
    ],
    "implementation": "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        complement = target - n\n        if complement in seen:\n            return [seen[complement], i]\n        seen[n] = i\n    return []\n",
    "confidence": 0,
    "latency_p50_ms": null,
    "latency_p95_ms": null,
    "created_at": "2026-03-21T14:30:00.000Z",
    "updated_at": "2026-03-21T14:30:00.000Z"
  }
}
```

#### 3.2 Error Path

When validation fails, the contributor receives a single response with all errors aggregated:

```json
HTTP/1.1 400 Bad Request
Content-Type: application/json
X-Request-Id: b2c3d4e5-f6a7-8901-bcde-f12345678901
X-Response-Time-Ms: 8

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Skill creation failed: 3 validation errors.",
    "details": {
      "problem_id": "problem_id is required. Provide the UUID of the problem this skill solves.",
      "language": "'ruby' is not a supported language. Supported values: python, javascript, typescript, go, rust, java, cpp, c.",
      "inputs": "At least one input is required. Provide an array with at least one { name, type } object."
    }
  }
}
```

When a business rule fails (after schema validation passes):

```json
HTTP/1.1 404 Not Found
Content-Type: application/json
X-Request-Id: c3d4e5f6-a7b8-9012-cdef-123456789012
X-Response-Time-Ms: 23

{
  "error": {
    "code": "NOT_FOUND",
    "message": "No problem found with id '550e8400-e29b-41d4-a716-446655440000'. Verify the problem exists via GET /problems/:id."
  }
}
```

#### 3.3 Agent vs Human Contributors

| Aspect | Agent (primary) | Human (future UI) |
|--------|----------------|-------------------|
| Interface | Direct `POST /skills` JSON | Web form that assembles JSON |
| Error handling | Parses `error.details` object programmatically, corrects fields, retries | Form highlights invalid fields inline with messages from `error.details` |
| Identification | Sends `X-Agent-Id` header (e.g. `claude-code-1.0`) | No `X-Agent-Id` (or UI-generated one) |
| Typical flow | Generate implementation, then POST with full payload | Fill form step-by-step; implementation may come later |
| Defaults used | Likely overrides `version` and `status`; uses all defaults for `tags`, `examples`, `tests` initially | Uses form defaults; prompted to add examples and tests before submission |
| Post-creation | Immediately calls `POST /validate/:skill_id` | Sees a "Run tests" button that calls `/validate` |

Both paths use the exact same API and error messages. The difference is only in how the consumer presents and reacts to the responses.

---

### 4. Skill Update and Versioning Flow

#### 4.1 Versioning Model

Skills use a composite DynamoDB key `(skill_id, version)`. Each version is an immutable snapshot. There is no in-place mutation of a skill's functional content (implementation, inputs, outputs, tests). The rule:

| Change type | Action | Key behavior |
|-------------|--------|-------------|
| **Functional change** -- implementation, inputs, outputs, tests, examples | New version | New sort key entry under the same `skill_id`. Previous version remains in DynamoDB. |
| **Metadata-only change** -- tags, description, name | New version | Even metadata changes create a new version for auditability. The description change affects embedding quality, so re-embedding is triggered. |
| **System-managed fields** -- confidence, latency, execution_count, embedding, optimization_flagged | In-place update | `UpdateItem` on the current `(skill_id, version)`. These are not contributor-controlled. |
| **Status transitions** -- via `/validate`, promote-canonical, archive | In-place update | Status is a system-managed lifecycle field, updated on the current version. |

#### 4.2 Creating a New Version

A contributor creates a new version by calling `POST /skills` with the same logical content but an incremented `version` field. The system treats each `(skill_id, version)` as a distinct record.

**Flow for versioning an existing skill:**

1. Contributor calls `GET /skills/:id` to retrieve the current skill (latest version returned automatically).
2. Contributor modifies the desired fields in the response body.
3. Contributor sets `version` to the next semver (e.g. `"0.1.0"` to `"0.2.0"` for minor improvements, `"1.0.0"` for breaking changes).
4. Contributor calls `POST /skills` with the updated payload. The `skill_id` field is not in the create request -- the system generates a new one.

**Important:** In the current model, `POST /skills` always creates a new `skill_id`. To create a true new version under the same `skill_id`, a future `PUT /skills/:id` endpoint will be introduced. Until then, a new "version" is effectively a new skill that references the same `problem_id`, and the relationship is tracked via `problem_id` + `name` + `language`.

#### 4.3 Version Retrieval

- `GET /skills/:id` returns the latest version by default (DynamoDB query with `ScanIndexForward: false, Limit: 1`).
- All versions remain accessible by querying with a specific version parameter (future: `GET /skills/:id?version=0.1.0`).

#### 4.4 Cache Invalidation on Version Change

When a new version is written for a skill (detected by the Skills table DynamoDB Stream), all cache entries in `codevolve-cache` for that `skill_id` with a different `skill_version` are invalidated. This ensures cached outputs always correspond to the current implementation.

#### 4.5 Canonical Skill and Versioning

- `is_canonical` is set on a specific `(skill_id, version)` record.
- When a new version is created, `is_canonical` does not carry over. The new version must be validated and promoted separately.
- This prevents untested new versions from automatically inheriting canonical status.

---

### 5. Minimal Valid Skill Example

The absolute minimum `POST /skills` body that will succeed:

#### Request

```json
POST /skills
Content-Type: application/json

{
  "problem_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Two Sum - Brute Force",
  "description": "Solves two-sum by checking all pairs.",
  "language": "python",
  "domain": ["arrays"],
  "inputs": [
    { "name": "nums", "type": "number[]" },
    { "name": "target", "type": "number" }
  ],
  "outputs": [
    { "name": "indices", "type": "number[]" }
  ]
}
```

This uses defaults for all optional fields: `version = "0.1.0"`, `status = "unsolved"`, `tags = []`, `examples = []`, `tests = []`, `implementation = ""`.

#### Response

```json
HTTP/1.1 201 Created
Content-Type: application/json
X-Request-Id: d4e5f6a7-b8c9-0123-def0-1234567890ab
X-Response-Time-Ms: 128

{
  "skill": {
    "skill_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "problem_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Two Sum - Brute Force",
    "description": "Solves two-sum by checking all pairs.",
    "version": "0.1.0",
    "is_canonical": false,
    "is_archived": false,
    "status": "unsolved",
    "language": "python",
    "domain": ["arrays"],
    "tags": [],
    "inputs": [
      { "name": "nums", "type": "number[]" },
      { "name": "target", "type": "number" }
    ],
    "outputs": [
      { "name": "indices", "type": "number[]" }
    ],
    "examples": [],
    "tests": [],
    "implementation": "",
    "confidence": 0,
    "latency_p50_ms": null,
    "latency_p95_ms": null,
    "created_at": "2026-03-21T14:30:00.000Z",
    "updated_at": "2026-03-21T14:30:00.000Z"
  }
}
```

**Note:** This minimal skill will not appear in `/resolve` results until its embedding is generated (async, typically within 1-2 seconds of creation). It cannot become canonical until it has tests, a passing implementation, and confidence >= 0.85.

---

## DESIGN-02: Analytics Dashboard Specifications

### Overview

Five dashboards power the codeVolve feedback loop. All dashboards query the `analytics_events` table in ClickHouse, which receives events from Kinesis. The table schema:

```sql
CREATE TABLE analytics_events (
    event_type   Enum8('resolve' = 1, 'execute' = 2, 'validate' = 3, 'fail' = 4),
    timestamp    DateTime64(3),
    skill_id     String,
    intent       String,
    latency_ms   Float64,
    confidence   Float64,
    cache_hit    UInt8,        -- 0 or 1
    input_hash   String,
    success      UInt8         -- 0 or 1
) ENGINE = MergeTree()
ORDER BY (event_type, timestamp);
```

### API Endpoint

All dashboards are served via `GET /analytics/dashboards/:type` where `:type` is one of: `resolve-performance`, `execution-caching`, `skill-quality`, `evolution-gap`, `agent-behavior`. Each endpoint accepts query parameters `from` and `to` (ISO8601 timestamps) to control the time range.

---

### Dashboard 1: Resolve Performance

**Purpose:** Monitor the routing layer -- how fast and how accurately intents are matched to skills.

**Refresh cadence:** Every 1 minute.

**Default time range:** Last 1 hour. Available: 15min, 1hr, 6hr, 24hr, 7d.

#### Metrics and Queries

**1a. Routing latency p50/p95 over time (time series line chart)**

```sql
SELECT
    toStartOfMinute(timestamp) AS minute,
    quantile(0.5)(latency_ms)  AS p50_ms,
    quantile(0.95)(latency_ms) AS p95_ms
FROM analytics_events
WHERE event_type = 'resolve'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY minute
ORDER BY minute;
```

**1b. Embedding search time distribution (histogram)**

Note: Requires a separate `embedding_search_ms` column or a sub-event. If embedding search time is not broken out separately, use total resolve latency as a proxy. The following assumes resolve latency approximates embedding search time since tag filtering is negligible.

```sql
SELECT
    floor(latency_ms / 10) * 10 AS bucket_ms,
    count() AS request_count
FROM analytics_events
WHERE event_type = 'resolve'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY bucket_ms
ORDER BY bucket_ms;
```

**1c. High-confidence resolve percentage (single stat + time series area chart)**

```sql
-- Current value (single stat)
SELECT
    countIf(confidence > 0.9) * 100.0 / count() AS high_confidence_pct
FROM analytics_events
WHERE event_type = 'resolve'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64};

-- Over time (area chart)
SELECT
    toStartOfMinute(timestamp) AS minute,
    countIf(confidence > 0.9) * 100.0 / count() AS high_confidence_pct
FROM analytics_events
WHERE event_type = 'resolve'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY minute
ORDER BY minute;
```

**1d. Resolve success rate (single stat)**

```sql
SELECT
    countIf(success = 1) * 100.0 / count() AS success_rate_pct
FROM analytics_events
WHERE event_type = 'resolve'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64};
```

**1e. Low-confidence resolves (table: intent, confidence, timestamp)**

```sql
SELECT
    intent,
    confidence,
    skill_id,
    timestamp
FROM analytics_events
WHERE event_type = 'resolve'
  AND confidence < 0.7
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
ORDER BY timestamp DESC
LIMIT 100;
```

#### Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| Resolve p95 latency > 200ms (5min rolling) | Warning | Notify ops channel |
| Resolve p95 latency > 500ms (5min rolling) | Critical | Page on-call |
| High-confidence % drops below 70% (1hr rolling) | Warning | Notify ops channel |
| Resolve success rate < 90% (15min rolling) | Critical | Page on-call |

#### Decision Engine Connection

- Resolves where `confidence < 0.7` or `success = 0` feed into the **evolve** rule: the Decision Engine batches these intents and sends them to `POST /evolve`.

---

### Dashboard 2: Execution & Caching (Highest Priority)

**Purpose:** Track skill execution volume, cache efficiency, and per-skill latency. This is the primary feedback surface for the auto-cache decision rule.

**Refresh cadence:** Real-time (every 15 seconds).

**Default time range:** Last 1 hour. Available: 15min, 1hr, 6hr, 24hr, 7d, 30d.

#### Metrics and Queries

**2a. Most executed skills (horizontal bar chart, top 20)**

```sql
SELECT
    skill_id,
    count() AS execution_count
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY skill_id
ORDER BY execution_count DESC
LIMIT 20;
```

**2b. Input repetition rate per skill (table with sparkline)**

```sql
SELECT
    skill_id,
    count() AS total_executions,
    uniq(input_hash) AS unique_inputs,
    1.0 - (uniq(input_hash) / count()) AS input_repeat_rate
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY skill_id
HAVING total_executions >= 10
ORDER BY input_repeat_rate DESC;
```

**2c. Cache hit/miss rate (stacked area chart over time + single stat)**

```sql
-- Over time
SELECT
    toStartOfMinute(timestamp) AS minute,
    countIf(cache_hit = 1) AS cache_hits,
    countIf(cache_hit = 0) AS cache_misses,
    countIf(cache_hit = 1) * 100.0 / count() AS hit_rate_pct
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY minute
ORDER BY minute;

-- Aggregate single stat
SELECT
    countIf(cache_hit = 1) * 100.0 / count() AS cache_hit_rate_pct
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64};
```

**2d. Execution latency per skill (heatmap: skill_id x time, color = p95 latency)**

```sql
SELECT
    skill_id,
    toStartOfFiveMinutes(timestamp) AS period,
    quantile(0.5)(latency_ms)  AS p50_ms,
    quantile(0.95)(latency_ms) AS p95_ms,
    count() AS executions
FROM analytics_events
WHERE event_type = 'execute'
  AND cache_hit = 0          -- exclude cached responses for true execution latency
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY skill_id, period
ORDER BY period, skill_id;
```

**2e. Global execution latency p50/p95 (time series line chart)**

```sql
SELECT
    toStartOfMinute(timestamp) AS minute,
    quantile(0.5)(latency_ms)  AS p50_ms,
    quantile(0.95)(latency_ms) AS p95_ms
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY minute
ORDER BY minute;
```

**2f. Cache candidates -- skills eligible for auto-caching (table)**

```sql
SELECT
    skill_id,
    count() AS execution_count,
    uniq(input_hash) AS unique_inputs,
    1.0 - (uniq(input_hash) / count()) AS input_repeat_rate,
    quantile(0.95)(latency_ms) AS p95_ms
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY skill_id
HAVING execution_count > 50
   AND input_repeat_rate > 0.3
ORDER BY execution_count * input_repeat_rate DESC
LIMIT 50;
```

#### Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| Cache hit rate < 60% (15min rolling) | Warning | Notify ops channel |
| Cache hit rate < 40% (15min rolling) | Critical | Page on-call, review cache eviction policy |
| Any skill p95 execution latency > 1000ms (5min rolling) | Warning | Flag skill for optimization |
| Global execution p95 > 500ms (5min rolling) | Warning | Notify ops channel |
| Execution failure rate > 5% (5min rolling) | Critical | Page on-call |

#### Decision Engine Connection

- **Auto-cache rule:** Query 2f directly powers the decision: `execution_count > 50 AND input_repeat_rate > 0.3` triggers `cache(skill_id, input_hash)`. The Decision Engine Lambda runs this query every 5 minutes and issues cache-warm commands to ElastiCache for qualifying skill+input pairs.
- **Optimization rule:** Skills where `p95_ms > 500 AND execution_count > 100` (high-usage, slow) are flagged for optimization. The Decision Engine marks these skills with `status = 'needs_optimization'` in DynamoDB.

---

### Dashboard 3: Skill Quality

**Purpose:** Track how well individual skills perform over time -- test pass rates, confidence trends, and real-world reliability.

**Refresh cadence:** Every 5 minutes.

**Default time range:** Last 24 hours. Available: 1hr, 24hr, 7d, 30d, 90d.

#### Metrics and Queries

**3a. Test pass rate per skill (bar chart, sorted ascending to surface worst first)**

```sql
SELECT
    skill_id,
    countIf(success = 1) AS passed,
    countIf(success = 0) AS failed,
    countIf(success = 1) * 100.0 / count() AS pass_rate_pct
FROM analytics_events
WHERE event_type = 'validate'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY skill_id
ORDER BY pass_rate_pct ASC;
```

**3b. Confidence over time per skill (multi-line time series)**

```sql
SELECT
    skill_id,
    toStartOfHour(timestamp) AS hour,
    avg(confidence) AS avg_confidence,
    min(confidence) AS min_confidence
FROM analytics_events
WHERE event_type = 'validate'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY skill_id, hour
ORDER BY hour;
```

**3c. Real-world failure rate -- execution failures, not test failures (table + time series)**

```sql
-- Per skill (table)
SELECT
    skill_id,
    count() AS total_executions,
    countIf(success = 0) AS failures,
    countIf(success = 0) * 100.0 / count() AS failure_rate_pct
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY skill_id
HAVING total_executions >= 5
ORDER BY failure_rate_pct DESC;

-- Over time (time series)
SELECT
    toStartOfHour(timestamp) AS hour,
    countIf(success = 0) * 100.0 / count() AS failure_rate_pct
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY hour
ORDER BY hour;
```

**3d. Competing implementations -- multiple skills for the same intent (table)**

Note: This query groups by intent to find intents resolved to multiple distinct skills, indicating competition.

```sql
SELECT
    intent,
    groupArray(DISTINCT skill_id) AS competing_skills,
    length(groupArray(DISTINCT skill_id)) AS num_competitors,
    max(confidence) AS best_confidence,
    min(confidence) AS worst_confidence
FROM analytics_events
WHERE event_type = 'resolve'
  AND success = 1
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY intent
HAVING num_competitors > 1
ORDER BY num_competitors DESC
LIMIT 50;
```

**3e. Confidence degradation detector (table, skills trending downward)**

```sql
WITH
    recent AS (
        SELECT skill_id, avg(confidence) AS recent_conf
        FROM analytics_events
        WHERE event_type = 'validate'
          AND timestamp BETWEEN now() - INTERVAL 1 DAY AND now()
        GROUP BY skill_id
    ),
    prior AS (
        SELECT skill_id, avg(confidence) AS prior_conf
        FROM analytics_events
        WHERE event_type = 'validate'
          AND timestamp BETWEEN now() - INTERVAL 7 DAY AND now() - INTERVAL 1 DAY
        GROUP BY skill_id
    )
SELECT
    r.skill_id,
    p.prior_conf,
    r.recent_conf,
    r.recent_conf - p.prior_conf AS confidence_delta
FROM recent r
JOIN prior p ON r.skill_id = p.skill_id
WHERE confidence_delta < -0.05
ORDER BY confidence_delta ASC;
```

#### Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| Any skill test pass rate < 80% | Warning | Flag skill, notify maintainer |
| Any skill test pass rate < 50% | Critical | Revoke `is_canonical`, trigger `/evolve` |
| Confidence drops > 0.1 over 24hr for any skill | Warning | Notify, schedule re-validation |
| Real-world failure rate > 10% for skill with > 20 executions | Critical | Disable skill, trigger `/evolve` |

#### Decision Engine Connection

- Skills with `confidence < 0.7` (from query 3b/3e) are sent to `/evolve` for agent-driven improvement.
- Skills with sustained high pass rates and high confidence are candidates for `is_canonical = true` promotion.

---

### Dashboard 4: Evolution / Gap

**Purpose:** Identify coverage gaps in the skill registry -- intents that cannot be satisfied, domains that are underserved, and failures that indicate missing capabilities.

**Refresh cadence:** Every 1 hour.

**Default time range:** Last 7 days. Available: 24hr, 7d, 30d, 90d.

#### Metrics and Queries

**4a. Unresolved intents -- intents with no skill match (table, ranked by frequency)**

```sql
SELECT
    intent,
    count() AS occurrences,
    min(timestamp) AS first_seen,
    max(timestamp) AS last_seen
FROM analytics_events
WHERE event_type = 'resolve'
  AND success = 0
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY intent
ORDER BY occurrences DESC
LIMIT 100;
```

**4b. Low-confidence resolves (table + time series)**

```sql
-- Table: most common low-confidence intents
SELECT
    intent,
    skill_id,
    count() AS occurrences,
    avg(confidence) AS avg_confidence
FROM analytics_events
WHERE event_type = 'resolve'
  AND confidence < 0.7
  AND success = 1
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY intent, skill_id
ORDER BY occurrences DESC
LIMIT 100;

-- Time series: low-confidence resolve volume
SELECT
    toStartOfHour(timestamp) AS hour,
    countIf(confidence < 0.7) AS low_confidence_count,
    count() AS total_resolves,
    countIf(confidence < 0.7) * 100.0 / count() AS low_confidence_pct
FROM analytics_events
WHERE event_type = 'resolve'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY hour
ORDER BY hour;
```

**4c. Failed executions (table: skill_id, failure count, failure rate)**

```sql
SELECT
    skill_id,
    count() AS total_executions,
    countIf(success = 0) AS failures,
    countIf(success = 0) * 100.0 / count() AS failure_rate_pct
FROM analytics_events
WHERE event_type = 'execute'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY skill_id
HAVING failures > 0
ORDER BY failures DESC
LIMIT 100;
```

**4d. Domain coverage gaps (bar chart)**

Note: This query uses the `intent` field to approximate domain. Intents are expected to contain domain prefixes (e.g., `graph:shortest-path`, `string:palindrome`). Adjust the extraction logic to match actual intent formatting.

```sql
SELECT
    extractTextBefore(intent, ':') AS domain,
    uniq(intent) AS unique_intents,
    countIf(event_type = 'resolve' AND success = 0) AS unresolved_count,
    countIf(event_type = 'resolve' AND confidence < 0.7) AS low_confidence_count,
    countIf(event_type = 'execute' AND success = 0) AS execution_failures
FROM analytics_events
WHERE event_type IN ('resolve', 'execute')
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY domain
ORDER BY (unresolved_count + low_confidence_count + execution_failures) DESC;
```

**4e. Evolution pipeline status (table: intents sent to /evolve and their outcomes)**

```sql
-- Intents that triggered /evolve (fail events with no skill_id indicate gap detection)
SELECT
    intent,
    count() AS fail_count,
    min(timestamp) AS first_failure,
    max(timestamp) AS latest_failure
FROM analytics_events
WHERE event_type = 'fail'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY intent
ORDER BY fail_count DESC
LIMIT 50;
```

#### Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| Same intent unresolved > 10 times in 24hr | Warning | Auto-submit to `/evolve` |
| Any domain has > 30% unresolved rate (7d rolling) | Warning | Notify, prioritize domain in `/evolve` queue |
| Low-confidence resolve % exceeds 20% (1hr rolling) | Warning | Review embedding quality |
| New unresolved intent cluster detected (> 5 unique intents with shared prefix, 24hr) | Info | Notify, suggest new domain category |

#### Decision Engine Connection

- **Evolve rule:** All rows from query 4a (unresolved intents) and 4b (confidence < 0.7) are batched and sent to `POST /evolve` by the Decision Engine Lambda on its hourly schedule.
- The Decision Engine deduplicates intents already in the evolve pipeline before submitting new ones.

---

### Dashboard 5: Agent Behavior

**Purpose:** Understand how AI agents (the primary consumers) interact with codeVolve -- their usage patterns, conversion funnels, and chaining behavior.

**Refresh cadence:** Every 5 minutes.

**Default time range:** Last 24 hours. Available: 1hr, 24hr, 7d, 30d.

#### Metrics and Queries

**5a. Resolve-to-execute conversion rate (funnel chart + time series)**

```sql
-- Conversion funnel (single stats)
SELECT
    countIf(event_type = 'resolve') AS total_resolves,
    countIf(event_type = 'execute') AS total_executes,
    countIf(event_type = 'execute') * 100.0
        / greatest(countIf(event_type = 'resolve'), 1) AS conversion_rate_pct
FROM analytics_events
WHERE event_type IN ('resolve', 'execute')
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64};

-- Over time (time series)
SELECT
    toStartOfHour(timestamp) AS hour,
    countIf(event_type = 'resolve') AS resolves,
    countIf(event_type = 'execute') AS executes,
    countIf(event_type = 'execute') * 100.0
        / greatest(countIf(event_type = 'resolve'), 1) AS conversion_rate_pct
FROM analytics_events
WHERE event_type IN ('resolve', 'execute')
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY hour
ORDER BY hour;
```

**5b. Repeated resolves -- same intent resolved multiple times (table, indicates agent confusion or dissatisfaction)**

```sql
SELECT
    intent,
    count() AS resolve_count,
    uniq(skill_id) AS distinct_skills_returned,
    avg(confidence) AS avg_confidence
FROM analytics_events
WHERE event_type = 'resolve'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY intent
HAVING resolve_count > 3
ORDER BY resolve_count DESC
LIMIT 50;
```

**5c. Abandoned executions -- resolves not followed by execute (table + single stat)**

Note: This approximation counts resolves for intents that had zero executions in the same time window. A more precise version would use session tracking if available.

```sql
WITH
    resolved_intents AS (
        SELECT intent, count() AS resolve_count
        FROM analytics_events
        WHERE event_type = 'resolve'
          AND success = 1
          AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
        GROUP BY intent
    ),
    executed_intents AS (
        SELECT intent, count() AS execute_count
        FROM analytics_events
        WHERE event_type = 'execute'
          AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
        GROUP BY intent
    )
SELECT
    r.intent,
    r.resolve_count,
    coalesce(e.execute_count, 0) AS execute_count,
    r.resolve_count - coalesce(e.execute_count, 0) AS abandoned_count
FROM resolved_intents r
LEFT JOIN executed_intents e ON r.intent = e.intent
WHERE coalesce(e.execute_count, 0) < r.resolve_count
ORDER BY abandoned_count DESC
LIMIT 50;
```

**5d. Skill chaining patterns -- skills frequently executed in sequence (chord diagram or sankey chart)**

Note: Chaining is detected by looking at execute events within a short time window for the same intent prefix or session. The `/execute/chain` endpoint should emit events with a shared `chain_id` in the intent field (e.g., `chain:abc123:step:1`). The following uses temporal proximity as an approximation.

```sql
WITH ordered_executions AS (
    SELECT
        skill_id,
        timestamp,
        leadInFrame(skill_id) OVER (
            ORDER BY timestamp
            ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING
        ) AS next_skill_id,
        leadInFrame(timestamp) OVER (
            ORDER BY timestamp
            ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING
        ) AS next_timestamp
    FROM analytics_events
    WHERE event_type = 'execute'
      AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
)
SELECT
    skill_id AS from_skill,
    next_skill_id AS to_skill,
    count() AS chain_count
FROM ordered_executions
WHERE next_skill_id != ''
  AND next_timestamp - timestamp < 5   -- within 5 seconds
  AND skill_id != next_skill_id
GROUP BY from_skill, to_skill
HAVING chain_count >= 3
ORDER BY chain_count DESC
LIMIT 50;
```

**5e. Hourly usage pattern (heatmap: hour-of-day x day-of-week)**

```sql
SELECT
    toDayOfWeek(timestamp) AS day_of_week,
    toHour(timestamp) AS hour_of_day,
    count() AS event_count
FROM analytics_events
WHERE timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY day_of_week, hour_of_day
ORDER BY day_of_week, hour_of_day;
```

#### Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| Resolve-to-execute conversion drops below 50% (1hr rolling) | Warning | Investigate resolve quality |
| Same intent resolved > 10 times without execution (1hr) | Warning | Flag intent for review |
| Abandoned execution rate > 40% (6hr rolling) | Warning | Review skill descriptions and confidence scores |

#### Decision Engine Connection

- High repeated-resolve intents (query 5b) indicate routing confusion and feed into the **evolve** rule when paired with low confidence.
- Frequently chained skills (query 5d) are candidates for composite skill creation via `/evolve`.

---

## Dashboard Implementation Notes

### Grafana Configuration

Each dashboard maps to a Grafana dashboard JSON model. Panel types:

| Chart Type | Grafana Panel | Used In |
|------------|---------------|---------|
| Time series line | `timeseries` | 1a, 1c, 2e, 3b, 3c, 4b, 5a |
| Stacked area | `timeseries` (stacked) | 2c |
| Horizontal bar | `barchart` | 2a, 3a, 4d |
| Heatmap | `heatmap` | 2d, 5e |
| Table | `table` | 1e, 2b, 2f, 3c, 3d, 3e, 4a, 4b, 4c, 4e, 5b, 5c |
| Single stat | `stat` | 1c, 1d, 2c, 5a |
| Histogram | `histogram` | 1b |
| Funnel | `barchart` (horizontal) | 5a |
| Chord/Sankey | Custom React panel plugin | 5d |

### ClickHouse Materialized Views

For performance, create materialized views for expensive aggregations:

```sql
-- Minute-level resolve latency percentiles
CREATE MATERIALIZED VIEW mv_resolve_latency_1m
ENGINE = AggregatingMergeTree()
ORDER BY minute
AS SELECT
    toStartOfMinute(timestamp) AS minute,
    quantileState(0.5)(latency_ms)  AS p50_state,
    quantileState(0.95)(latency_ms) AS p95_state,
    countState() AS count_state
FROM analytics_events
WHERE event_type = 'resolve'
GROUP BY minute;

-- Minute-level execution cache rates
CREATE MATERIALIZED VIEW mv_execution_cache_1m
ENGINE = AggregatingMergeTree()
ORDER BY minute
AS SELECT
    toStartOfMinute(timestamp) AS minute,
    countIfState(cache_hit = 1) AS hits_state,
    countIfState(cache_hit = 0) AS misses_state,
    countState() AS total_state
FROM analytics_events
WHERE event_type = 'execute'
GROUP BY minute;

-- Hourly skill execution counts (for Decision Engine)
CREATE MATERIALIZED VIEW mv_skill_execution_hourly
ENGINE = SummingMergeTree()
ORDER BY (skill_id, hour)
AS SELECT
    skill_id,
    toStartOfHour(timestamp) AS hour,
    count() AS execution_count,
    uniq(input_hash) AS unique_inputs,
    countIf(cache_hit = 1) AS cache_hits,
    countIf(success = 0) AS failures
FROM analytics_events
WHERE event_type = 'execute'
GROUP BY skill_id, hour;
```

### Decision Engine Summary

The scheduled Decision Engine Lambda runs every 5 minutes and executes the following logic:

| Rule | Source Query | Condition | Action |
|------|-------------|-----------|--------|
| Auto-cache | 2f (cache candidates) | `execution_count > 50 AND input_repeat_rate > 0.3` | Warm ElastiCache with top input_hash values for the skill |
| Optimize | 2d (execution latency) | `p95_ms > 500 AND execution_count > 100` (24hr window) | Set `status = 'needs_optimization'` in DynamoDB, enqueue for `/evolve` |
| Evolve (gap) | 4a (unresolved intents) | `occurrences > 5` (7d window) | Submit intent to `POST /evolve` |
| Evolve (quality) | 3e (confidence degradation) | `confidence_delta < -0.1` (24hr) | Submit skill_id to `POST /evolve` for improvement |
| Evolve (low-conf) | 4b (low-confidence resolves) | `confidence < 0.7 AND occurrences > 3` | Submit intent to `POST /evolve` |
| Revoke canonical | 3a (test pass rate) | `pass_rate_pct < 50` | Set `is_canonical = false` in DynamoDB |

---

*Mountain visualization design (DESIGN-04, DESIGN-05) will be written here by Amber.*

---

## MCP Server Interface (DESIGN-06)

### Overview

**Experience goal (for agent):** An MCP-compatible AI agent (Claude Code or any MCP client) should be able to discover, resolve, execute, and submit codeVolve skills without knowing anything about the underlying HTTP API. Every operation is one tool call with clearly named, typed parameters. Errors are structured and actionable.

**Experience goal (for human):** A developer adding codeVolve to Claude Code adds a single stanza to `.mcp.json` and the tools become immediately available in their agent sessions. No SDK installation, no manual HTTP wiring.

**What the MCP server wraps:** The codeVolve HTTP REST API at `CODEVOLVE_API_URL`. The MCP server is a thin translation layer: it receives MCP tool calls, issues one or more HTTP requests to the codeVolve API, and returns structured MCP content. It does not contain business logic.

**Primary consumers:** Claude Code (via `stdio` transport), other MCP-compatible agents.

**Transport:** `stdio`. This is the standard MCP transport for Claude Code integration and requires no port binding or network configuration on the developer's machine. All messages are JSON-RPC 2.0 frames over stdin/stdout.

**Scope:** Read, resolve, execute, validate, and submit skills. The MCP server does not expose admin operations (archive, unarchive, promote-canonical) — those remain HTTP-only operations for platform operators.

---

### 1. Tool Definitions

Each tool maps to a single HTTP endpoint. All tools return MCP `content` of type `text` containing a JSON string. Agents should parse this JSON to access structured fields.

Error responses from any tool follow the shape:
```json
{
  "error": {
    "code": "SKILL_NOT_FOUND",
    "message": "No skill found with skill_id 'abc123'."
  }
}
```

This mirrors the codeVolve HTTP API error shape exactly so agents do not need separate error-handling logic for MCP vs HTTP consumers.

---

#### Tool: `resolve_skill`

**Description:** Map a natural-language intent to the best matching skill in the registry. Returns the top match with its confidence score. Agents should check `confidence` before proceeding to `execute_skill` — a confidence below 0.7 means the match is unreliable.

**Wraps:** `POST /resolve`

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "intent": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1024,
      "description": "Natural language description of what you need. Example: 'find the shortest path between two nodes in a weighted graph'."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional. Narrow results to skills with all of these tags."
    },
    "language": {
      "type": "string",
      "enum": ["python", "javascript", "typescript", "go", "rust", "java", "cpp", "c"],
      "description": "Optional. Prefer skills in this language."
    }
  },
  "required": ["intent"]
}
```

**Output description:** JSON object with fields:
- `skill_id` (string, UUID) — ID of the best matching skill. Pass to `execute_skill`.
- `name` (string) — human-readable skill name.
- `confidence` (number, 0-1) — skill's stored confidence score from validation history.
- `similarity_score` (number, 0-1) — cosine similarity of the intent against this skill's embedding. Higher is a better semantic match.
- `status` (string) — one of `unsolved`, `partial`, `verified`, `optimized`.
- `resolve_confidence` (number, 0-1) — same as `similarity_score`; canonical field name for threshold checks.
- `evolve_triggered` (boolean) — true if the platform has already queued this intent for `/evolve` because confidence is low.
- `no_match` (boolean) — true if no skill was found. All other fields will be null.

**Rationale:** Returns one best match, not a ranked list. Agents should not implement their own ranking logic. The `confidence` vs `similarity_score` distinction matters: `confidence` is about the skill's historical quality; `similarity_score` is about how well it matches this intent. Agents should gate on `similarity_score >= 0.7` for execution trust.

---

#### Tool: `execute_skill`

**Description:** Run a skill with the provided inputs. Returns the skill's typed outputs. Automatically uses the cache when available.

**Wraps:** `POST /execute`

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "skill_id": {
      "type": "string",
      "format": "uuid",
      "description": "UUID of the skill to execute. Obtain from resolve_skill."
    },
    "inputs": {
      "type": "object",
      "description": "Key-value pairs matching the skill's declared input schema. Field names and types must match the skill's inputs array."
    },
    "timeout_ms": {
      "type": "integer",
      "minimum": 100,
      "maximum": 300000,
      "description": "Optional. Execution timeout in milliseconds. Defaults to 30000 (30 seconds)."
    }
  },
  "required": ["skill_id", "inputs"]
}
```

**Output description:** JSON object with fields:
- `outputs` (object) — key-value pairs matching the skill's declared output schema.
- `cache_hit` (boolean) — whether this result was served from cache.
- `latency_ms` (number) — total execution time in milliseconds.
- `execution_id` (string, UUID) — unique trace ID for this execution.
- `skill_id` (string, UUID) — echoed from input.
- `version` (integer) — the version of the skill that was executed.

**Rationale:** `outputs` is always a typed object, never free-form text. Agents can destructure outputs directly. The `cache_hit` field allows agents to log or report cache behavior without inspecting headers.

---

#### Tool: `chain_skills`

**Description:** Execute a sequence of skills in order, automatically piping outputs from one step to the inputs of the next. Use this when you have a known multi-step pipeline. If any step fails, execution halts and partial results are returned.

**Wraps:** `POST /execute/chain`

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "steps": {
      "type": "array",
      "minItems": 1,
      "maxItems": 10,
      "items": {
        "type": "object",
        "properties": {
          "skill_id": {
            "type": "string",
            "format": "uuid",
            "description": "UUID of the skill to run at this step."
          },
          "input_mapping": {
            "type": "object",
            "additionalProperties": { "type": "string" },
            "description": "Optional. Maps this step's input field names to values from chain inputs ('$input.<field>') or prior step outputs ('$steps[0].output.<field>'). Omit to pass the previous step's full output as this step's inputs."
          }
        },
        "required": ["skill_id"]
      },
      "description": "Ordered list of skills to execute. Outputs flow forward automatically."
    },
    "inputs": {
      "type": "object",
      "description": "Initial inputs for the chain. Referenced in step input_mappings as '$input.<field>'."
    },
    "timeout_ms": {
      "type": "integer",
      "minimum": 100,
      "maximum": 600000,
      "description": "Optional. Total chain timeout in milliseconds. Defaults to 60000 (60 seconds)."
    }
  },
  "required": ["steps", "inputs"]
}
```

**Output description:** JSON object with fields:
- `chain_id` (string, UUID) — unique ID for this chain execution.
- `steps` (array) — per-step results, each with `skill_id`, `outputs`, `latency_ms`, `cache_hit`, `success`, `error`.
- `final_outputs` (object or null) — outputs from the last successful step. Null if the first step failed.
- `total_latency_ms` (number) — sum of all step latencies.
- `completed_steps` (integer) — number of steps that ran before failure or completion.
- `total_steps` (integer) — total steps in the chain.
- `success` (boolean) — true only if all steps completed without error.

**Rationale:** `chain_skills` is preferred over multiple sequential `execute_skill` calls when the pipeline is known upfront. It avoids round-trip latency between steps, uses the server-side input mapping DSL, and emits a single correlated chain event to analytics. See Section 5 (Agent Ergonomics) for guidance on when to choose `chain_skills` vs sequential `execute_skill`.

---

#### Tool: `get_skill`

**Description:** Retrieve full details for a skill by ID, including its implementation, tests, examples, and confidence score. Use this when you need to inspect a skill before executing it, or when building a prompt for improvement.

**Wraps:** `GET /skills/:id`

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "skill_id": {
      "type": "string",
      "format": "uuid",
      "description": "UUID of the skill to retrieve."
    },
    "version": {
      "type": "integer",
      "minimum": 1,
      "description": "Optional. Retrieve a specific version number. Omit to get the latest version."
    }
  },
  "required": ["skill_id"]
}
```

**Output description:** The full `Skill` object as defined in `docs/api.md` Common Types, including `implementation`, `tests`, `examples`, `confidence`, `status`, `inputs`, `outputs`, `domain`, `tags`, `is_canonical`, `latency_p50_ms`, `latency_p95_ms`, `created_at`, `updated_at`.

**Note:** Archived skills are returned with `status: "archived"`. Agents should check `status` before executing a skill retrieved via this tool.

---

#### Tool: `list_skills`

**Description:** Search and filter the skill registry. Returns a paginated list of skills matching the specified criteria. Use this to discover skills by language, domain, or status.

**Wraps:** `GET /skills`

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "tag": {
      "type": "string",
      "description": "Optional. Filter to skills with this tag. Repeatable — pass multiple calls or use the tags array field."
    },
    "language": {
      "type": "string",
      "enum": ["python", "javascript", "typescript", "go", "rust", "java", "cpp", "c"],
      "description": "Optional. Filter by programming language."
    },
    "domain": {
      "type": "string",
      "description": "Optional. Filter by domain (e.g., 'graphs', 'sorting', 'dynamic-programming')."
    },
    "status": {
      "type": "string",
      "enum": ["unsolved", "partial", "verified", "optimized"],
      "description": "Optional. Filter by skill status. Archived skills are excluded by default."
    },
    "is_canonical": {
      "type": "boolean",
      "description": "Optional. If true, return only canonical skills for each problem+language combination."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "description": "Optional. Number of results to return. Defaults to 20."
    },
    "next_token": {
      "type": "string",
      "description": "Optional. Pagination cursor from a previous list_skills response."
    }
  },
  "required": []
}
```

**Output description:** JSON object with fields:
- `skills` (array) — array of `Skill` objects (full schema, same as `get_skill`).
- `pagination` (object) — `{ limit, next_token }`. `next_token` is null when no more pages remain.

**Note:** Archived skills are excluded from results. Passing no filters returns all non-archived skills in default order.

---

#### Tool: `validate_skill`

**Description:** Run a skill's built-in test suite and return the results with an updated confidence score. Use this after submitting a new skill to establish its initial quality baseline.

**Wraps:** `POST /validate/:skill_id`

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "skill_id": {
      "type": "string",
      "format": "uuid",
      "description": "UUID of the skill to validate."
    }
  },
  "required": ["skill_id"]
}
```

**Output description:** JSON object with fields:
- `pass_count` (integer) — number of tests that passed.
- `fail_count` (integer) — number of tests that failed.
- `pass_rate` (number, 0-1) — fraction of tests passed.
- `confidence` (number, 0-1) — updated confidence score, set equal to `pass_rate`.
- `previous_confidence` (number, 0-1) — confidence before this validation run.
- `new_status` (string) — skill status after validation. See status transition rules in `docs/api.md`.
- `status_changed` (boolean) — whether the status changed as a result of this validation.
- `errors` (array of strings) — per-test error messages for failed tests.

**Note:** The MCP tool intentionally omits the `additional_tests` parameter from the underlying HTTP endpoint. Agents that need to run additional tests should call the HTTP API directly. This keeps the tool interface minimal.

---

#### Tool: `submit_skill`

**Description:** Create a new skill in the registry. Used by the `/evolve` pipeline and by agents generating implementations for unsolved problems. The skill will have `confidence: 0` until `validate_skill` is called.

**Wraps:** `POST /skills`

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "problem_id": {
      "type": "string",
      "format": "uuid",
      "description": "UUID of the problem this skill solves. Must reference an existing problem."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Short, descriptive name for the skill."
    },
    "description": {
      "type": "string",
      "maxLength": 4096,
      "description": "Full description. Used for embedding generation and routing. Describe what the skill does, its approach, and its constraints."
    },
    "language": {
      "type": "string",
      "enum": ["python", "javascript", "typescript", "go", "rust", "java", "cpp", "c"]
    },
    "domain": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "maxItems": 16,
      "description": "Domain categories for this skill (e.g., ['graphs', 'shortest-path'])."
    },
    "inputs": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "type": { "type": "string" }
        },
        "required": ["name", "type"]
      },
      "description": "Declared input parameters for the skill."
    },
    "outputs": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "type": { "type": "string" }
        },
        "required": ["name", "type"]
      },
      "description": "Declared output parameters for the skill."
    },
    "examples": {
      "type": "array",
      "maxItems": 32,
      "items": {
        "type": "object",
        "properties": {
          "input": { "type": "object" },
          "output": { "type": "object" }
        },
        "required": ["input", "output"]
      },
      "description": "At least one input/output example is required."
    },
    "tests": {
      "type": "array",
      "maxItems": 128,
      "items": {
        "type": "object",
        "properties": {
          "input": { "type": "object" },
          "expected": { "type": "object" }
        },
        "required": ["input", "expected"]
      },
      "description": "At least two tests are required for the skill to be validatable."
    },
    "implementation": {
      "type": "string",
      "maxLength": 1000000,
      "description": "Inline source code implementing the skill. Must be executable in the declared language."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 32,
      "description": "Optional. Additional tags for filtering and discovery."
    },
    "status": {
      "type": "string",
      "enum": ["unsolved", "partial", "verified", "optimized"],
      "description": "Optional. Defaults to 'unsolved'. Use 'partial' if the implementation is incomplete."
    }
  },
  "required": ["problem_id", "name", "description", "language", "domain", "inputs", "outputs", "examples", "tests", "implementation"]
}
```

**Output description:** JSON object with fields:
- `skill_id` (string, UUID) — the server-assigned ID for the new skill.
- `version` (integer) — the server-assigned version number (starts at 1).
- `status` (string) — the initial status of the submitted skill.

**Rationale:** `submit_skill` requires `examples` (at least one) and `tests` (at least two) as required fields in the MCP tool, even though the underlying HTTP API allows empty arrays. This enforces the skill contract at the MCP layer to prevent agents from submitting skeleton skills that cannot be validated. This is a stricter policy than the HTTP API default.

---

### 2. Resource Definitions

MCP resources are read-only structured data that agents can access by URI. Resources complement tools — tools perform actions, resources expose data.

---

#### Resource: `codevolve://skills/{skill_id}`

**Description:** Returns the full `Skill` object for the given skill ID. Equivalent to `get_skill` but accessed as a resource rather than a tool call. Use this when your agent framework prefers resource reads over tool calls for retrieval operations.

**MIME type:** `application/json`

**URI parameters:** `skill_id` — UUID of the skill.

**Response:** Full `Skill` object. Archived skills are included and flagged with `status: "archived"`.

**Error:** If the skill does not exist, returns a 404-equivalent resource error with code `NOT_FOUND`.

---

#### Resource: `codevolve://problems/{problem_id}`

**Description:** Returns a problem and all its associated (non-archived) skills, sorted by confidence descending. Use this to understand the full solution landscape for a problem before deciding whether to submit a new skill.

**MIME type:** `application/json`

**URI parameters:** `problem_id` — UUID of the problem.

**Response:** JSON object with fields:
- `problem` — the full `Problem` object.
- `skills` — array of `Skill` objects for this problem, sorted by confidence descending.
- `skill_count` — total number of non-archived skills for this problem.

**Error:** If the problem does not exist, returns a 404-equivalent resource error with code `NOT_FOUND`.

---

#### Resource: `codevolve://skills`

**Description:** Returns a paginated list of skills. Filterable via URI query parameters. Use this for catalog discovery when you want a browsable view rather than a resolved-intent search.

**MIME type:** `application/json`

**URI parameters (query string):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `language` | string | Filter by language |
| `domain` | string | Filter by domain |
| `tag` | string | Filter by tag |
| `status` | string | Filter by status |
| `is_canonical` | boolean | If true, return only canonical skills |
| `limit` | integer | Page size, default 20, max 100 |
| `next_token` | string | Pagination cursor |

Example URI: `codevolve://skills?language=python&domain=graphs&status=verified`

**Response:** JSON object with fields:
- `skills` — array of `Skill` objects.
- `pagination` — `{ limit, next_token }`.

---

### 3. Prompt Templates

Prompt templates are reusable MCP prompt objects for common agent workflows. They are parameterized and returned as structured MCP `messages` arrays that agents inject into their context.

---

#### Prompt: `generate_skill`

**Description:** Prompt template for generating a new skill implementation from a problem description. Used by the `/evolve` pipeline when a gap is detected (unresolved intent or low-confidence match).

**Inputs:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `problem_description` | string | Yes | Full description of the problem to solve, including constraints and edge cases. |
| `language` | string | Yes | Target programming language for the implementation. |
| `examples` | string | Yes | JSON-serialized array of `{ input, output }` example pairs. |
| `domain` | string | No | Domain category (e.g., `"graphs"`, `"sorting"`). Helps the agent focus the implementation approach. |

**Prompt content (template):**

```
You are implementing a verified, production-quality algorithmic skill for the codeVolve registry.

Problem:
{{problem_description}}

Target language: {{language}}
Domain: {{domain}}

Examples:
{{examples}}

Your task:
1. Write a complete, correct implementation in {{language}}.
2. Write at least 5 test cases covering: basic case, edge cases, large inputs, invalid inputs.
3. Define the inputs array (name + type for each parameter).
4. Define the outputs array (name + type for each return value).
5. Write a clear description of the algorithm and its time/space complexity.

Then call submit_skill with the complete skill contract.
After submitting, call validate_skill with the returned skill_id to confirm all tests pass.
```

**Rationale:** The template enforces the skill contract discipline (inputs/outputs typed, tests included, description written) as part of the generation prompt itself. The final two instructions in the template drive the agent to complete the full resolve → submit → validate lifecycle automatically.

---

#### Prompt: `improve_skill`

**Description:** Prompt template for improving a low-confidence or failing skill. Used by the `/evolve` pipeline when the Decision Engine detects a skill with degrading confidence or a test pass rate below threshold.

**Inputs:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `skill_id` | string | Yes | UUID of the skill to improve. |
| `current_implementation` | string | Yes | The existing implementation code. |
| `failure_cases` | string | Yes | JSON-serialized array of `{ input, expected, actual, error }` for failing tests. |
| `confidence` | string | No | Current confidence score as a string (e.g., `"0.42"`). Provides context on severity. |

**Prompt content (template):**

```
You are improving an existing codeVolve skill that is failing tests or has low confidence.

Skill ID: {{skill_id}}
Current confidence: {{confidence}}

Current implementation:
{{current_implementation}}

Failing test cases:
{{failure_cases}}

Your task:
1. Analyze why the current implementation fails these test cases.
2. Write a corrected implementation that passes all failing cases without breaking passing ones.
3. Do not change the skill's inputs, outputs, or public interface — only fix the implementation.
4. If the implementation is fundamentally flawed, rewrite it entirely. Partial fixes that leave edge cases broken are not acceptable.

Call submit_skill with the updated implementation. Use the same problem_id, name, description, inputs, outputs, examples, and tests as the existing skill — only the implementation field should change.
After submitting, call validate_skill with the returned skill_id to confirm the pass rate has improved.
```

**Rationale:** The constraint "do not change inputs, outputs, or public interface" is explicit because improved skills must remain compatible with agents that resolved to this skill previously. Changing the interface would break existing callers.

---

### 4. Agent Ergonomics

#### Standard Flow: resolve then execute

The canonical agent pattern is two tool calls:

```
1. resolve_skill(intent="...", language="python")
   → Returns: { skill_id, similarity_score, confidence, status }

2. IF similarity_score >= 0.7 AND status != "archived":
      execute_skill(skill_id=..., inputs={...})
      → Returns: { outputs, cache_hit, latency_ms }
```

Agents must check `similarity_score` (the semantic match quality for this specific intent) before executing. The `confidence` field reflects historical test-pass quality and should inform trust in the output, but `similarity_score` is the gating condition for whether to execute at all.

If `similarity_score < 0.7`, the agent should not blindly execute. It should either:
- Refine the intent and resolve again.
- Call `list_skills` with known domain/language filters to browse alternatives.
- Accept that no suitable skill exists and proceed with its own reasoning (the `/evolve` pipeline will be triggered automatically by the platform).

#### When to use `chain_skills` vs multiple `execute_skill` calls

Use `chain_skills` when:
- The full pipeline is known before the first step runs (all `skill_id`s are resolved upfront).
- Steps have a clear, static input/output dependency (step N's output feeds step N+1's input with a predictable mapping).
- You want correlated analytics across all steps under one `chain_id`.
- You want total timeout enforcement across the chain rather than per-step management.

Use sequential `execute_skill` calls when:
- The `skill_id` for step N depends on the output of step N-1 (dynamic routing — you cannot know all steps upfront).
- A step's failure should trigger fallback logic rather than halting the chain.
- Steps are conditionally executed based on intermediate results.

**Rule of thumb:** If you would write the pipeline as a static list, use `chain_skills`. If the pipeline requires branching or dynamic skill selection, use sequential `execute_skill`.

#### Error handling

**404 / `SKILL_NOT_FOUND`:** The skill_id from a prior resolve is no longer valid (archived or deleted between resolve and execute). Agents should re-run `resolve_skill` with the same intent to get a current match. Do not retry the execute with the same skill_id.

**`similarity_score < 0.7` (soft miss):** Not an error code — the API returns 200 but the match is weak. Agents should treat this as a "no confident match" state. The platform will automatically enqueue the intent for `/evolve` (indicated by `evolve_triggered: true`). Agents should fall back to their own reasoning rather than blindly executing a low-confidence skill.

**`best_match: null` (hard miss):** No skill exists for the intent. `evolve_triggered` will be `true`. Agents must handle this without executing — there is nothing to execute.

**408 / `EXECUTION_TIMEOUT`:** The skill took longer than `timeout_ms`. Agents should not retry immediately without increasing the timeout. For most skills, the default 30-second timeout is sufficient. If a skill consistently times out, it is a signal to the platform that the skill needs optimization — the Decision Engine will flag it automatically.

**422 / `EXECUTION_FAILED`:** The skill's implementation threw a runtime error. The `error.details` field contains the error message. Agents should not retry with the same inputs — the failure is deterministic. Log the failure and consider calling `resolve_skill` again to find an alternative implementation.

**429 / `RATE_LIMITED`:** Per-agent rate limits are enforced by API Gateway. Limits are: 100 req/min for `resolve_skill`, 50 req/min for `execute_skill`, 20 req/min for `chain_skills`. Agents should implement exponential backoff starting at 1 second. MCP tool calls that hit rate limits will return an error with code `RATE_LIMITED` — agents must not retry in a tight loop.

#### Rate limits reference (MCP tool → HTTP endpoint)

| MCP Tool | Underlying endpoint | Rate limit |
|----------|---------------------|------------|
| `resolve_skill` | `POST /resolve` | 100 req/min |
| `execute_skill` | `POST /execute` | 50 req/min |
| `chain_skills` | `POST /execute/chain` | 20 req/min |
| `validate_skill` | `POST /validate/:skill_id` | 30 req/min |
| `submit_skill` | `POST /skills` | 200 req/min |
| `get_skill` | `GET /skills/:id` | 200 req/min |
| `list_skills` | `GET /skills` | 200 req/min |

---

### 5. Configuration

#### Environment variables

The MCP server process reads the following environment variables at startup:

| Variable | Required | Description |
|----------|----------|-------------|
| `CODEVOLVE_API_URL` | Yes | Base URL of the codeVolve HTTP API. Example: `https://api.codevolve.dev/v1`. No trailing slash. |
| `CODEVOLVE_API_KEY` | No | API key for authenticated requests. Sent as `Authorization: Bearer <key>`. Not required in local development without auth enabled. Reserved for Phase 2+ when per-agent auth is enforced. |
| `CODEVOLVE_AGENT_ID` | No | Identifies this MCP server instance in analytics. Sent as `X-Agent-Id` header on all requests. Defaults to `mcp-server`. Set this to a meaningful identifier (e.g., `claude-code-amber`) so agent-behavior analytics can distinguish sessions. |
| `CODEVOLVE_TIMEOUT_MS` | No | Default HTTP request timeout for all API calls made by the MCP server. Defaults to `35000` (35 seconds, 5s above the execute default to allow for API Gateway overhead). |

#### Adding to Claude Code: sample `.mcp.json` entry

Create or edit `.mcp.json` in your project root (or `~/.config/claude/mcp.json` for global registration):

```json
{
  "mcpServers": {
    "codevolve": {
      "command": "node",
      "args": ["/path/to/codevolve-mcp/dist/index.js"],
      "env": {
        "CODEVOLVE_API_URL": "https://api.codevolve.dev/v1",
        "CODEVOLVE_AGENT_ID": "claude-code-local"
      }
    }
  }
}
```

For local development against a locally-running API (e.g., `sam local start-api`):

```json
{
  "mcpServers": {
    "codevolve": {
      "command": "node",
      "args": ["./packages/mcp-server/dist/index.js"],
      "env": {
        "CODEVOLVE_API_URL": "http://localhost:3000/v1",
        "CODEVOLVE_AGENT_ID": "claude-code-dev"
      }
    }
  }
}
```

The MCP server binary is expected to live at `packages/mcp-server/` in this repository (Phase 5 implementation target). The `command` must be `node` with the compiled JS entrypoint as the argument — this is the standard Claude Code MCP `stdio` integration pattern.

#### Design decisions

**No MCP auth at the transport layer.** Authentication (API key) is forwarded to the underlying HTTP API via the `Authorization` header. The MCP server itself does not implement auth — it relies entirely on the HTTP API's auth model. This keeps the MCP server stateless and avoids duplicating auth logic.

**`CODEVOLVE_API_KEY` is optional now, required later.** Phase 1 and 2 deployments may not enforce API auth. The env var is defined now so that the MCP server configuration contract is stable — adding the key later does not require changes to `.mcp.json` structure.

**Single server process per agent session.** The MCP server is a long-running process started by Claude Code. All tool calls in a session share the same HTTP base URL and API key. There is no per-tool configuration.

---

### Edge Cases Considered

| Scenario | Behavior |
|----------|----------|
| `resolve_skill` returns `best_match: null` | `no_match: true` in response. `evolve_triggered: true`. Agent must not call `execute_skill`. |
| Agent calls `execute_skill` with an archived skill_id | HTTP returns 404 `NOT_FOUND`. MCP tool returns error with code `SKILL_NOT_FOUND`. Agent should re-resolve. |
| `chain_skills` step 2 fails | `success: false`, `completed_steps: 1`, `final_outputs: null` (if step 1 succeeded, `final_outputs` holds step 1's outputs). Agent inspects `steps[1].error`. |
| `submit_skill` called without tests | MCP tool validation rejects before HTTP call with: `"tests must contain at least 2 items"`. HTTP API is not called. |
| `validate_skill` called on a skill with no built-in tests | HTTP returns 422 `PRECONDITION_FAILED`. MCP tool surfaces this as an error. |
| Rate limit hit mid-chain | `chain_skills` fails at the rate-limited step. The chain does not retry automatically. Agent receives the partial result and the `RATE_LIMITED` error. |
| `CODEVOLVE_API_URL` not set | MCP server fails to start with a clear error: `"CODEVOLVE_API_URL is required but not set."` |

---

### Open Questions

1. **Pagination in resources vs tools:** The `codevolve://skills` resource accepts `next_token` as a URI query param. It is unclear whether Claude Code's resource-reading behavior follows cursor pagination across multiple reads automatically or whether agents need to issue multiple resource reads manually. Decision deferred to IMPL-15.

2. **`CODEVOLVE_API_KEY` rotation:** If API keys are rotated while a Claude Code session is open, the MCP server will use the stale key until it is restarted. Whether to support hot key reload (re-reading the env var on each request) is deferred to Phase 2 when auth is enforced.

3. **MCP server package location:** Should the MCP server live in `packages/mcp-server/` (monorepo) or as a separate published npm package (`@codevolve/mcp-server`)? This affects how `.mcp.json` references the binary. Decision deferred to IMPL-15 kickoff.

---

## DESIGN-04: Mountain Visualization Data Shape

### Overview

**Experience goal (for human):** A developer or platform operator opens the mountain view and immediately sees the health of the full registry at a glance — color tells them skill quality, brightness tells them activity, and clusters orient them within a domain. Clicking a brick opens a skill detail panel. Filtering narrows the view without a page reload.

**Experience goal (for agent):** This endpoint is not agent-facing. No agent tool call maps to `/analytics/dashboards/mountain`. The mountain visualization is exclusively a human observability surface. Agents use `/resolve` and `/skills` for programmatic access.

**Design decision:** The mountain endpoint returns per-problem aggregates only. It does not return full skill records, embedding vectors, or implementation code. A follow-up `GET /problems/:id` call (existing endpoint, not part of this spec) provides skill-level detail when a user clicks a brick.

**Rationale:** Three.js renders thousands of bricks efficiently when each object is a flat, small data record. Returning full skill documents at 1,000+ problems would balloon the response to multi-MB payloads with data the renderer does not need (embeddings, test cases, implementation code). Aggregates give the frontend everything it needs to color, size, and position bricks. Detail-on-demand (click through to `/problems/:id`) keeps the initial load fast.

**What behavior this enables:** The frontend can render the full mountain in a single HTTP call. Filters are applied as query params on the same endpoint — no second call needed for filtered views. The cache strategy (described below) makes this endpoint fast enough to serve from a React render without a loading skeleton.

**What behavior this prevents:** The mountain endpoint cannot be used as a skill browser or search surface. It is not paginated for deep cursor navigation — it returns up to 100 problems per call, sufficient for the current registry size. Agents should not use this endpoint for routing or discovery.

---

### 1. API Endpoint

```
GET /analytics/dashboards/mountain
```

**Implemented in:** IMPL-09 (Phase 3).

**Authentication:** Same as all other API endpoints. No special permissions required.

**Cache behavior:** Responses are served from a DynamoDB cache row with TTL of 5 minutes. The cache is keyed on the exact query parameter combination. If the cache is cold (first call or TTL expired), the Lambda builds the response from live DynamoDB data and writes it to the cache before responding. Callers do not need to handle cache warming.

---

### 2. Query Parameters

All parameters are optional. Omitting all parameters returns the full mountain (up to `limit` problems).

| Parameter | Type | Description |
|-----------|------|-------------|
| `domain` | string | Filter to problems whose `domain` array contains this value. Case-insensitive. Example: `?domain=sorting` |
| `language` | string | Filter to problems that have at least one non-archived skill in this language. Must be one of the supported language values. Example: `?language=python` |
| `status` | string | Filter to problems that have at least one skill with this status. One of: `unsolved`, `partial`, `verified`, `optimized`. Example: `?status=verified` |
| `limit` | integer | Maximum number of problems to return. Default: `100`. Maximum: `500`. |
| `offset` | integer | Number of problems to skip. Default: `0`. Used for pagination. |

**Filter interaction rules:**
- Multiple filters are ANDed. A problem must satisfy all supplied filters to appear in the response.
- The `status` filter matches against any skill on the problem (not the problem's own status field). A problem appears if it has at least one skill with the specified status.
- The `language` filter matches against non-archived skills only. A problem with only archived Python skills will not match `?language=python`.
- Archived problems are never returned, regardless of filters.

---

### 3. Response Schema

```typescript
interface MountainResponse {
  generated_at: string;          // ISO 8601 timestamp when the response was built (from cache write time)
  cache_hit: boolean;            // true if response served from cache, false if freshly computed
  total_problems: number;        // total problems matching filters (before pagination)
  total_skills: number;          // total non-archived skills across all matching problems
  problems: MountainProblem[];   // paginated problem records
}

interface MountainProblem {
  problem_id: string;            // UUID v4
  name: string;                  // human-readable problem name
  difficulty: "easy" | "medium" | "hard";  // for mountain height placement (client-computed)
  domain: string[];              // for filter sidebar and cluster grouping
  skill_count: number;           // total non-archived skills attached to this problem
  dominant_status: "unsolved" | "partial" | "verified" | "optimized";  // drives brick color (see §5)
  skill_status_distribution: {
    unsolved: number;
    partial: number;
    verified: number;
    optimized: number;
    archived: number;            // included for informational display; archived bricks are hidden by default
  };
  execution_count_30d: number;   // sum of execution_count across all non-archived skills, last 30 days
  canonical_skill: {             // null if no canonical skill exists for this problem
    skill_id: string;
    language: string;
    confidence: number;          // 0.0-1.0
    latency_p50_ms: number | null;
  } | null;
}
```

**Example response (2 problems, unfiltered):**

```json
{
  "generated_at": "2026-03-21T14:30:00Z",
  "cache_hit": true,
  "total_problems": 2,
  "total_skills": 7,
  "problems": [
    {
      "problem_id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Binary Search",
      "difficulty": "easy",
      "domain": ["searching", "arrays"],
      "skill_count": 4,
      "dominant_status": "optimized",
      "skill_status_distribution": {
        "unsolved": 0,
        "partial": 1,
        "verified": 1,
        "optimized": 2,
        "archived": 3
      },
      "execution_count_30d": 1842,
      "canonical_skill": {
        "skill_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "language": "python",
        "confidence": 0.97,
        "latency_p50_ms": 12
      }
    },
    {
      "problem_id": "660f9500-f30c-52e5-b827-557766551111",
      "name": "Longest Common Subsequence",
      "difficulty": "hard",
      "domain": ["dynamic-programming", "strings"],
      "skill_count": 3,
      "dominant_status": "partial",
      "skill_status_distribution": {
        "unsolved": 1,
        "partial": 2,
        "verified": 0,
        "optimized": 0,
        "archived": 0
      },
      "execution_count_30d": 14,
      "canonical_skill": null
    }
  ]
}
```

---

### 4. Dominant Status Derivation

The `dominant_status` field is a single computed value that drives the primary color of the problem's brick in the mountain visualization. It is computed server-side during aggregation and stored in the cache row — the frontend does not derive it.

**Logic (evaluated in priority order, highest wins):**

```
IF skill_status_distribution.optimized > 0  → dominant_status = "optimized"
ELSE IF skill_status_distribution.verified > 0  → dominant_status = "verified"
ELSE IF skill_status_distribution.partial > 0   → dominant_status = "partial"
ELSE                                              → dominant_status = "unsolved"
```

Archived skills are never counted when computing `dominant_status`. A problem where all non-archived skills are archived remains `unsolved`.

**Rationale:** The best achievable outcome for the problem drives the color. A problem with one optimized skill and ten partial skills is green — the mountain shows what has been achieved, not the average state. This makes peaks visually represent genuine accomplishment rather than median quality.

**Edge case:** A problem with `skill_count = 0` (all skills archived, or skills array is empty) always has `dominant_status = "unsolved"` and all `skill_status_distribution` counts are `0`. This is a valid state — the problem exists but has no active skills.

---

### 5. Color Mapping

The frontend maps `dominant_status` to a brick color. This mapping is defined here so both Ada (IMPL-09, IMPL-14) and the visualization spec (DESIGN-05) use the same values.

| `dominant_status` | Color Name | Hex | Three.js Material |
|-------------------|------------|-----|-------------------|
| `unsolved` | Gray | `#6B7280` | `MeshStandardMaterial` |
| `partial` | Amber | `#F59E0B` | `MeshStandardMaterial` |
| `verified` | Blue | `#3B82F6` | `MeshStandardMaterial` |
| `optimized` | Green | `#10B981` | `MeshStandardMaterial` |
| archived (hidden) | Dark Gray | `#374151` | `MeshStandardMaterial` (toggle-visible only) |

**Brightness/glow encoding:** The `execution_count_30d` field drives emissive intensity on the Three.js material. A skill with 0 executions in 30 days has no glow. The frontend normalizes against the max `execution_count_30d` in the response to set a relative brightness. Full glow (emissive intensity 1.0) is assigned to the problem with the highest `execution_count_30d`.

**Archived problems:** Are not returned by the endpoint. The archived color (`#374151`) is only used if a future filter (`?include_archived=true`) is added — reserved for DESIGN-05.

---

### 6. Aggregation Source and Access Patterns

The mountain endpoint aggregates from two DynamoDB tables. It does not read from ClickHouse/BigQuery — `execution_count_30d` is approximated from the denormalized `execution_count` on each skill record, not from event-stream analytics. This is an intentional trade-off: the mountain does not need exact 30-day windowed counts. It needs a relative sense of activity. Using DynamoDB avoids coupling the mountain endpoint to ClickHouse availability.

**Step 1 — Problem list.**

Query `codevolve-problems` using `GSI-status-domain`:
- `status = "active"` (exclude archived problems)
- If `?domain=...` is supplied, also filter on `domain_primary = :domain` (exact match on first domain tag)
- Project: `problem_id`, `name`, `difficulty`, `domain`, `skill_count`, `canonical_skill_id`

This is a Query on the GSI, not a Scan. At current registry scale (<10,000 problems), this is fast. If the `?domain` filter is not supplied, the query must enumerate all active problems — this will use a full GSI scan, which is acceptable at Phase 3 scale but should be revisited at Phase 5.

**Step 2 — Skill aggregation per problem.**

For each problem returned in Step 1, Query `codevolve-skills` using `GSI-problem-status`:
- `problem_id = :problem_id`
- Project: `skill_id`, `status`, `language`, `confidence`, `latency_p50_ms`, `execution_count`, `is_canonical`

This is a Query per problem, not a batch scan. At 100 problems (default limit), this is 100 parallel DynamoDB queries issued via `Promise.all`. At 500 problems (max limit), it is 500 parallel queries — acceptable given DynamoDB on-demand capacity, but Ada should confirm this does not exceed Lambda concurrency limits in the IMPL-09 implementation plan.

**Step 3 — Aggregate and compute.**

In Lambda memory:
- Compute `skill_status_distribution` by counting skills per status (excluding archived from active counts, but including archived count separately).
- Compute `dominant_status` from the distribution logic in §4.
- Compute `execution_count_30d` as the sum of `execution_count` across all non-archived skills for the problem. (Not a true 30-day window — it is a lifetime count. Rename field to `execution_count_total` in IMPL-09 if the approximation is considered misleading. Flag this open question in the implementation task.)
- Identify `canonical_skill` by matching `is_canonical = true` among the problem's skills.

**Step 4 — Cache write.**

Write the fully assembled response JSON to `codevolve-cache` table:

| Field | Value |
|-------|-------|
| `skill_id` (PK) | `"MOUNTAIN_CACHE"` |
| `input_hash` (SK) | Derived from sorted query parameters, e.g., `"v1:domain=sorting:language=python:status=verified:limit=100:offset=0"`. For an unfiltered request, the key is `"v1:unfiltered:limit=100:offset=0"`. |
| `output` | Full `MountainResponse` JSON blob stored as a DynamoDB `M` (map) attribute. |
| `ttl` | Unix epoch + 300 seconds (5-minute TTL). |
| `created_at` | ISO 8601 timestamp. |
| `version_number` | `1` (static; required by table schema as SK on codevolve-cache uses `input_hash` not `version_number`, so this can be omitted or stored as metadata). |

**Note for Ada:** The `codevolve-cache` table's PK is `skill_id` (S) and SK is `input_hash` (S). Using `"MOUNTAIN_CACHE"` as the `skill_id` value is a deliberate key-space overload — the mountain cache is not a skill execution cache entry but the table structure accommodates it without schema changes. This avoids adding a new table for a single cache row. If this feels wrong, raise it with Jorven before IMPL-09; the alternative is a dedicated `codevolve-mountain-cache` table, which adds operational overhead for little benefit at current scale.

**Step 5 — Apply language filter (post-aggregation).**

The `?language` filter cannot be pushed to the GSI query because `GSI-problem-status` does not index language. After aggregation, filter out problems where none of the non-archived skills have `language = :language`. This in-Lambda filter is applied before pagination but after skill aggregation. At current scale this is acceptable. At >10,000 problems, a language-indexed GSI on the problems table (or a secondary lookup table) would be more efficient — defer to Phase 5 if needed.

---

### 7. Response Size Estimate

At 1,000 problems with 5 skills each:

| Field | Estimated size per problem |
|-------|---------------------------|
| `problem_id`, `name`, `difficulty` | ~100 bytes |
| `domain` (3 tags avg) | ~60 bytes |
| `skill_status_distribution` (5 fields) | ~80 bytes |
| `dominant_status` | ~15 bytes |
| `execution_count_30d` | ~10 bytes |
| `canonical_skill` (4 fields) | ~120 bytes |
| JSON overhead | ~50 bytes |
| **Per-problem total** | **~435 bytes** |

1,000 problems: ~435 KB uncompressed. With gzip (API Gateway compression): ~60-80 KB. This is well within Lambda response limits (6 MB) and browser-load budget for a Three.js initialization payload.

At 500 problems (max paginated limit): ~218 KB uncompressed, ~30-40 KB gzipped.

**Ada should enable API Gateway response compression** for this endpoint (minimum compression size: 1 KB). This is standard API Gateway configuration, not a Lambda code change.

---

### 8. Pagination Design

The mountain endpoint uses offset-based pagination, not cursor-based. This is intentional: the mountain visualization renders all visible problems at once, and users filter to reduce the set rather than paging through it sequentially. Cursor pagination adds complexity that this use case does not justify.

**Default behavior:** `limit=100`, `offset=0`. The first page of 100 problems is the common case. Most registry deployments at Phase 3 will have fewer than 200 active problems.

**Pagination for large registries (>1,000 problems):** The frontend makes multiple calls with increasing `offset` to load all problems, accumulating `problems` arrays client-side. The `total_problems` field in the first response tells the frontend how many total calls to make.

**Cache key includes pagination params:** Each `(limit, offset, filters)` combination is a separate cache entry. This means the unfiltered first page `(limit=100, offset=0)` is cached independently from the second page `(limit=100, offset=100)`. At Phase 3 registry scale, only the first page is ever requested — caching all offsets is not a concern.

---

### 9. Connection to IMPL-09

Ada implements this endpoint in IMPL-09 (Phase 3, after analytics infrastructure is live). Implementation checklist for IMPL-09:

- [ ] Lambda handler at `src/analytics/mountainDashboard.ts`
- [ ] Route: `GET /analytics/dashboards/mountain` in CDK stack
- [ ] Cache read: GetItem on `codevolve-cache` with `skill_id = "MOUNTAIN_CACHE"`, `input_hash = <derived from params>`. If found and not TTL-expired (DynamoDB TTL does not guarantee immediate deletion — check `ttl` field in Lambda), return cached response with `cache_hit: true`.
- [ ] Problem query: `codevolve-problems` GSI-status-domain with `status = "active"`. Apply domain filter at query time if `?domain` supplied.
- [ ] Skill aggregation: `Promise.all` of `GSI-problem-status` queries for each problem. Project only the fields needed for aggregation (status, language, confidence, latency_p50_ms, execution_count, is_canonical).
- [ ] In-Lambda aggregation: compute `skill_status_distribution`, `dominant_status`, `execution_count_30d`, `canonical_skill`.
- [ ] Language filter: post-aggregation, before pagination.
- [ ] Cache write: PutItem to `codevolve-cache` with 5-minute TTL.
- [ ] Response: return `MountainResponse` with `cache_hit: false` (freshly computed).
- [ ] API Gateway compression: enable with min size 1 KB for this route.
- [ ] Unit tests: mock DynamoDB calls, verify aggregation logic for all `dominant_status` cases including edge cases (empty skills, all-archived skills).

**Resolve the `execution_count_30d` naming question** (lifetime count vs true 30-day window) before shipping IMPL-09. If renaming to `execution_count_total`, update this spec and DESIGN-05.

---

### Edge Cases Considered

| Scenario | Behavior |
|----------|----------|
| Problem has no skills (skill_count = 0) | `dominant_status = "unsolved"`, all distribution counts = 0, `canonical_skill = null`. Rendered as a gray unpulsed brick. |
| All skills on a problem are archived | Same as no skills — archived skills do not count toward `dominant_status`. `skill_count` reflects non-archived skills only. |
| Problem has competing canonical skills (data integrity issue) | Use the first one found (Query order). Do not fail. Log a warning. This should not occur if `promote-canonical` logic is correct, but defensive handling prevents a broken mountain. |
| `?domain` filter matches no problems | Return `{ total_problems: 0, total_skills: 0, problems: [] }`. HTTP 200, not 404. |
| Cache write fails | Log the error, return the freshly computed response. Never fail the HTTP request due to a cache write failure. Next caller will re-compute and re-attempt cache write. |
| Lambda times out during aggregation (>1,000 problems with no filters) | Return 504. Log which step timed out. Consider reducing max limit or adding a domain filter requirement at large registry sizes. Revisit at Phase 5. |
| `limit` > 500 supplied | Return 400 `VALIDATION_ERROR`: `"limit must be between 1 and 500"`. |

---

### Open Questions

1. **`execution_count_30d` naming:** The field aggregates lifetime `execution_count` from DynamoDB skill records, not a true 30-day window from ClickHouse analytics. Should it be renamed `execution_count_total` to be honest? Or should IMPL-09 query ClickHouse for true windowed counts at the cost of coupling the mountain endpoint to analytics infrastructure availability? Decision for Ada and Jorven before IMPL-09 implementation begins.

2. **Domain filter breadth:** `domain_primary` is `domain[0]` — problems with `domain = ["graphs", "bfs"]` match `?domain=graphs` but not `?domain=bfs`. Is this sufficient or should the filter match any element in the domain array? A FilterExpression on a Scan would support this but is more expensive. Recommend deferring full multi-domain filter to Phase 5.

3. **Archived problem toggle:** The design currently excludes archived problems entirely. Should the endpoint support `?include_archived=true` so operators can see the full mountain history? Deferred to DESIGN-05 (full visualization spec) to decide in context of the visualization interaction model.

*Last updated: 2026-03-21 — DESIGN-04 by Amber*
