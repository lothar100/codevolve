# codeVolve — Execution Sandbox Architecture

> Authored by Jorven. Design ID: ARCH-06. Ada implements IMPL-06 and IMPL-07 directly from this document.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Sandbox Approach](#2-sandbox-approach)
3. [Input/Output Serialization](#3-inputoutput-serialization)
4. [Timeout and Memory Limits](#4-timeout-and-memory-limits)
5. [Cache Layer Integration](#5-cache-layer-integration)
6. [Error Taxonomy](#6-error-taxonomy)
7. [ADR-006: Lambda-per-Language Sandbox](#7-adr-006-lambda-per-language-sandbox)
8. [Implementation Notes for IMPL-06 and IMPL-07](#8-implementation-notes-for-impl-06-and-impl-07)

---

## 1. Overview

`POST /execute` accepts a `skill_id` and a JSON input object, runs the skill's implementation safely, and returns the output. The full execution path is:

```
POST /execute
    │
    ├── 1. Validate request body (Zod schema)
    ├── 2. Fetch skill from DynamoDB (codevolve-skills)
    │       └── Return 404 if not found or archived
    ├── 3. Validate inputs against skill's input schema
    │       └── Return 422 EXECUTION_FAILED if inputs don't match
    ├── 4. Compute input_hash = SHA-256(canonical JSON of inputs)
    ├── 5. Check codevolve-cache: GetItem(skill_id, input_hash)
    │       ├── Cache HIT → return cached output, cache_hit: true
    │       │                emit execute event (cache_hit: true)
    │       │                update hit_count + last_hit_at on cache entry
    │       └── Cache MISS → invoke runner Lambda (step 6)
    ├── 6. Invoke codevolve-runner-<language> Lambda synchronously
    │       ├── Success → return output, cache_hit: false
    │       │              conditionally write to cache (Decision Engine policy)
    │       │              update execution_count + latency on skill record
    │       │              emit execute event (cache_hit: false)
    │       └── Error → map error_type to HTTP status, emit execute event (success: false)
    └── Return ExecuteResponse
```

The `/execute` Lambda itself never runs user code. It orchestrates the cache check and delegates actual code execution to a separate, restricted runner Lambda for the skill's language. This separation enforces the architectural constraint: no skill implementation can access the network or filesystem from the primary Lambda environment.

---

## 2. Sandbox Approach

### Architecture

A dedicated "runner" Lambda exists for each supported language. The `/execute` Lambda invokes the appropriate runner synchronously, passing the skill's implementation and inputs as the payload. The runner Lambda executes the code inside its own isolated Lambda environment and returns the output.

```
/execute Lambda (codevolve-execute)
    │
    ├── Looks up skill: language = "python"
    │       └── Invokes: codevolve-runner-python312
    │
    └── Looks up skill: language = "javascript"
            └── Invokes: codevolve-runner-node22
```

### Phase 2 Languages and Runner Lambda Names

| Language value (from skill record) | Runner Lambda name | Runtime |
|------------------------------------|--------------------|---------|
| `python` | `codevolve-runner-python312` | Python 3.12 |
| `javascript` | `codevolve-runner-node22` | Node.js 22 |

`language` is the value stored on the skill record in `codevolve-skills`. The `/execute` Lambda maps this to a runner function name using a static lookup table. If `language` has no runner registered, return `400 VALIDATION_ERROR` with code `UNSUPPORTED_LANGUAGE` before attempting invocation.

### Statelessness

Each runner Lambda invocation is fully stateless:

- No shared globals between invocations (Lambda execution contexts may be reused by the runtime, but skill code is re-evaluated per invocation — see Implementation Notes §8.4).
- No inter-invocation state: runner Lambdas have no DynamoDB access, no S3 access, no network egress. Their IAM execution role grants only CloudWatch Logs write.
- Input and output are passed entirely through the Lambda invocation payload. Nothing is stored in `/tmp` that persists to the next execution.

### Network and Filesystem Isolation

Runner Lambdas have IAM policies with explicit deny on all AWS service calls. They are deployed without a VPC attachment (no internet egress). Any skill implementation that attempts to use `fetch`, `axios`, `urllib`, `socket`, or any network primitive will fail with a connection refused error, which surfaces as a `runtime` error to the caller.

Filesystem access is limited to `/tmp` (512 MB, Lambda default). Skill implementations must not rely on filesystem state — if an execution writes to `/tmp`, that state is not guaranteed to persist to the next invocation and is not accessible to other concurrent invocations.

---

## 3. Input/Output Serialization

### Request Input Format

The caller sends a JSON object in the `inputs` field of the `POST /execute` request body. Keys must match the `name` fields in the skill's `inputs` array. Types are not strictly enforced at the transport layer (JSON does not distinguish `int` from `float`, for example) — the runner validates types internally.

```json
{
  "skill_id": "uuid",
  "inputs": {
    "nums": [2, 7, 11, 15],
    "target": 9
  }
}
```

### Output Format

The runner returns a JSON object whose keys match the `name` fields in the skill's `outputs` array.

```json
{
  "result": [0, 1]
}
```

The `/execute` Lambda passes this object as-is in the `outputs` field of `ExecuteResponse`.

### Error Format (from runner)

When execution fails, the runner returns a structured error payload instead of a normal output. The `/execute` Lambda detects this by checking for the presence of the `error` key in the runner response.

```json
{
  "error": "string describing what went wrong",
  "error_type": "timeout | runtime | validation | oom"
}
```

- `error` is a human-readable string. For `runtime` errors, this is the exception message and (where safe to expose) the top of the stack trace.
- `error_type` is one of the four values in the error taxonomy (see §6). The runner sets this field. The `/execute` Lambda uses it to determine the HTTP response status.

### Serialization Protocol

JSON only. No binary protocols (MessagePack, Protobuf, etc.) in Phase 2. Both the invocation payload sent to the runner and the response received from the runner are UTF-8 JSON strings, base64-encoded by the Lambda SDK (see §8.3 for encoding details).

### Canonical JSON for Input Hashing

To compute a stable, order-independent hash of the inputs object, the inputs are serialized to canonical JSON before hashing:

1. Sort all keys alphabetically at every level of nesting (recursive).
2. Serialize with no whitespace.
3. Encode as UTF-8 bytes.
4. Compute SHA-256 and hex-encode the digest.

This ensures `{"a":1,"b":2}` and `{"b":2,"a":1}` produce the same hash.

**Canonical JSON algorithm (TypeScript):**

```typescript
function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (obj as Record<string, unknown>)[key];
      return acc;
    }, {});
  return JSON.stringify(sorted, (_, v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v).sort().reduce<Record<string, unknown>>((a, k) => { a[k] = v[k]; return a; }, {})
      : v
  );
}

function computeInputHash(inputs: Record<string, unknown>): string {
  const canonical = canonicalJson(inputs);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

Import `createHash` from Node's built-in `node:crypto` module. No external dependencies.

---

## 4. Timeout and Memory Limits

### Per-Execution Timeout

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Runner Lambda timeout | 10 seconds | Hard limit set on the Lambda function configuration. Lambda terminates the execution and returns an error when exceeded. |
| `/execute` Lambda wait | 11 seconds | The `InvokeCommand` call in the `/execute` Lambda has an 11-second timeout so it catches both a clean runner timeout response and a Lambda service-level timeout. |
| API Gateway integration timeout | 29 seconds | API Gateway maximum. Well above the runner + overhead ceiling. Not the operative constraint. |

The `timeout_ms` field in `ExecuteRequest` (100–300,000ms per api.md) is accepted by the API but for Phase 2 it is informational only — the hard limit is the 10-second runner Lambda timeout. This field exists to support future per-request timeout configuration without a breaking API change. If `timeout_ms` < 10,000, the effective timeout is `timeout_ms`. If `timeout_ms` > 10,000, the effective timeout is 10,000 (the Lambda hard limit). Document this ceiling in the `ExecuteResponse` or surface it as a warning field if the requested `timeout_ms` was clamped.

When the runner Lambda times out:
- Lambda returns an error response with `FunctionError: "Unhandled"` and a JSON body `{"errorMessage":"Task timed out after 10.00 seconds","errorType":"States.Timeout"}`.
- The `/execute` Lambda catches this, sets `error_type: "timeout"`, and returns HTTP 408 with code `EXECUTION_TIMEOUT`.

### Memory

| Limit | Value | Rationale |
|-------|-------|-----------|
| Runner Lambda memory | 512 MB | Sufficient for typical algorithmic skill implementations. Large data structure problems (graphs, DP tables) rarely exceed 256 MB for inputs in the expected size range. |
| `/execute` Lambda memory | 256 MB | The orchestration Lambda only handles JSON serialization and DynamoDB/cache operations. It never holds the skill output in memory for longer than the response path. |

When a runner Lambda is killed by the Lambda service due to OOM:
- Lambda returns an error response with `FunctionError: "Unhandled"` and status 200 (Lambda-level error, not HTTP error).
- The response body contains `{"errorMessage":"Runtime exited with error: signal: killed","errorType":"Runtime.ExitError"}`.
- The `/execute` Lambda catches this pattern, sets `error_type: "oom"`, and returns HTTP 504.

**Note on HTTP status for OOM:** The `api.md` contract specifies 408 for `EXECUTION_TIMEOUT`. OOM and timeout both result in the execution not completing, but they map to different HTTP statuses: OOM maps to 504 and timeout maps to 408 based on the error taxonomy (see §6). See §8.6 for reconciliation of status codes between this document and the api.md contract.

---

## 5. Cache Layer Integration

The cache table (`codevolve-cache`) is fully specified in `docs/dynamo-schemas.md` §3. This section specifies exactly how `/execute` uses it.

### Cache Key

DynamoDB GetItem key:
```
PK: skill_id  (S)  — the skill's UUID
SK: input_hash (S) — SHA-256 hex of canonical input JSON (see §3)
```

### Cache Check (Before Runner Invocation)

Before invoking the runner Lambda, the `/execute` Lambda issues a `GetItem` against `codevolve-cache` with `(skill_id, input_hash)`.

**If the item exists (cache hit):**
1. Return the `output` map from the cache item as `outputs` in `ExecuteResponse`.
2. Set `cache_hit: true` in the response.
3. Issue an `UpdateItem` to increment `hit_count` and set `last_hit_at` to the current ISO 8601 timestamp. This update is fire-and-forget — do not await it on the critical path.
4. Emit a Kinesis `execute` event with `cache_hit: true`, `success: true`.
5. Do NOT invoke the runner Lambda.
6. Do NOT update `execution_count` or latency fields on the skill record when returning from cache. The execution count counter tracks actual runner invocations, not cache hits. Cache hit volume is tracked in ClickHouse from the analytics events.

**If the item does not exist (cache miss):**
Proceed to runner invocation.

**Cache bypass (`skip_cache: true`):**
When the request includes `skip_cache: true`, skip the GetItem call entirely. Proceed directly to runner invocation. Cache write policy is unchanged — even with `skip_cache: true`, a cache write may occur if the Decision Engine has flagged this skill.

### Cache Write Policy

**Cache writes are controlled by the Decision Engine, not by `/execute` on every successful miss.**

The Decision Engine (a scheduled Lambda, implemented in IMPL-10) evaluates `execution_count` and `input_repeat_rate` for each skill. When a skill crosses the cache threshold (both metrics exceed their respective thresholds — exact values defined in `docs/archive-policy.md` and the Decision Engine config), the Decision Engine writes a pre-populated cache entry to `codevolve-cache` and/or sets a flag that instructs `/execute` to start writing cache entries.

For Phase 2 (IMPL-06/IMPL-07), implement cache writes as follows:

**Phase 2 cache write behaviour:** After a successful runner execution, check the skill record for an `auto_cache` flag (a boolean attribute on the skill item set by the Decision Engine). If `auto_cache: true`, write the result to `codevolve-cache`. If `auto_cache` is absent or false, do not write to cache.

This avoids writing every successful execution to DynamoDB (which would generate unnecessary write costs on low-repeat skills) while still enabling cache writes once the Decision Engine has decided a skill is worth caching.

**Cache write — DynamoDB PutItem:**

```
Table: codevolve-cache
PK: skill_id        (S)  — from request
SK: input_hash      (S)  — computed SHA-256
Attributes:
  version_number    (N)  — integer version number of the skill version that produced this result
  output            (M)  — the runner's output as a DynamoDB map
  input_snapshot    (M)  — the original inputs (for debugging)
  hit_count         (N)  — 0 (initial write)
  last_hit_at       (S)  — null (not yet hit)
  created_at        (S)  — current ISO 8601 timestamp
  ttl               (N)  — Unix epoch seconds: now + 86400 (24 hours, default TTL)
```

TTL extension to 7 days (604800 seconds) is performed by the Decision Engine batch process on entries with `hit_count >= 10`, not by `/execute` inline. Do not write a 7-day TTL on initial cache population.

### Cache Invalidation

Two invalidation scenarios:

**1. New skill version written (version update):**
Handled by the DynamoDB Streams consumer on `codevolve-skills` (implemented as part of the skills table stream). When a new `version_number` is written for a `skill_id`, the stream consumer queries `codevolve-cache` for all items with that `skill_id` and issues `DeleteItem` for any entry where `version_number` does not match the new integer version number. This is not the responsibility of the `/execute` Lambda.

**2. Skill archived:**
The archive handler Lambda (`src/archive/`) deletes all cache entries for the `skill_id` on archive. This is already specified in `docs/archive-design.md`. The `/execute` Lambda does not perform cache invalidation — it simply returns 404 when asked to execute an archived skill.

---

## 6. Error Taxonomy

### Error Types

| `error_type` | Meaning | HTTP Status | Error Code |
|--------------|---------|-------------|------------|
| `validation` | Inputs did not match the skill's input schema (wrong keys, wrong types, missing required fields) | 422 | `EXECUTION_FAILED` |
| `runtime` | Skill code threw an unhandled exception during execution | 422 | `EXECUTION_FAILED` |
| `timeout` | Execution exceeded the 10-second runner Lambda timeout | 408 | `EXECUTION_TIMEOUT` |
| `oom` | Runner Lambda was killed by the Lambda service due to OOM | 504 | `EXECUTION_OOM` |

**Important:** `validation` and `runtime` errors both use HTTP 422 with code `EXECUTION_FAILED`, but they carry different `error_type` values in the response details. This allows callers to distinguish "the inputs were wrong" (fixable by the caller) from "the skill code crashed" (requires skill improvement or `/evolve`).

### Error Response Shape

The `details` field of the standard `ApiError` response carries the execution error info:

```typescript
{
  "error": {
    "code": "EXECUTION_FAILED",       // or "EXECUTION_TIMEOUT" or "EXECUTION_OOM"
    "message": "Skill execution failed: division by zero",
    "details": {
      "error_type": "runtime",        // one of: timeout | runtime | validation | oom
      "execution_id": "uuid",         // unique trace ID for this invocation
      "skill_id": "uuid",
      "version": 3,
      "error_detail": "ZeroDivisionError: division by zero\n  at line 12 in solution"
    }
  }
}
```

For `validation` errors, `error_detail` lists the specific schema violations (which fields were missing or had wrong types).

For `timeout` and `oom`, `error_detail` is a fixed string indicating the limit that was exceeded.

### Stack Trace Sanitization

For `runtime` errors, the `error_detail` field must be sanitized before inclusion in the API response. The runner returns the raw exception string; the `/execute` Lambda applies the following rules before writing `error_detail` into the response:

1. **Maximum 5 stack frames.** Truncate the stack trace at 5 lines after the error message. Discard all remaining frames.
2. **Strip Lambda filesystem paths.** Remove any path segment matching `/var/task/` or `/var/runtime/` from all stack frame strings. Replace the stripped prefix with an empty string, leaving only the relative filename and line reference (e.g. `/var/task/src/handler.py:12` becomes `src/handler.py:12`).
3. **Strip absolute paths from the error message.** If the exception message itself contains an absolute path (any string beginning with `/`), replace the absolute path prefix with the relative portion only.
4. **Keep only: error message + relative file names.** Lambda runtime-internal frames (e.g. frames referencing `bootstrap`, `/var/runtime/`, `node_modules/lambda-runtime`) must be removed entirely.

Ada implements this sanitization in the `/execute` Lambda at the point where runner error payloads are transformed into `ApiError` responses. The sanitizer must be unit-tested in `tests/unit/execution/` with cases covering: absolute path stripping, frame count capping, and bootstrap frame removal.

### Status Code Reconciliation

The `api.md` contract specifies:
- `408 EXECUTION_TIMEOUT` for timeout
- `422 EXECUTION_FAILED` for runtime errors

The task brief proposed 504 for timeout/oom. **The `api.md` contract is authoritative.** Use:
- 408 for `timeout`
- 504 for `oom` (OOM is a gateway-level failure, distinct from a timeout; add `EXECUTION_OOM` as a new error code not in the original api.md contract — document this addition in api.md as part of IMPL-06)
- 422 for `runtime` and `validation`
- 500 for unexpected failures in the `/execute` Lambda itself (not the runner)

Ada must add `504 EXECUTION_OOM` to the `/execute` error table in `docs/api.md` as part of IMPL-06 delivery. This is a non-breaking addition.

### Kinesis Event on Error

On every execution failure, emit a Kinesis `execute` event with:
```json
{
  "event_type": "execute",
  "skill_id": "<skill_id>",
  "latency_ms": "<time from request start to error>",
  "cache_hit": false,
  "input_hash": "<computed hash>",
  "success": false
}
```

Do not suppress event emission on error. The analytics pipeline uses failure events for gap detection and the Decision Engine's optimization flag logic.

---

## 7. ADR-006: Lambda-per-Language Sandbox

See `docs/decisions.md` for the full ADR. Summary:

**Decision:** Each supported language has its own dedicated "runner" Lambda function. The `/execute` Lambda invokes the appropriate runner synchronously via the Lambda SDK (`InvokeCommand`, `InvocationType: "RequestResponse"`). No Docker containers, no AWS Fargate, no ECS.

**Key rationale:**
- Lambda cold start < 500ms for both Python 3.12 and Node 22, well within the acceptable execution overhead budget.
- IAM scoping: runner Lambdas have minimal permissions (CloudWatch Logs only). The `/execute` Lambda's role grants `lambda:InvokeFunction` restricted to the specific runner function ARNs.
- No container registry overhead: runners are standard Lambda functions deployed via CDK, no ECR images required for Phase 2.
- Language addition path is explicit and low-risk: add a new Lambda function + CDK construct + entry in the language lookup map.

---

## 8. Implementation Notes for IMPL-06 and IMPL-07

These notes are written for Ada. They specify exact SDK calls, data shapes, and file responsibilities.

### 8.1 DynamoDB Key Structure for Cache Table

From `docs/dynamo-schemas.md` §3:

```
Table name: codevolve-cache
PK (Partition Key): skill_id   (S)  — UUID v4 string
SK (Sort Key):      input_hash (S)  — SHA-256 hex string (64 characters)
```

DynamoDB DocumentClient calls use this key structure:

```typescript
// Cache read
const key = {
  skill_id: skillId,        // string
  input_hash: inputHash,    // string, 64-char hex
};

// GetItem
const result = await dynamoClient.send(new GetCommand({
  TableName: 'codevolve-cache',
  Key: key,
}));
```

**Note on `version_number` field:** N-NEW-01 was resolved in REVIEW-FIX-05. `docs/dynamo-schemas.md` §3 was updated to rename the cache table field from `skill_version (S, semver string)` to `version_number (N, integer)`. For IMPL-07, write `version_number` as a DynamoDB `N` (integer) attribute in cache entries, using the integer `version_number` from the skill record. Do not use `skill_version` or `version_label`.

### 8.2 Lambda Function Names

The `/execute` Lambda looks up runner function names from environment variables, not hardcoded strings. This allows CDK to inject the actual deployed function names.

Environment variables on the `/execute` Lambda:
```
RUNNER_LAMBDA_PYTHON = codevolve-runner-python312
RUNNER_LAMBDA_NODE   = codevolve-runner-node22
```

In the handler:

```typescript
const RUNNER_MAP: Record<string, string | undefined> = {
  python:     process.env.RUNNER_LAMBDA_PYTHON,
  javascript: process.env.RUNNER_LAMBDA_NODE,
};

const runnerFunctionName = RUNNER_MAP[skill.language];
if (!runnerFunctionName) {
  return buildError(400, 'VALIDATION_ERROR', `Unsupported language: ${skill.language}`);
}
```

CDK must set these environment variables when defining the execute Lambda function.

### 8.3 Lambda Invocation — SDK Call

Use `@aws-sdk/client-lambda` (`InvokeCommand`). This package is already in scope for the project (check `package.json`; add if missing).

```typescript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

// Build the payload the runner expects
const runnerPayload = {
  implementation: skill.implementation,   // string: inline code or s3:// ref
  language: skill.language,               // string: "python" | "javascript"
  inputs: request.inputs,                 // Record<string, unknown>
  timeout_ms: effectiveTimeoutMs,         // number: clamped to max 10000
};

// Invoke
const invokeResponse = await lambdaClient.send(new InvokeCommand({
  FunctionName: runnerFunctionName,
  InvocationType: 'RequestResponse',      // synchronous; Lambda waits for return value
  Payload: Buffer.from(JSON.stringify(runnerPayload), 'utf8'),
}));

// Decode response
const responsePayload = invokeResponse.Payload
  ? JSON.parse(Buffer.from(invokeResponse.Payload).toString('utf8'))
  : null;

// Detect Lambda-level error (timeout, OOM, unhandled throw)
const isFunctionError = !!invokeResponse.FunctionError;
```

**Payload encoding:** The Lambda SDK sends payloads as `Uint8Array`. Wrap the JSON string in `Buffer.from(..., 'utf8')`. On the receiving end (`Buffer.from(invokeResponse.Payload).toString('utf8')`), this gives back the JSON string. Do not base64-encode manually — the SDK handles transport encoding.

**`FunctionError` field:** When a Lambda function throws an unhandled error OR times out, the `InvokeCommand` response has `FunctionError` set to `"Unhandled"` or `"Handled"`. The HTTP status of the `InvokeCommand` response is still 200 (the Lambda service successfully invoked the function). The `/execute` Lambda must inspect `FunctionError` to detect runner-level failures.

### 8.4 Runner Lambda Implementation Pattern

Each runner Lambda is a minimal wrapper. Its handler:

1. Receives the `runnerPayload` as the Lambda event (already decoded from JSON by the Lambda runtime).
2. Evaluates or executes the `implementation` code against the `inputs`.
3. Returns either a normal output object or an error object.

**Python runner (`codevolve-runner-python312`) — handler pattern:**

```python
import json, signal, sys, traceback

def handler(event, context):
    implementation = event['implementation']
    inputs = event['inputs']

    local_ns = {}
    try:
        exec(implementation, {}, local_ns)
        # Convention: the skill implementation must define a function named `solve`
        if 'solve' not in local_ns:
            return {'error': 'Implementation must define a function named solve', 'error_type': 'validation'}
        result = local_ns['solve'](**inputs)
        if not isinstance(result, dict):
            return {'error': 'solve() must return a dict matching the skill output schema', 'error_type': 'runtime'}
        return result
    except Exception as e:
        return {'error': str(e), 'error_type': 'runtime'}
```

**Node 22 runner (`codevolve-runner-node22`) — handler pattern:**

```javascript
exports.handler = async (event) => {
  const { implementation, inputs } = event;
  try {
    const fn = new Function('inputs', `
      ${implementation}
      if (typeof solve !== 'function') throw new Error('Implementation must define a function named solve');
      return solve(inputs);
    `);
    const result = fn(inputs);
    if (typeof result !== 'object' || result === null) {
      return { error: 'solve() must return an object matching the skill output schema', error_type: 'runtime' };
    }
    return result;
  } catch (e) {
    return { error: e.message, error_type: 'runtime' };
  }
};
```

**Skill implementation convention:** All skill implementations (stored in `implementation` on the skill record) must define a function named `solve`. This is the entrypoint contract between the registry and the sandbox. Callers of `POST /execute` do not need to know this; it is an internal convention between the skill author and the runner. The validation endpoint (`/validate`) uses the same runner and the same convention.

**Note:** The `new Function(...)` approach in the Node runner does not provide network or filesystem isolation beyond what Lambda IAM policies enforce. The isolation model relies on IAM (deny all AWS service calls), no VPC, and Lambda's ephemeral execution environment. This is sufficient for Phase 2. Phase 4 may introduce `vm.runInNewContext` or a WASM sandbox if stronger isolation is required.

### 8.5 Execution Count and Latency Updates

On a successful runner execution (not a cache hit), the `/execute` Lambda must:

1. **Increment `execution_count`** on the skill record:
   ```
   UpdateItem on codevolve-skills
   Key: { skill_id, version_number }
   UpdateExpression: ADD execution_count :one, SET last_executed_at = :now
   ExpressionAttributeValues: { ':one': 1, ':now': ISO8601 }
   ```

2. **Update `latency_p50_ms` and `latency_p95_ms`** on the skill record. For Phase 2, use a simple exponential moving average rather than a true percentile (true percentile requires storing all historical latencies, which is overkill for Phase 2):
   - If `latency_p50_ms` is null: set to `latency_ms`.
   - If `latency_p50_ms` is set: `new_p50 = 0.9 * existing_p50 + 0.1 * latency_ms`.
   - Apply the same formula to `latency_p95_ms` using the 95th-percentile proxy: if `latency_ms > existing_p95`, weight more heavily toward the new value: `new_p95 = 0.7 * existing_p95 + 0.3 * latency_ms`.
   - This is explicitly a Phase 2 approximation. True percentile calculation moves to the Decision Engine in Phase 3 when ClickHouse data is available.

3. Both updates are fire-and-forget (do not await on the critical response path). Issue them after the response has been prepared but before returning.

On a cache hit, do not update `execution_count` or latency fields.

### 8.6 Kinesis Event Emission

Emit one `execute` event per `/execute` invocation (cache hit or miss, success or failure). Use the existing `emitEvent` utility from `src/shared/emitEvent.ts`.

Required fields:

```typescript
{
  event_type: 'execute',
  skill_id: skillId,
  intent: null,                  // intent is only set by /resolve events
  latency_ms: totalLatencyMs,    // wall-clock time from request start to response
  confidence: skill.confidence,  // skill's current confidence score
  cache_hit: cacheHit,           // boolean
  input_hash: inputHash,         // SHA-256 hex
  success: executionSucceeded,   // false on any error_type
}
```

Emit this event before returning the HTTP response. Use fire-and-forget pattern (do not `await` the Kinesis write — if it fails, log the error and return the HTTP response normally).

### 8.7 File Responsibilities

| File | Owner task | Purpose |
|------|-----------|---------|
| `src/execution/execute.ts` | IMPL-06 | `/execute` Lambda handler — orchestrates cache check, runner invocation, response building |
| `src/execution/executeChain.ts` | IMPL-06 | `/execute/chain` Lambda handler |
| `src/execution/runners.ts` | IMPL-06 | Language-to-runner-function-name lookup, `InvokeCommand` wrapper |
| `src/execution/inputHash.ts` | IMPL-06 | `canonicalJson` and `computeInputHash` functions |
| `src/execution/index.ts` | IMPL-06 | Replace stub `export {}` with actual exports |
| `src/runners/python312/handler.py` | IMPL-06 | Python runner Lambda handler (Python file, not TypeScript) |
| `src/runners/node22/handler.js` | IMPL-06 | Node 22 runner Lambda handler |
| `src/cache/cache.ts` | IMPL-07 | Cache read (`getCachedOutput`), cache write (`writeCachedOutput`), cache hit update (`incrementCacheHit`) |
| `infra/codevolve-stack.ts` | IMPL-06 | CDK definitions for `codevolve-execute` Lambda, `codevolve-runner-python312`, `codevolve-runner-node22`. IAM grants, environment variables. |
| `tests/unit/execution/` | IMPL-06 | Unit tests for execute handler, runner invocation, input hashing |
| `tests/unit/cache/` | IMPL-07 | Unit tests for cache read/write/invalidation logic |

**Note on runner file locations:** `src/runners/python312/handler.py` and `src/runners/node22/handler.js` are not TypeScript. CDK must bundle them separately using the appropriate Lambda runtime — Python using the Python 3.12 runtime, Node 22 using the Node 22 runtime. Do not attempt to include runner files in the TypeScript compilation.

### 8.8 CDK Constructs Required

The following Lambda functions must be added to `infra/codevolve-stack.ts`:

| Function logical ID | Function name | Runtime | Memory | Timeout | IAM grants |
|---------------------|--------------|---------|--------|---------|------------|
| `ExecuteFn` | `codevolve-execute` | NODEJS_22_X | 256 MB | 30s | DynamoDB GetItem/UpdateItem on `codevolve-skills`, DynamoDB GetItem/UpdateItem/PutItem on `codevolve-cache`, `lambda:InvokeFunction` on runner ARNs, Kinesis PutRecord |
| `RunnerPython312Fn` | `codevolve-runner-python312` | PYTHON_3_12 | 512 MB | 10s | CloudWatch Logs only. Explicit deny on all other AWS services. |
| `RunnerNode22Fn` | `codevolve-runner-node22` | NODEJS_22_X | 512 MB | 10s | CloudWatch Logs only. Explicit deny on all other AWS services. |

The `ExecuteFn` must have environment variables `RUNNER_LAMBDA_PYTHON` and `RUNNER_LAMBDA_NODE` set to the deployed function names of the runner Lambdas. Use CDK's `functionName` attribute to pass these values — do not hardcode strings.

API Gateway route: `POST /execute` → `ExecuteFn`. This route already exists as a stub in the CDK stack from Phase 1 — update it to point to the new handler.

---

*Last updated: 2026-03-21 — ARCH-06 initial design by Jorven*
