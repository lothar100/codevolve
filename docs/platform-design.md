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
