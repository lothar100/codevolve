# codeVolve — Validation, Evolution, and Canonical Promotion Design

> Authored by Jorven. Design ID: ARCH-08. Ada implements IMPL-11, IMPL-12, and IMPL-13 directly from this document.

---

## Table of Contents

1. [Overview](#1-overview)
2. [POST /validate/:skill_id](#2-post-validateskill_id)
3. [POST /evolve (SQS Consumer)](#3-post-evolve-sqs-consumer)
4. [POST /skills/:id/promote-canonical](#4-post-skillsidpromote-canonical)
5. [Confidence Score Lifecycle](#5-confidence-score-lifecycle)
6. [Status Transitions After Validation](#6-status-transitions-after-validation)
7. [codevolve-evolve-jobs Table](#7-codevolve-evolve-jobs-table)
8. [CDK Resources Required](#8-cdk-resources-required)
9. [IMPL-11 Sub-Tasks — /validate](#9-impl-11-sub-tasks----validate)
10. [IMPL-12 Sub-Tasks — /evolve SQS Consumer](#10-impl-12-sub-tasks----evolve-sqs-consumer)
11. [IMPL-13 Sub-Tasks — Canonical Promotion](#11-impl-13-sub-tasks----canonical-promotion)

---

## 1. Overview

Phase 4 closes the feedback loop between execution and quality. The three components designed here are:

- **`/validate`** — accepts caller-reported test results (pass/fail counts and per-test detail), computes a new confidence score, and writes it back to DynamoDB. The caller runs the skill locally in their own environment and POSTs the results. The registry never executes skill implementations server-side.
- **`/evolve` SQS consumer** — receives gap notifications from the Decision Engine's GapQueue, calls the Claude API to generate a new skill, writes it to DynamoDB, and auto-triggers `/validate`.
- **`/skills/:id/promote-canonical`** — enforces the canonical promotion gate (confidence >= 0.85, all tests passing) and demotes the previous canonical atomically.

All three components are stateless Lambdas. State lives in DynamoDB only.

### Architectural constraint recap

- The `/validate` handler accepts caller-reported results. The caller is responsible for running the skill's tests locally (in their own environment using their own tools) and reporting outcomes. No server-side execution infrastructure (runner Lambdas, containers) is involved in validation.
- `/evolve` calls the Claude API (`claude-sonnet-4-6`) only from within the async SQS consumer Lambda. No LLM calls occur in the synchronous API path.
- Canonical promotion uses a DynamoDB `TransactWriteItems` to guarantee atomicity of demote-old + promote-new.

---

## 2. POST /validate/:skill_id

### 2.1 Request Contract

```typescript
// Path parameter
skill_id: string (UUID)

// Request body — caller reports results from their local test run
const ValidateRequest = z.object({
  version: z.number().int().positive().optional(),
  // When omitted: query codevolve-skills for latest version_number
  // (ScanIndexForward: false, Limit: 1 on skill_id PK)

  total_tests: z.number().int().nonnegative(),
  // Total number of test cases the caller executed locally.

  pass_count: z.number().int().nonnegative(),
  // Number of test cases that produced the expected output.

  fail_count: z.number().int().nonnegative(),
  // Number of test cases that produced unexpected output or errored.
  // Invariant: pass_count + fail_count == total_tests

  results: z.array(TestResult).optional(),
  // Per-test detail, if the caller wishes to supply it.
  // Does NOT need to match the skill's stored tests array exactly —
  // callers report what they ran. Stored for observability only.

  latency_p50_ms: z.number().nonnegative().optional(),
  latency_p95_ms: z.number().nonnegative().optional(),
  // Caller-reported latency percentiles from their local run.
});
```

The caller is expected to:
1. Fetch the skill implementation via `GET /skills/:id` or `/resolve`.
2. Run the skill's test suite locally against the fetched implementation.
3. POST the aggregated results (pass/fail counts, optional per-test detail) to `/validate/:skill_id`.

The registry does not run, schedule, or coordinate test execution. All execution is the caller's responsibility.

### 2.2 Execution Flow

```
POST /validate/:skill_id
    │
    ├── 1. Parse and validate path param (skill_id UUID) and request body
    ├── 2. Fetch skill from codevolve-skills
    │       ├── If not found: return 404 NOT_FOUND
    │       └── If status == "archived": return 422 PRECONDITION_FAILED (code: SKILL_ARCHIVED)
    ├── 3. Validate counts
    │       └── If pass_count + fail_count != total_tests: return 400 VALIDATION_ERROR
    │           If total_tests == 0: return 400 VALIDATION_ERROR (code: NO_TESTS_DEFINED)
    ├── 4. Compute new confidence score
    │       └── new_confidence = pass_count / total_tests  (see §5)
    ├── 5. Determine new status
    │       └── See §6 — status transition rules
    ├── 6. DynamoDB UpdateItem on codevolve-skills
    │       └── See §2.4 for exact update expression
    │           Writes: confidence, status, last_validated_at, test_pass_count, test_fail_count,
    │                   latency_p50_ms (if supplied), latency_p95_ms (if supplied), updated_at
    ├── 7. Cache invalidation
    │       └── If confidence or status changed: issue async DeleteItem for all codevolve-cache entries
    │           for this skill_id (same pattern as archive handler — batch scan then delete)
    ├── 8. Kinesis event emission
    │       └── See §2.5 for event shape
    ├── 9. Evolve trigger
    │       └── If new_confidence < 0.7: enqueue to codevolve-gap-queue.fifo (async, fire-and-forget)
    │           Message body: { intent: null, skill_id, reason: "low_confidence",
    │                           resolve_confidence: new_confidence, timestamp, original_event_id: null }
    └── 10. Return ValidateResponse (200 OK)
```

### 2.3 Response Contract

Full contract already in `docs/api.md` §POST /validate/:skill_id. Repeated here for completeness:

```typescript
const TestResult = z.object({
  test_index: z.number().int().nonnegative(),
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()),
  actual: z.record(z.unknown()).nullable(),
  passed: z.boolean(),
  latency_ms: z.number().nonnegative(),
  error: z.string().nullable(),
});

const ValidateResponse = z.object({
  skill_id: z.string().uuid(),
  total_tests: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  previous_confidence: z.number().min(0).max(1),
  new_confidence: z.number().min(0).max(1),
  status_changed: z.boolean(),
  new_status: SkillStatus,
  results: z.array(TestResult),
});
```

### 2.4 DynamoDB Write

```
Table: codevolve-skills
Key: { skill_id, version_number }
UpdateExpression:
  SET confidence = :new_confidence,
      #status = :new_status,
      last_validated_at = :now,
      test_pass_count = :pass_count,
      test_fail_count = :fail_count,
      latency_p50_ms = :p50,
      latency_p95_ms = :p95,
      updated_at = :now
REMOVE optimization_flagged
  (clear the flag if latency_p95 <= 5000 — Ada: conditionally include the REMOVE clause
   only when new_latency_p95 <= 5000. If new_latency_p95 > 5000, omit the REMOVE clause.)
```

New attributes added to the skill record by this update:
- `last_validated_at` (S, ISO 8601) — not currently in dynamo-schemas.md. Ada must add this field to the schema doc as part of IMPL-11.
- `test_pass_count` (N) — count of passing tests in the most recent validation run.
- `test_fail_count` (N) — count of failing tests in the most recent validation run.

**Ada must update `docs/dynamo-schemas.md` to add `last_validated_at`, `test_pass_count`, and `test_fail_count` to the codevolve-skills attributes table as part of IMPL-11-A delivery.**

### 2.5 Kinesis Event

```typescript
{
  event_type: "validate",
  skill_id: skill_id,
  intent: null,
  latency_ms: totalValidationWallClockMs,  // wall-clock time from handler start to response
  confidence: new_confidence,
  cache_hit: false,
  input_hash: null,
  success: (pass_count === total_tests),   // true only if all tests passed
}
```

Emit before returning the HTTP response. Fire-and-forget (do not await on critical path).

### 2.6 Deep Equality Comparison

This section is retained for reference. In the caller-reported model, deep equality comparison is the caller's responsibility when comparing skill output to expected values locally. The registry does not perform comparison — it accepts the aggregated pass/fail counts the caller reports.

If the `results` array is supplied in the request body, each `TestResult` record's `passed` field is accepted as-is. The handler does not re-evaluate or verify individual test outcomes.

### 2.7 Handler Latency

The `/validate` Lambda handler has no execution timeout concern beyond normal Lambda limits. It does not invoke any external runners, containers, or sub-Lambdas. The handler's work is: (1) parse request, (2) fetch skill from DynamoDB, (3) write updated confidence/status back to DynamoDB, (4) emit Kinesis event, (5) optionally enqueue to GapQueue. This is a lightweight DynamoDB-read + DynamoDB-write flow completing in well under 1 second.

### 2.8 Error Cases

| HTTP | Code | Condition |
|------|------|-----------|
| 400 | `VALIDATION_ERROR` | `skill_id` not a valid UUID; `pass_count + fail_count != total_tests`; request body malformed |
| 400 | `NO_TESTS_DEFINED` | `total_tests` is 0 |
| 404 | `NOT_FOUND` | Skill does not exist |
| 422 | `PRECONDITION_FAILED` | Skill is archived (`status == "archived"`) |

---

## 3. POST /evolve (SQS Consumer)

### 3.1 Architecture

The `/evolve` SQS consumer is a Lambda function triggered by `codevolve-gap-queue.fifo` (the GapQueue defined in ARCH-07). It is NOT an API Gateway endpoint for Phase 4 — the API Gateway endpoint (`POST /evolve`) from Phase 2 enqueues to SQS (fire-and-forget). This Lambda is the async worker that processes those messages.

```
SQS GapQueue (codevolve-gap-queue.fifo)
    │
    └── Lambda: codevolve-evolve
            │
            ├── 1. Parse SQS message body
            ├── 2. Lookup similar skills via internal resolve call (no HTTP — direct DynamoDB query)
            ├── 3. Build Claude prompt
            ├── 4. Call Claude API (claude-sonnet-4-6)
            ├── 5. Parse Claude response → skill JSON
            ├── 6. Validate skill JSON against Zod schema
            ├── 7. Write new skill to DynamoDB (POST /skills logic, reuse createSkill util)
            ├── 8. Auto-trigger /validate on new skill (internal invocation, not HTTP)
            └── 9. Write job status to codevolve-evolve-jobs (success or failure)
```

### 3.2 SQS Message Shape

```typescript
// Produced by: /resolve handler (when resolve_confidence < 0.7)
//              /validate handler (when new_confidence < 0.7)
//              Decision Engine (gap detection rule)
const GapQueueMessage = z.object({
  evolve_id: z.string().uuid(),            // generated by the enqueuer; stored in evolve-jobs
  intent: z.string().max(1024).nullable(), // natural language intent (from /resolve gap)
  skill_id: z.string().uuid().nullable(),  // existing skill to improve (from /validate gap)
  language: SupportedLanguage,
  domain: z.array(z.string()).min(1),
  tags: z.array(z.string()).default([]),
  problem_id: z.string().uuid().nullable(),
  resolve_confidence: z.number().min(0).max(1).nullable(),
  timestamp: z.string().datetime(),
  original_event_id: z.string().nullable(), // Kinesis event_id that triggered this, for tracing
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  reason: z.enum(["low_confidence", "no_match", "failed_execution", "decision_engine"]),
});
```

**SQS FIFO deduplication:** The enqueuer sets `MessageGroupId = language` (round-robins across language groups) and `MessageDeduplicationId = SHA-256(intent + language)` to avoid duplicate jobs for the same intent+language pair within the 5-minute SQS dedup window.

### 3.3 Similar Skills Lookup

Before calling Claude, the handler fetches up to 3 existing skills for the same domain and language to include in the prompt as context. This uses a direct DynamoDB query (not an HTTP call to `/resolve`) to avoid adding latency to the synchronous API path.

```
Query codevolve-skills GSI-language-confidence
  KeyConditionExpression: language = :lang AND confidence >= :min_conf
  FilterExpression: contains(domain, :domain)
  ScanIndexForward: false  // highest confidence first
  Limit: 3
```

`min_conf = 0.5`. If the domain filter reduces results to 0, retry without the domain filter (language-only). The top 3 skills' `name`, `description`, `implementation` (first 2000 chars), and `tests` (first 3 test cases) are included in the prompt.

### 3.4 Claude Prompt Design

```typescript
function buildEvolvePrompt(message: GapQueueMessage, similarSkills: Skill[]): string {
  const context = similarSkills.length > 0
    ? `Existing skills for context:\n${similarSkills.map(s =>
        `- ${s.name} (${s.language}, confidence: ${s.confidence}):\n${s.implementation.slice(0, 2000)}`
      ).join('\n\n')}`
    : "No existing skills found for this domain.";

  const target = message.intent
    ? `Intent: "${message.intent}"`
    : `Improve existing skill: "${message.skill_id}"`;

  return `You are generating a new programming skill for the codeVolve registry.

${target}
Language: ${message.language}
Domain: ${message.domain.join(', ')}
Tags: ${message.tags.join(', ')}
${message.problem_id ? `Problem ID: ${message.problem_id}` : ''}

${context}

Generate a complete skill JSON object matching this exact schema:
{
  "name": "string (concise, max 256 chars)",
  "description": "string (what this skill does, max 4096 chars)",
  "language": "${message.language}",
  "domain": ${JSON.stringify(message.domain)},
  "tags": ["string"],
  "inputs": [{ "name": "string", "type": "string" }],
  "outputs": [{ "name": "string", "type": "string" }],
  "examples": [{ "input": {}, "output": {} }],
  "tests": [{ "input": {}, "expected": {} }],
  "implementation": "string (complete, runnable code defining a function named solve)"
}

Requirements:
1. The implementation MUST define a function named solve() that accepts the input fields as keyword arguments.
2. Include at least 3 test cases with known correct expected outputs.
3. The implementation must be complete and correct — no placeholders or TODOs.
4. Return ONLY the JSON object, no markdown fences, no explanation.`;
}
```

### 3.5 Claude API Call

```typescript
import Anthropic from '@anthropic-ai/sdk';

// API key retrieved from Secrets Manager at Lambda init (not per-invocation)
// Secret name: codevolve/anthropic-api-key
// Secret shape: { "api_key": "sk-ant-..." }

const client = new Anthropic({ apiKey: anthropicApiKey });

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  messages: [
    { role: 'user', content: prompt }
  ],
});

const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
```

**Timeout:** The Lambda function timeout for `codevolve-evolve` is 5 minutes (300s). The Claude API call may take 30-60s for complex skills. The Lambda timeout is set well above this to avoid incomplete skill generation.

### 3.6 Response Parsing and Validation

```typescript
function parseClaudeSkillResponse(rawText: string): unknown {
  // Strip any accidental markdown fences
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(cleaned);
}
```

After parsing, validate with the `CreateSkillRequest` Zod schema (the same schema used by `POST /skills`). If validation fails:
1. Emit `event_type: "evolve_failed"` to Kinesis with `skill_id: null`, `success: false`, `intent: message.intent`.
2. Write job status `"failed"` to `codevolve-evolve-jobs` with `error: "claude_response_invalid"` and `raw_response` (first 2000 chars).
3. Do NOT throw — return `{ batchItemFailures: [] }` to SQS so the message is consumed (not retried). Retrying a schema-invalid Claude response is not useful. If the message persists across Claude model updates, it can be re-enqueued manually.

**Exception:** If Claude returns a valid JSON object that fails Zod validation only on the `tests` field (e.g., missing `expected`), attempt to auto-repair by swapping `output` for `expected` in test cases. If repair succeeds, proceed. If repair fails, fall through to failure handling.

### 3.7 Writing the New Skill

After Zod validation passes, call the internal `createSkill` utility (same function used by the `POST /skills` Lambda handler, imported from `src/registry/createSkill.ts`). Augment the request with:
- `problem_id`: from `message.problem_id` if set, else null (skill created without problem link)
- `version_label`: `"0.1.0"`
- `status`: `"partial"` (not `unsolved` — it has an implementation)
- `is_canonical`: `false`
- `confidence`: `0` (will be set by the auto-triggered /validate below)

The `createSkill` function handles DynamoDB PutItem, Bedrock embedding generation, and `skill_count` increment on the problems table (if `problem_id` is set).

### 3.8 Auto-Triggering /validate

After the skill is written to DynamoDB, trigger validation by invoking the `/validate` Lambda directly (not via HTTP):

```typescript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const validatePayload = {
  pathParameters: { skill_id: newSkill.skill_id },
  body: JSON.stringify({ timeout_ms: 60000 }),
};

await lambdaClient.send(new InvokeCommand({
  FunctionName: process.env.VALIDATE_LAMBDA_NAME,
  InvocationType: 'Event',  // async — fire-and-forget
  Payload: Buffer.from(JSON.stringify(validatePayload), 'utf8'),
}));
```

Use `InvocationType: 'Event'` (async). The evolve handler does not wait for validation to complete — it records the job as `"completed"` and lets validation update the confidence score independently.

### 3.9 Job Status Tracking

All job state is written to `codevolve-evolve-jobs` (new table, defined in §7).

| Stage | status written |
|-------|---------------|
| Message received (start of handler) | `"in_progress"` |
| Claude call successful, skill written | `"completed"` |
| Claude parse/validation failure | `"failed"` |
| Unexpected exception | `"failed"` |

### 3.10 Error Handling and DLQ Policy

| Error type | Action | SQS outcome |
|------------|--------|-------------|
| Claude API timeout (>60s) | Log error, write job `"failed"`, emit `evolve_failed` event | Return `{ batchItemFailures: [] }` — consume message, no retry |
| Claude API rate limit (429) | Write job `"failed"` with `error: "claude_rate_limited"` | Return `{ batchItemFailures: [{ itemIdentifier: messageId }] }` — leave in queue for retry |
| Claude API network error | Same as rate limit — transient, retry | Leave in queue |
| Zod validation failure on Claude response | Log raw response (first 2000 chars), write job `"failed"` | Consume message (no retry — retrying identical input won't help) |
| DynamoDB write failure (createSkill) | Transient: leave in queue. Permanent (e.g., conditional check failed): consume |
| Unexpected exception | Log full stack, write job `"failed"` | Return `{ batchItemFailures: [{ itemIdentifier: messageId }] }` |

SQS FIFO queue `maxReceiveCount` = 3. After 3 failures, the message routes to the `codevolve-evolve-dlq.fifo` dead-letter queue.

---

## 4. POST /skills/:id/promote-canonical

### 4.1 Promotion Gate

Before any DynamoDB write, validate ALL of the following:

| Check | Condition | Error if violated |
|-------|-----------|------------------|
| Skill exists | GetItem returns a record | 404 NOT_FOUND |
| Not already canonical | `is_canonical !== true` | 409 CONFLICT |
| Not archived | `status !== "archived"` | 422 PRECONDITION_FAILED |
| Status is verified or optimized | `status === "verified" OR status === "optimized"` | 422 PRECONDITION_FAILED |
| Confidence threshold | `confidence >= 0.85` | 422 PRECONDITION_FAILED (include current confidence in details) |
| All tests passing | `test_fail_count === 0 AND test_pass_count > 0` | 422 PRECONDITION_FAILED |

**`test_fail_count` and `test_pass_count` must have been set by a `/validate` run.** If both are absent (skill has never been validated), treat as `test_fail_count = 1` (fails the gate). The skill must be validated before it can be promoted.

### 4.2 Previous Canonical Lookup

Query for the current canonical skill for the same `problem_id` + `language` combination:

```
Query codevolve-skills GSI-canonical
  KeyConditionExpression: is_canonical_status = :val
  FilterExpression: problem_id = :problem_id AND language = :language
```

Where `is_canonical_status` is either `"true#verified"` or `"true#optimized"`.

If a previous canonical is found, its `skill_id` and `version_number` are needed for the atomic transaction.

### 4.3 Atomic DynamoDB Transaction

Use `TransactWriteItems` with up to 2 items:

```typescript
const transactItems = [];

// Item 1: Promote new canonical
transactItems.push({
  Update: {
    TableName: 'codevolve-skills',
    Key: { skill_id: skillId, version_number: skill.version_number },
    UpdateExpression: `
      SET is_canonical = :true,
          is_canonical_status = :canonical_status,
          updated_at = :now
    `,
    ExpressionAttributeValues: {
      ':true': true,
      ':canonical_status': `true#${skill.status}`,
      ':now': new Date().toISOString(),
    },
    ConditionExpression: 'confidence >= :threshold AND test_fail_count = :zero',
    ExpressionAttributeValues: {
      // merge with above
      ':threshold': 0.85,
      ':zero': 0,
    },
  },
});

// Item 2: Demote previous canonical (only if one exists)
if (previousCanonical) {
  transactItems.push({
    Update: {
      TableName: 'codevolve-skills',
      Key: {
        skill_id: previousCanonical.skill_id,
        version_number: previousCanonical.version_number,
      },
      UpdateExpression: `
        SET is_canonical = :false,
            updated_at = :now
        REMOVE is_canonical_status
      `,
      ExpressionAttributeValues: {
        ':false': false,
        ':now': new Date().toISOString(),
      },
    },
  });
}

// Item 3: Update problems table canonical_skill_id
transactItems.push({
  Update: {
    TableName: 'codevolve-problems',
    Key: { problem_id: skill.problem_id },
    UpdateExpression: 'SET canonical_skill_id = :skill_id, updated_at = :now',
    ExpressionAttributeValues: {
      ':skill_id': skillId,
      ':now': new Date().toISOString(),
    },
  },
});
```

**Note:** `TransactWriteItems` supports up to 100 items. We use at most 3. If the condition check on Item 1 fails (race condition where confidence dropped between gate check and transaction), the transaction is rejected with `TransactionCanceledException` containing the cancellation reason `ConditionalCheckFailed`. Map this to `422 PRECONDITION_FAILED`.

### 4.4 Response

```typescript
const PromoteCanonicalResponse = z.object({
  skill: Skill,                                    // updated skill with is_canonical: true
  demoted_skill_id: z.string().uuid().nullable(),  // previous canonical skill_id, or null
});
```

Return HTTP 200 with the updated skill record (re-fetch after transaction to return current state).

### 4.5 Cache Invalidation

After a successful promotion, invalidate resolve cache for this `problem_id`. This is done by querying `codevolve-cache` for all entries with `skill_id` matching the demoted skill (if any) and deleting them. The new canonical has no cache entries yet (it was not previously routed to), so no invalidation is needed for it.

---

## 5. Confidence Score Lifecycle

| Event | Confidence value | Notes |
|-------|-----------------|-------|
| Skill created (`POST /skills`) | `0.0` | Set server-side, never client-settable |
| After `/validate` | `pass_count / total_tests` | Simple ratio. 0 tests → 0.0. All pass → 1.0. |
| After real-world execution failure | Decreased by Decision Engine | Phase 3 feature, out of scope for IMPL-11. Decision Engine reads ClickHouse failure events and writes back to DynamoDB. Not triggered by /validate. |
| After archival | Unchanged | Archived skills retain their last confidence score. |

### 5.1 Confidence Formula

```
new_confidence = pass_count / total_tests
```

Where:
- `pass_count` is the count of tests where `deepEqual(actual, expected) === true`.
- `total_tests` includes `additional_tests` passed in the request (they count toward confidence).
- `additional_tests` do NOT persist to the skill record. Confidence is computed from the combined set, but only the built-in test results are permanently meaningful.
- If `total_tests === 0`, `new_confidence = 0.0` (this case is blocked by the 400 NO_TESTS_DEFINED guard in §2.2 step 3, but the formula must handle it defensively).

**Rationale:** A simple pass rate ratio is chosen over weighted formulas (e.g., latency-weighted, recency-weighted) for Phase 4 because: (1) it is transparent and auditable, (2) it maps directly to the canonical gate threshold (0.85 = at least 85% of tests passing), and (3) it avoids premature complexity before we have execution history to calibrate weights against. See ADR-009.

### 5.2 Status After Confidence Update

The confidence update does not automatically raise or lower status (e.g., `verified` does not become `partial` if confidence drops). Status is only changed by explicit `/validate` runs per the rules in §6. The Decision Engine may flag skills for archival based on confidence, but does not change status directly.

---

## 6. Status Transitions After Validation

| Condition | New status | Notes |
|-----------|-----------|-------|
| `pass_rate == 0.0` AND `implementation` is empty string | `unsolved` | No implementation and all tests fail |
| `pass_rate == 0.0` AND `implementation` is non-empty | `partial` | Has implementation but nothing passes |
| `pass_rate > 0.0 AND pass_rate < 1.0` | `partial` | Some tests pass |
| `pass_rate == 1.0` AND current status is NOT `optimized` | `verified` | All tests pass |
| `pass_rate == 1.0` AND current status is `optimized` | `optimized` | Stay at optimized — do not downgrade |
| Skill is `archived` | — | 422 PRECONDITION_FAILED before reaching this logic |

**Implementation note:** `status_changed = (new_status !== previous_status)`. Include this in the response.

---

## 7. codevolve-evolve-jobs Table

This table is introduced in IMPL-12. Full schema spec is deferred to `docs/dynamo-schemas.md` update in IMPL-12-A (Ada's responsibility). The design constraints are:

### 7.1 Key Schema

| Key | Attribute | Type |
|-----|-----------|------|
| Partition Key | `evolve_id` | `S` (UUID v4) |
| Sort Key | — | — |

Single-item table (no sort key needed — one record per evolve job).

### 7.2 Required Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `evolve_id` | S | UUID from the GapQueue message. Partition key. |
| `status` | S | `queued`, `in_progress`, `completed`, `failed` |
| `intent` | S | Natural language intent. Null if improvement mode. |
| `skill_id_input` | S | Existing skill to improve. Null if intent mode. |
| `result_skill_id` | S | The new skill written to DynamoDB. Null until completed. |
| `language` | S | Target language. |
| `domain` | L (of S) | Target domain. |
| `reason` | S | `low_confidence`, `no_match`, `failed_execution`, `decision_engine` |
| `error` | S | Error description on failure. Null on success. |
| `created_at` | S | ISO 8601. Set when message is first received. |
| `updated_at` | S | ISO 8601. Set on every status change. |
| `completed_at` | S | ISO 8601. Set on `completed` or `failed`. |
| `ttl` | N | Unix epoch seconds. 30-day TTL. Evolve job records auto-expire. |

### 7.3 GSI

| GSI Name | Partition Key | Sort Key | Purpose |
|----------|--------------|----------|---------|
| `GSI-status-created` | `status` (S) | `created_at` (S) | Query all jobs by status, sorted chronologically. Used by the `evolution-gap` analytics dashboard `recent_evolve_jobs` field. |

---

## 8. CDK Resources Required

All new CDK resources are added to `infra/codevolve-stack.ts`.

### 8.1 IMPL-11 — /validate Lambda

| Resource | Type | Config |
|----------|------|--------|
| `ValidateFn` | Lambda (NODEJS_22_X) | 256 MB, 5 min timeout, entry: `src/validation/handler.ts` |
| IAM grants | — | DynamoDB GetItem+UpdateItem on `codevolve-skills` (PK/SK), DynamoDB DeleteItem+Query on `codevolve-cache`, Kinesis PutRecord, SQS SendMessage on `codevolve-gap-queue.fifo` |
| Env vars | — | `SKILLS_TABLE`, `CACHE_TABLE`, `KINESIS_STREAM_NAME`, `GAP_QUEUE_URL` |
| API Gateway route | — | `POST /validate/{skill_id}` → `ValidateFn` |

### 8.2 IMPL-12 — /evolve SQS Consumer Lambda

| Resource | Type | Config |
|----------|------|--------|
| `EvolveFn` | Lambda (NODEJS_22_X) | 512 MB, 5 min timeout, entry: `src/evolve/handler.ts` |
| `EvolveGapQueue` | SQS FIFO Queue | `codevolve-gap-queue.fifo`, content-based dedup enabled, 5 min visibility timeout, 14-day retention |
| `EvolveDlq` | SQS FIFO Queue | `codevolve-evolve-dlq.fifo`, 14-day retention |
| SQS event source | — | batchSize: 1 (FIFO), maxConcurrency: 5, onFailure: `EvolveDlq`, reportBatchItemFailures: true |
| `EvolveJobsTable` | DynamoDB | `codevolve-evolve-jobs`, PK: `evolve_id` (S), on-demand, TTL: `ttl`, GSI: `GSI-status-created` |
| IAM grants | — | DynamoDB PutItem+UpdateItem on `codevolve-evolve-jobs`, DynamoDB Read on `codevolve-skills` (GSI query), DynamoDB PutItem on `codevolve-skills` (createSkill), Secrets Manager GetSecretValue on `codevolve/anthropic-api-key`, `lambda:InvokeFunction` on `ValidateFn`, Kinesis PutRecord, SQS ReceiveMessage+DeleteMessage on `EvolveGapQueue` |
| Env vars | — | `ANTHROPIC_SECRET_ARN`, `VALIDATE_LAMBDA_NAME`, `SKILLS_TABLE`, `PROBLEMS_TABLE`, `EVOLVE_JOBS_TABLE`, `KINESIS_STREAM_NAME` |

**Note on batchSize: 1 for FIFO:** SQS FIFO queues with Lambda event sources process one message at a time per message group. batchSize: 1 simplifies error handling — each Lambda invocation handles exactly one evolve job, and a failure does not block other message groups.

### 8.3 IMPL-13 — promote-canonical (no new Lambda)

`promote-canonical` is an API Gateway route added to the existing `SkillsFn` Lambda (the registry handler from IMPL-02) or as a new dedicated Lambda. **Decision: add as a new dedicated Lambda** to keep the registry handler's scope bounded and simplify IAM scoping.

| Resource | Type | Config |
|----------|------|--------|
| `PromoteCanonicalFn` | Lambda (NODEJS_22_X) | 256 MB, 30s timeout, entry: `src/registry/promoteCanonical.ts` |
| IAM grants | — | DynamoDB TransactWriteItems on `codevolve-skills` + `codevolve-problems`, DynamoDB Query on `GSI-canonical` of `codevolve-skills`, DynamoDB DeleteItem+Query on `codevolve-cache` |
| Env vars | — | `SKILLS_TABLE`, `PROBLEMS_TABLE`, `CACHE_TABLE` |
| API Gateway route | — | `POST /skills/{id}/promote-canonical` → `PromoteCanonicalFn` (update existing stub route) |

---

## 9. IMPL-11 Sub-Tasks — /validate

> Sub-tasks A and B can run in parallel. C depends on A and B. D depends on C.

### Pre-conditions

1. `npx tsc --noEmit` exits 0 before starting.
2. No runner Lambda dependencies. The validate handler accepts caller-reported results and makes no outbound Lambda invocations.

---

### IMPL-11-A: Schema and deepEqual Utility

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/shared/deepEqual.ts` (new), `tests/unit/shared/deepEqual.test.ts` (new), `docs/dynamo-schemas.md` (add 3 attributes) |
| Depends on | — |
| Blocks | IMPL-11-C |
| Verification | `npx jest tests/unit/shared/deepEqual.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:**
1. `deepEqual(a: unknown, b: unknown): boolean` in `src/shared/deepEqual.ts`. Handles primitives, arrays, objects, and null. Does not use `JSON.stringify`.
2. Unit tests covering: equal primitives, unequal primitives, equal arrays, arrays of different length, equal nested objects (key-order-independent), nested objects with differing values, null === null, null !== undefined.
3. Add to `docs/dynamo-schemas.md` codevolve-skills attributes table:
   - `last_validated_at` (S, ISO 8601, set by /validate)
   - `test_pass_count` (N, count of passing tests in last validation run)
   - `test_fail_count` (N, count of failing tests in last validation run)

---

### IMPL-11-B: CDK Resources

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `infra/codevolve-stack.ts` |
| Depends on | — |
| Blocks | IMPL-11-E |
| Verification | `npx cdk synth` exits 0; template contains `ValidateFn` with NODEJS_22_X runtime, 5 min timeout, correct IAM grants for DynamoDB, Kinesis, SQS |

**What to build:** `ValidateFn` Lambda construct per §8.1 specification. Environment variables set. IAM grants for DynamoDB, Kinesis, SQS (no runner Lambda grants needed). API Gateway route `POST /validate/{skill_id}`.

---

### IMPL-11-C: /validate Handler

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/validation/handler.ts` (new), `src/validation/index.ts` (update from stub), `tests/unit/validation/handler.test.ts` (new) |
| Depends on | IMPL-11-A |
| Blocks | IMPL-11-D |
| Verification | `npx jest tests/unit/validation/` passes; `npx tsc --noEmit` exits 0 |

**What to build:**
1. Full handler implementing the flow in §2.2.
2. Request parsing and Zod validation for path param + body (caller-reported `total_tests`, `pass_count`, `fail_count`, optional `results` and latency fields).
3. DynamoDB GetItem for skill fetch.
4. Count validation: `pass_count + fail_count == total_tests`; reject if `total_tests == 0`.
5. Confidence calculation (`pass_count / total_tests`).
6. Status transition logic per §6.
7. DynamoDB UpdateItem per §2.4 (including conditional REMOVE of `optimization_flagged`).
8. Cache invalidation (scan `codevolve-cache` by `skill_id`, batch delete).
9. Kinesis event emission per §2.5.
10. Evolve trigger if `new_confidence < 0.7`.
11. Unit tests: mock DynamoDB. Cover all error paths (total_tests=0, count mismatch, archived, not found). Cover status transition logic. Cover confidence = 0, confidence = 1.0, confidence = partial.

---

### IMPL-11-D: Integration Tests

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `tests/integration/validation/validate.test.ts` (new) |
| Depends on | IMPL-11-C, IMPL-11-B (CDK deployed to dev) |
| Blocks | — |
| Verification | `npx jest tests/integration/validation/` passes against dev environment |

**What to build:** Integration tests that POST to the live `/validate` endpoint:
1. Validate a skill with all passing tests → assert `pass_rate == 1.0`, `new_confidence == 1.0`, status `verified`.
2. Validate a skill with mixed pass/fail tests → assert `pass_rate` is correct ratio, status `partial`.
3. Validate a skill with no tests → assert 400 NO_TESTS_DEFINED.
4. Validate an archived skill → assert 422 PRECONDITION_FAILED.
5. Validate with `additional_tests` → assert they are included in total_tests count.

---

### IMPL-11 Completion Gate

1. `npx tsc --noEmit` — exits 0.
2. `npx jest tests/unit/validation/ tests/unit/shared/deepEqual.test.ts` — all pass.
3. `npx cdk synth` — exits 0, template contains `ValidateFn`.
4. Integration tests pass against dev environment.
5. `docs/dynamo-schemas.md` updated with 3 new attributes.

---

## 10. IMPL-12 Sub-Tasks — /evolve SQS Consumer

> Sub-tasks A and B can run in parallel. C depends on A. D depends on B and C.

### Pre-conditions

1. IMPL-11 is complete and `ValidateFn` is deployed.
2. `codevolve/anthropic-api-key` secret exists in Secrets Manager in `us-east-2`.
3. `@anthropic-ai/sdk` is in `package.json` dependencies. If absent, add it in IMPL-12-A.

---

### IMPL-12-A: evolve-jobs Table Schema and Package Setup

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `docs/dynamo-schemas.md` (add evolve-jobs table), `package.json` (add `@anthropic-ai/sdk` if absent) |
| Depends on | — |
| Blocks | IMPL-12-C |
| Verification | `npx tsc --noEmit` exits 0; `npm ls @anthropic-ai/sdk` returns a version |

**What to build:**
1. Add `codevolve-evolve-jobs` table specification to `docs/dynamo-schemas.md` per §7.
2. Confirm `@anthropic-ai/sdk` is present in `package.json`. If not, add the latest stable version and run `npm install`.

---

### IMPL-12-B: CDK Resources

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `infra/codevolve-stack.ts` |
| Depends on | — |
| Blocks | IMPL-12-E |
| Verification | `npx cdk synth` exits 0; template contains `EvolveFn`, `EvolveGapQueue`, `EvolveDlq`, `EvolveJobsTable`, SQS event source mapping on `EvolveFn` |

**What to build:** All CDK constructs per §8.2. Write stub handler that logs the event and returns `{ batchItemFailures: [] }`.

---

### IMPL-12-C: Claude Client and Skill Parser

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/evolve/claudeClient.ts` (new), `src/evolve/skillParser.ts` (new), `tests/unit/evolve/skillParser.test.ts` (new) |
| Depends on | IMPL-12-A |
| Blocks | IMPL-12-D |
| Verification | `npx jest tests/unit/evolve/skillParser.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:**
1. `src/evolve/claudeClient.ts`: lazy singleton `getAnthropicClient()` that reads the API key from Secrets Manager on first call. Export `_setAnthropicClientForTesting(client)` for test injection.
2. `src/evolve/skillParser.ts`: `parseClaudeSkillResponse(rawText: string): unknown` (JSON extraction with markdown fence stripping) and `repairTestCases(parsed: unknown): unknown` (swap `output` → `expected` if needed).
3. Unit tests: valid JSON response → correct parse; markdown-fenced JSON → stripped and parsed; invalid JSON → throws; test case repair case (`output` instead of `expected`) → repaired; repair failure → throws.

---

### IMPL-12-D: /evolve SQS Handler

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/evolve/handler.ts` (replace stub), `src/evolve/index.ts` (update), `tests/unit/evolve/handler.test.ts` (new) |
| Depends on | IMPL-12-C, IMPL-12-B |
| Blocks | IMPL-12-E |
| Verification | `npx jest tests/unit/evolve/handler.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:**
1. Full SQS handler per the flow in §3.
2. SQS message parsing (Zod validate `GapQueueMessage`).
3. Similar skills DynamoDB query per §3.3.
4. Prompt building per §3.4.
5. Claude API call per §3.5 (use injected client in tests).
6. Response parsing and Zod validation per §3.6 (call `parseClaudeSkillResponse` + Zod).
7. `createSkill` invocation (import from `src/registry/`).
8. Async `/validate` Lambda invocation per §3.8.
9. Job status writes to `codevolve-evolve-jobs` per §3.9.
10. Error handling per §3.10 (correct `batchItemFailures` return for transient vs permanent failures).
11. Unit tests: mock Anthropic client, mock DynamoDB. Cover: successful flow (skill created, validate triggered, job status = completed); Claude validation failure (job status = failed, batchItemFailures empty); DynamoDB write failure (job status = failed, batchItemFailures contains message ID); test case repair path.

---

### IMPL-12-E: End-to-End Smoke Test

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `scripts/evolve-smoke-test.ts` (new, test script only) |
| Depends on | IMPL-12-D, IMPL-12-B (CDK deployed) |
| Blocks | — |
| Verification | Manual: send a test SQS message to `codevolve-gap-queue.fifo`, observe Lambda logs, confirm new skill appears in `codevolve-skills`, confirm validation event in ClickHouse within 60s |

---

### IMPL-12 Completion Gate

1. `npx tsc --noEmit` — exits 0.
2. `npx jest tests/unit/evolve/` — all pass.
3. `npx cdk synth` — exits 0, template contains `EvolveFn`, `EvolveGapQueue`, `EvolveDlq`, `EvolveJobsTable`.
4. `docs/dynamo-schemas.md` includes `codevolve-evolve-jobs` table spec.
5. E2E smoke test: one valid SQS message → new skill in DynamoDB → validation event in ClickHouse.

---

## 11. IMPL-13 Sub-Tasks — Canonical Promotion

> Sub-tasks A and B can run in parallel. C depends on A and B.

### Pre-conditions

1. IMPL-11 is complete (skill records have `test_pass_count` and `test_fail_count` attributes).
2. `npx tsc --noEmit` exits 0 before starting.

---

### IMPL-13-A: CDK Resources

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `infra/codevolve-stack.ts` |
| Depends on | — |
| Blocks | IMPL-13-C |
| Verification | `npx cdk synth` exits 0; template contains `PromoteCanonicalFn` with correct IAM grants including `dynamodb:TransactWriteItems` |

**What to build:** `PromoteCanonicalFn` Lambda construct per §8.3.

---

### IMPL-13-B: Promotion Gate Logic (unit-testable, no handler wiring)

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/registry/promoteCanonicalGate.ts` (new), `tests/unit/registry/promoteCanonicalGate.test.ts` (new) |
| Depends on | — |
| Blocks | IMPL-13-C |
| Verification | `npx jest tests/unit/registry/promoteCanonicalGate.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:**
1. `validatePromotionGate(skill: Skill): { valid: true } | { valid: false; status: number; code: string; message: string }` — pure function, no DynamoDB calls.
2. Unit tests for every gate condition: not found (handled upstream), already canonical (409), archived (422), wrong status (422), confidence < 0.85 (422 with exact threshold), test_fail_count > 0 (422), never validated (test_pass_count absent → 422), all gates pass → `{ valid: true }`.

---

### IMPL-13-C: promote-canonical Handler

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/registry/promoteCanonical.ts` (new), `tests/unit/registry/promoteCanonical.test.ts` (new) |
| Depends on | IMPL-13-A, IMPL-13-B |
| Blocks | — |
| Verification | `npx jest tests/unit/registry/promoteCanonical.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:**
1. Full handler implementing §4 flow.
2. `GetItem` for skill fetch.
3. `validatePromotionGate` call.
4. GSI query for previous canonical per §4.2.
5. `TransactWriteItems` per §4.3 (promote new, demote old, update problems table).
6. Cache invalidation for demoted skill_id.
7. Re-fetch promoted skill and return `PromoteCanonicalResponse`.
8. Unit tests: mock DynamoDB. Cover: successful promotion (no previous canonical), successful promotion (with previous canonical demoted), gate failure at each condition, transaction failure `ConditionalCheckFailed` → 422, skill not found → 404.

---

### IMPL-13 Completion Gate

1. `npx tsc --noEmit` — exits 0.
2. `npx jest tests/unit/registry/` (promoteCanonicalGate + promoteCanonical) — all pass.
3. `npx cdk synth` — exits 0, template contains `PromoteCanonicalFn`.
4. Manual smoke test: create a skill, run /validate (all pass), call promote-canonical → 200 with `is_canonical: true`.
5. Test demote: create a second skill for same problem, validate, promote → previous skill has `is_canonical: false`.

---

*Last updated: 2026-03-22 — ARCH-08 design by Jorven*
