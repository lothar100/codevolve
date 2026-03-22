# REVIEW-06: ARCH-05 (Vector Search) + ARCH-06 (Execution Sandbox)

**Reviewer:** Iris
**Date:** 2026-03-21
**Scope:** Architecture review of Phase 2 design documents. This review gates IMPL-05, IMPL-06, and IMPL-07.
**Documents reviewed:**
- `docs/vector-search.md` (ARCH-05)
- `docs/execution-sandbox.md` (ARCH-06)
- `docs/decisions.md` (ADR-005, ADR-006)
- `docs/dynamo-schemas.md` (cache table schema, skills table schema)
- `docs/api.md` (POST /resolve, POST /execute contracts)
- `CLAUDE.md` (key design rules)

---

## Overall Verdict: APPROVED WITH NOTES

Both documents are high quality. They are specific enough for direct implementation, internally consistent in almost all areas, and well-grounded in prior ADRs. There are no auto-reject violations. There are two critical issues that must be resolved before implementation begins: a contract conflict between ARCH-05 and `api.md` on the `/resolve` no-match response code, and a correctness bug in the canonical JSON algorithm specified in ARCH-06. Both are resolvable with small, targeted changes to the documents (not to existing code).

Non-critical issues are minor and can be addressed during implementation.

---

## ARCH-05 — Vector Search

### Check 1: Embedding fields

The chosen fields (`name`, `description`, `domain`, `tags`) are the right fields. They capture the semantic identity of a skill — what it does and where it fits — without including implementation noise (`implementation`, `tests`, `examples`). Excluding code text from the embedding is correct: code syntax degrades the quality of text embeddings for intent-matching purposes. Excluding `inputs`/`outputs` is also correct; those are structural metadata, not semantic descriptors.

The concatenation format (`{name}. {description} domain:{domain tokens} tags:{tag tokens}`) is precise and unambiguous. The example in §2.1 is clear and easy to implement mechanically. The rule for empty `domain`/`tags` (omit the prefix entirely) is explicitly stated.

The 8,192-character truncation rule is a safe approximation given Titan v2's token limit. The policy to truncate `description` first (preserving `name`, `domain`, `tags`) is the right priority order.

**Result: Pass.**

### Check 2: Bedrock model specification

`amazon.titan-embed-text-v2:0` is the correct model ID for AWS Bedrock Titan Embed Text v2. The request body format `{ "inputText": "<string>", "dimensions": 1024, "normalize": true }` matches the Bedrock InvokeModel API for this model. The 1024-dimension setting is valid (Titan v2 supports 256, 512, and 1024 dimensions). The `"normalize": true` parameter is a real, documented field for this model.

The service endpoint `bedrock-runtime.us-east-2.amazonaws.com` is consistent with the project's AWS region (us-east-2).

**Result: Pass.**

### Check 3: Cosine similarity — dot product on L2-normalized vectors

The claim is mathematically correct. For unit vectors (L2-normalized, `|A| = |B| = 1`), `cos(A,B) = A·B / (|A| |B|) = A·B`. The dot product loop in §4.1 is the correct implementation of this.

`Float32Array` is a meaningful optimization in a Node Lambda at 5,000 skills: 1024 × 5,000 elements at 4 bytes/element is ~20 MB for the full corpus versus ~40 MB for `number[]` (8 bytes/element, V8 doubles). The memory savings are real. The document correctly notes that Float32Array enables potential SIMD optimization in future V8 versions, though this is speculative for current Node 22.

The clamp `Math.min(1.0, Math.max(-1.0, dot))` is a correct floating-point safety guard.

**Result: Pass.**

### Check 4: DynamoDB scan — archived exclusion and ProjectionExpression

The FilterExpression in §7.2 is correct:

```
attribute_exists(embedding) AND #st <> :archived
```

With `ExpressionAttributeNames: { "#st": "status" }`. The alias `#st` is necessary because `status` is a DynamoDB reserved word. The document explicitly flags this and prescribes `#st`, which is unambiguous.

`attribute_exists(embedding)` correctly guards against skills whose Bedrock call failed at create time (embedding is null). Without this guard, a null embedding would cause a runtime exception during `Float32Array` construction in the similarity loop.

The `ProjectionExpression` in §3.3 step 3 excludes `implementation`, `tests`, and `examples`. This is the correct set to exclude — they are the three largest fields on a skill item. The projected fields (`skill_id`, `version_number`, `name`, `description`, `language`, `status`, `is_canonical`, `confidence`, `domain`, `tags`, `embedding`) are exactly what the similarity computation and response building require.

The pagination loop instruction (`loop using LastEvaluatedKey until exhausted`) is correctly specified in §3.3 step 4.

**Result: Pass.**

### Check 5: Boost logic

The boost values (+0.05/tag, +0.10/domain, cap +0.20) are reasonable. The domain boost being twice the tag boost reflects that domain is a more precise semantic classifier than a tag. The cap at +0.20 prevents boost from dominating the similarity score (a raw cosine score of 0.50 with maximum boost reaches 0.70 — exactly at threshold, which is appropriate: only skills with both reasonable semantic similarity AND good metadata match get promoted above threshold).

The implementation in §4.2 uses `Set` for O(1) lookup on skill tags/domains, which is correct. String comparison is exact (case-sensitive), with the responsibility for normalization placed on the caller. This is consistent with the general pattern in the API (tags and domains are stored as submitted; normalization is a caller concern).

**Result: Pass.**

### Check 6: Threshold and min_confidence handling

The 0.70 threshold is consistent with `CLAUDE.md` (`Confidence threshold < 0.7 always triggers /evolve`) and with the `/resolve` response schema in `api.md` (`evolve_triggered: boolean, true if resolve_confidence < 0.7`).

The `min_confidence` override is correctly handled: `Math.max(0.70, request.min_confidence)`. This prevents callers from bypassing the system floor by passing `min_confidence: 0`. The document is explicit about this: "callers cannot lower the system threshold below 0.70."

**Result: Pass.**

### Check 7: Latency claim — p95 < 500ms at 5K skills

The component budget in §5.1 is credible:

- Bedrock ~50ms p50 / ~100ms p95 — consistent with observed Bedrock embed latency from Lambda in the same region.
- DynamoDB scan of 5K skills with 10 KB embedding each ≈ 50 MB total — this is a meaningful network transfer. The estimate of 80–150ms p50 for a paginated scan of 50 MB of data is plausible but slightly optimistic. DynamoDB scan throughput is measured in read capacity units (each RCU = 4 KB; scanning 50 MB requires ~12,800 RCU). On-demand tables have burst capacity, but this volume of data in 2–5 paginated calls over ~100ms is achievable in practice.
- Cosine similarity loop: 5K × 1024 dot products = ~5M multiplications. The estimate of ~50ms is plausible for V8-JIT compiled Float32Array operations; empirical measurement of ~10ms per 1K skills is the right basis.
- Total p50 ~220ms, p95 ~400ms — with 100ms headroom to the 500ms target.

The latency math holds. The 500ms p95 target is labeled correctly as conservative (the document's own estimate is ~400ms p95). The 100ms post-OpenSearch migration SLO is clearly distinguished and not confused with the Phase 2 target.

**Result: Pass.**

### Check 8: Error handling — 503 on Bedrock failure, fire-and-forget Kinesis

The error handling table in §7.3 is complete and correctly specified:
- 4xx from Bedrock → 503 `EMBEDDING_ERROR`. Correct: a Bedrock client error is not a caller error.
- 5xx or timeout → 503 `EMBEDDING_ERROR`. Correct.
- Throttling (429) → retry once with 200ms backoff, then 503 `EMBEDDING_THROTTLED`. The single retry with 200ms is a reasonable and minimal policy for Bedrock throttles.
- Empty scan → 404 `NO_MATCH`. Correct.
- DynamoDB timeout → 503 `DB_SCAN_ERROR`. Correct.

Kinesis emission in §7.4 is specified as fire-and-forget: "Do not await; do not let Kinesis failure block the response." This matches the established pattern from Phase 1.

**CRITICAL ISSUE C-01 — /resolve no-match response code conflicts with api.md.** Section 4.4 specifies returning HTTP **404** with code `NO_MATCH` when top confidence < 0.70. However, `docs/api.md` (POST /resolve, Errors section) does not list 404 as a valid response for `/resolve`. The `api.md` response schema states: "An empty result set is NOT an error. Returns `{ matches: [], best_match: null, resolve_confidence: 0, evolve_triggered: true }`" — which implies a **200** with an empty result. These two documents contradict each other. This is a blocking ambiguity: Ada cannot implement both specifications simultaneously.

The `api.md` contract is the authoritative API surface. Returning 404 for a no-match resolve breaks callers that expect 200 with `best_match: null` (which is how `api.md` documents the empty case). See Critical Issues section.

### Check 9: ADR-005 supersession

ADR-005 correctly supersedes ADR-004's "p95 < 100ms migration trigger" and replaces it with (a) a 5,000-skill count trigger and (b) a 500ms Phase 2 p95 target. The rationale is well-reasoned: count-based triggers are operationally predictable and do not depend on sustained traffic measurement.

ADR-005 does not conflict with ADR-003 (cache) or ADR-001 (tech stack) — it extends ADR-004 only. The instruction "Quimby should not modify ADR-004 retroactively" is consistent with the ADR policy in `decisions.md` ("Never remove or modify past ADRs").

**Result: Pass.**

### Check 10: Implementation readiness for IMPL-05

With the exception of C-01 (the 404 vs 200 conflict on no-match), the document is implementation-ready. §7 provides precise file locations, DynamoDB expressions with the exact `ExpressionAttributeNames` needed, the full similarity algorithm, the full boost algorithm, the Kinesis event shape, and nine specific test cases. Ada would not need to make architectural decisions to implement this; the only decision is translating the spec to code.

C-01 must be resolved before implementation begins.

---

## ARCH-06 — Execution Sandbox

### Check 1: Lambda-per-language naming and statelessness

The runner naming convention is clear and unambiguous:

| Language | Function name |
|----------|--------------|
| `python` | `codevolve-runner-python312` |
| `javascript` | `codevolve-runner-node22` |

The naming includes the runtime version, which is correct and future-proof (when Python 3.14 replaces 3.12, a new function name makes the change explicit).

Statelessness is enforced by design: no DynamoDB access, no S3, no network egress, and no persistent `/tmp` guarantee between invocations. The document correctly notes that Lambda execution contexts may be reused but skill code is re-evaluated per invocation (§2.2). The IAM execution role (CloudWatch Logs only, explicit deny all other services) is the operative isolation mechanism.

**Result: Pass.**

### Check 2: Canonical JSON algorithm correctness

**CRITICAL ISSUE C-02 — canonicalJson recursion is incomplete.** The implementation in §3 is:

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
```

The `JSON.stringify` replacer function sorts the keys of each nested object it encounters. However, it reduces the values (`v[k]`) without recursing — those values are plain JavaScript values at the time the replacer sees them, not yet sorted objects. This works for two levels of nesting (the outer `sorted` construction handles level 1; the replacer handles level 2) but fails at level 3+.

Example: for `{ "a": { "b": { "z": 1, "y": 2 } } }`, the replacer sees `{ "b": { "z": 1, "y": 2 } }` and returns a new object with sorted keys — but `b`'s value `{ "z": 1, "y": 2 }` is left unsorted. The replacer will be called again with `{ "z": 1, "y": 2 }`, but by that point the value reference was already captured in the reduce without sorting.

Actually, `JSON.stringify` with a replacer calls the replacer recursively for every key/value pair in depth-first order. The replacer as written does sort each nested object it encounters before JSON.stringify descends into it. On closer analysis: the replacer returns a new object with sorted keys, and `JSON.stringify` will then call the replacer on each value of that sorted object. This should work recursively because `JSON.stringify` walks the replacer-returned object's properties in insertion order, and the replacer returned them sorted. However, the values `v[k]` are passed unsorted into the new object before the replacer is called on them — the replacer will be called on `v[k]` itself when `JSON.stringify` descends, sorting it at that level. So the recursion works correctly through the replacer mechanism.

**Revised assessment:** On careful re-reading, the replacer approach does correctly sort keys at all nesting levels because `JSON.stringify` calls the replacer on every node in the tree, including nested objects that the previous replacer call added to the output. The algorithm is correct for plain objects.

However, there is a different subtle issue: the initial `sorted` construction at the top-level sorts keys and copies values, but those values are not recursed into by the constructor — they remain as-is. The first call to the replacer for the root object receives the already-sorted `sorted` object and returns it sorted again (no-op at root since it's already sorted). The replacer then descends into each value. If a value is a nested object, the replacer sorts its keys. This is correct.

**Revised result:** The algorithm is functionally correct for nested plain objects. The concern about recursion depth does not apply. However, the implementation is subtle enough that a junior engineer reading it might not immediately understand why it works at depth 3+. A clear comment explaining that `JSON.stringify`'s replacer is called recursively for all nodes would help.

**Downgrade C-02 to WARNING W-01.** The algorithm is correct but non-obviously so. The spec should include a comment or a test case demonstrating correctness at depth 3 nesting.

**Result: Warning issued (see W-01). Not blocking.**

### Check 3: Cache key structure

The cache key specification in §8.1 matches `docs/dynamo-schemas.md` §3 exactly:
- PK: `skill_id` (S)
- SK: `input_hash` (S, SHA-256 hex)

**WARNING — N-NEW-01 was resolved in REVIEW-FIX-05 but ARCH-06 has not been updated.** Per REVIEW-FIX-05, `docs/dynamo-schemas.md` was updated: the cache table field is now `version_number` (N, integer), not `skill_version` (S, semver string). ARCH-06 §8.1 still instructs Ada to use `skill_version` (string, version_label) and to "not change the field type without a schema update from Jorven" — but that schema update has already been made. ARCH-06 §5's cache write PutItem block also uses `skill_version (S)`.

These sections of ARCH-06 are stale. Ada implementing IMPL-07 from this document will write the wrong field name and type. Jorven must update ARCH-06 §8.1 and §5 to use `version_number (N)` before IMPL-07 is implemented.

This is a non-critical issue (the fix is a one-line change in two places) but Ada must not implement from the stale spec. See Non-Critical Issues W-04 below.

**Result: Conditional pass — ARCH-06 §8.1 and §5 must be updated before IMPL-07 begins.**

### Check 4: auto_cache flag and Decision Engine pattern

The `auto_cache` flag pattern is clearly specified: a boolean attribute set by the Decision Engine on the skill record; `/execute` checks it and conditionally writes to cache after a successful miss. The alternative (Decision Engine pre-populating the cache directly) is also mentioned in `dynamo-schemas.md` §3 access patterns.

The two-mechanism design (Decision Engine pre-populates AND sets `auto_cache` for future `/execute` writes) is consistent with the cache schema's access patterns. The instruction to not write on every successful miss (§5) is explicitly motivated ("avoids unnecessary write costs on low-repeat skills"). This is consistent with `CLAUDE.md`'s automated decision rule and `api.md`'s note that "cache writes do not happen on every successful execution."

**Result: Pass.**

### Check 5: Error taxonomy — 408/504/422 status codes

| Error type | HTTP status | Code |
|-----------|-------------|------|
| `validation` | 422 | `EXECUTION_FAILED` |
| `runtime` | 422 | `EXECUTION_FAILED` |
| `timeout` | 408 | `EXECUTION_TIMEOUT` |
| `oom` | 504 | `EXECUTION_OOM` |

408 for timeout is correct and matches `api.md`. 422 for both `validation` and `runtime` is correct and matches `api.md` (`EXECUTION_FAILED`). The distinction between the two at the `error_type` level (not the HTTP level) is the right call — they have different remediation paths (caller fixes input vs. skill requires improvement), so keeping them distinguishable matters, but they share the same HTTP semantic (unprocessable).

504 for OOM is a reasonable and defensible choice. OOM represents a gateway-level failure (the execution environment ran out of resource), not a client error. The document correctly notes that `504 EXECUTION_OOM` is a new code not in the original `api.md` contract and requires Ada to add it to `docs/api.md` as part of IMPL-06 delivery. This instruction is clear.

The doc also notes a self-contradiction in §4 that should be clarified: the "Note on HTTP status for OOM" says "both result in the execution not completing — they map to 504 at the HTTP level," which reads as if timeout also maps to 504. But the taxonomy table correctly shows timeout as 408. This is a prose clarity issue only — the table is authoritative. See W-02.

**Result: Pass (with prose clarification needed, see W-02).**

### Check 6: Timeout clamping logic

From §4: "If `timeout_ms` < 10,000, the effective timeout is `timeout_ms`. If `timeout_ms` > 10,000, the effective timeout is 10,000."

This is correctly specified. The `api.md` ExecuteRequest schema allows `timeout_ms` up to 300,000ms, so values above 10,000 are expected and the clamping behavior must be explicitly documented. The document does document it and notes the API ceiling should be surfaced in the response (or as a warning field). The Phase 2 constraint is well-flagged as intentional.

**Result: Pass.**

### Check 7: IPC — InvokeCommand with RequestResponse

`InvokeCommand` with `InvocationType: "RequestResponse"` is the correct choice for synchronous Lambda invocation. `RequestResponse` blocks the calling Lambda until the invoked Lambda returns or times out. `Event` (async) and `DryRun` are the alternatives — both would be wrong here.

The payload encoding in §8.3 is correct: `Buffer.from(JSON.stringify(runnerPayload), 'utf8')` produces a `Uint8Array` that the SDK transmits correctly. The decode `Buffer.from(invokeResponse.Payload).toString('utf8')` is the correct reverse. The note that the SDK handles transport encoding (no manual base64 needed) is accurate.

The `FunctionError` field inspection is correct: Lambda sets `FunctionError: "Unhandled"` on timeout and unhandled exceptions. This is the right way to detect runner-level failures vs. normal returns.

The 11-second timeout on the `InvokeCommand` call (§4, Table row: "`/execute` Lambda wait") is correctly specified as 11 seconds (1 second above the runner's 10-second hard limit), which ensures the orchestration Lambda catches both a clean runner timeout response and a Lambda service-level termination.

**Result: Pass.**

### Check 8: Cache invalidation ownership

Two invalidation scenarios:

1. **New version written:** Owned by the DynamoDB Streams consumer on `codevolve-skills`. When a new `version_number` is written, the stream consumer queries cache by `skill_id` and deletes entries where `skill_version` does not match the new version. This is the correct owner — the `/execute` Lambda should not be performing cross-table cleanup.

2. **Skill archived:** Owned by the archive handler Lambda. Already specified in `docs/archive-design.md`. The `/execute` Lambda's only responsibility is returning 404 for archived skills (it never reaches cache for them).

Both scenarios are clearly owned. The `/execute` Lambda is correctly excluded from cache invalidation responsibility.

**Result: Pass.**

### Check 9: ADR-006 trade-offs

The ADR is well-reasoned. The three options (Lambda-per-language, ECS Fargate, Lambda container images) are assessed honestly across cold start, ops overhead, per-execution cost, and language addition path. The selected option (Lambda-per-language) is the correct choice for Phase 2 for the stated reasons.

The accepted trade-offs are documented with honesty:
- `new Function(...)` does not provide V8-level heap isolation. The 10-second Lambda timeout is the operative safety net for runaway CPU. This is accurate.
- No process-level isolation (seccomp, cgroups). Acceptable for a controlled Phase 2 registry.
- Lambda concurrency limits with reserved concurrency as mitigation.

The note about Phase 5 WASM/Firecracker evaluation is appropriately deferred.

**Result: Pass.**

### Check 10: Implementation readiness for IMPL-06/IMPL-07

With C-02 downgraded to W-01, and pending the prose clarification in W-02, the document is implementation-ready. §8 provides:
- Exact DynamoDB key structures with TypeScript code
- Exact Lambda invocation call with SDK imports and payload encoding
- File responsibility table for every new source file
- CDK construct table with function names, runtimes, memory, timeouts, and IAM grants
- Python and Node runner handler patterns
- Execution count and latency update formulas
- Kinesis event shape

Ada would not need to make architectural decisions to implement this.

---

## Security Check — ARCH-05

- **Input validation:** Pass. §7 opens with "Validate request (Zod schema)" as step 1. The `ResolveRequest` schema in `api.md` is the reference schema. The handler must not proceed past step 1 if validation fails.
- **DynamoDB safety:** Pass. FilterExpression uses parameterized `ExpressionAttributeValues`. No string concatenation in queries.
- **Sandbox integrity:** N/A — `/resolve` does not execute user code.
- **Error response safety:** Pass. Error responses in §7.3 return fixed codes (`EMBEDDING_ERROR`, `NO_MATCH`, `DB_SCAN_ERROR`). The `details` object in the `NO_MATCH` response includes `highest_score` and `intent` — the intent field is a verbatim echo of the caller's own input and is not a leak. `highest_score` is a float, not an internal system detail.

## Security Check — ARCH-06

- **Input validation:** Pass. Step 1 of the execute flow is Zod validation. Step 3 validates inputs against the skill's input schema.
- **DynamoDB safety:** Pass. All DynamoDB calls in §8.1/§8.5 use parameterized expressions.
- **Sandbox integrity:** Conditional pass. The IAM deny-all on runner Lambdas and the no-VPC deployment are the correct isolation mechanisms for Phase 2. The `new Function(...)` approach in the Node runner and `exec()` in the Python runner do not provide process isolation but this is acknowledged, accepted, and bounded by IAM and Lambda environment constraints. Flag for Phase 4 reassessment when public contributions are considered (as noted in ADR-006).
- **Error response safety:** Warning. The `details.error_detail` field in §6 includes the exception message and "top of the stack trace" for `runtime` errors. Stack traces from skill implementations may contain system paths, dependency names, or internal logic details. This was flagged as an ongoing observation in REVIEW-05's memory entry. The spec should clarify that stack traces are truncated (e.g., top 5 lines maximum) and stripped of file system paths before inclusion in the API response. See W-03.

---

## Critical Issues (blocking IMPL-05/06/07)

**C-01 — ARCH-05 §4.4 specifies HTTP 404 for no-match; api.md specifies HTTP 200**

**File:** `docs/vector-search.md` §4.4, cross-referenced against `docs/api.md` POST /resolve

**Detail:** `docs/vector-search.md` §4.4 states:

> "Top candidate confidence < 0.70 OR no candidates → Return 404. Body: `{ error: { code: "NO_MATCH", ... } }`. Trigger /evolve asynchronously."

`docs/api.md` POST /resolve states:

> "An empty result set is NOT an error. Returns `{ matches: [], best_match: null, resolve_confidence: 0, evolve_triggered: true }`"

And the Errors table for `/resolve` does not list 404 as a valid response code.

These two specifications directly contradict each other. The `api.md` contract is the authoritative public API surface. An agent caller implementing to the `api.md` spec will not handle a 404 response, since the spec guarantees a 200 for zero-match resolves.

Additionally, the `ResolveResponse` zod schema in `api.md` already has `evolve_triggered: boolean` and `best_match: ResolveMatch.nullable()` — these fields exist precisely to communicate the no-match case over a 200 response.

**Required fix before IMPL-05:** One of the two documents must be updated to match the other. The recommendation is to update `docs/vector-search.md` §4.4 to return HTTP 200 with the `api.md`-specified empty response shape, not HTTP 404. The `evolve_triggered: true` and `resolve_confidence: 0` fields on the 200 response already communicate the no-match signal to callers without changing the HTTP contract.

If Jorven intends a 404 to be the correct behavior, `docs/api.md` must be updated to document it as a valid response code for this endpoint, and the client-facing contract must be explicitly changed. A decision either way requires Jorven to update the relevant document and this review to be re-submitted for confirmation.

---

## Non-Critical Issues / Suggestions

**W-01 — canonicalJson recursion is non-obviously correct; add comment and depth-3 test**

**File:** `docs/execution-sandbox.md` §3 (Canonical JSON algorithm)

**Detail:** The `JSON.stringify` replacer-based implementation correctly sorts keys at all nesting depths because `JSON.stringify` calls the replacer recursively on every node in the object graph. However, this property is non-obvious — a reader unfamiliar with the replacer traversal model might believe the sort only applies to the first level seen by the replacer call. A comment stating "JSON.stringify calls this replacer recursively for all nested objects" and a test case with a depth-3 input (e.g., `{ b: { d: { z: 1, y: 2 }, c: 3 }, a: 1 }`) would make the correctness property explicit and prevent future contributors from "fixing" it incorrectly.

**Severity:** Warning (correctness concern resolved on analysis, but documentation gap remains).
**Must fix before IMPL-06:** No. But Ada should add the depth-3 test in `tests/unit/execution/inputHash.test.ts`.

---

**W-02 — Prose contradiction on OOM HTTP status in §4**

**File:** `docs/execution-sandbox.md` §4 (Note on HTTP status for OOM)

**Detail:** The note reads: "For OOM and timeout, both result in the execution not completing — they map to 504 at the HTTP level based on the error taxonomy." The phrase "OOM and timeout...both...map to 504" is incorrect — timeout maps to 408, not 504. Only OOM maps to 504. The error taxonomy table directly below this note is authoritative and correct (408 timeout, 504 OOM). The prose note is misleading and should be updated to say "OOM maps to 504; timeout maps to 408."

**Severity:** Warning (no implementation impact; taxonomy table is authoritative).
**Must fix before IMPL-06:** No, but the document should be corrected to avoid confusing Ada.

---

**W-03 — Stack trace exposure in error_detail field**

**File:** `docs/execution-sandbox.md` §6 (Error Response Shape)

**Detail:** The spec includes `"error_detail": "ZeroDivisionError: division by zero\n  at line 12 in solution"` as an example. For `runtime` errors, the spec says "the exception message and (where safe to expose) the top of the stack trace." The qualifier "where safe to expose" is undefined — it is left to Ada's judgment. Stack traces from skill implementations may leak file system paths (e.g., `/var/task/handler.py:12`), installed package versions, or internal Lambda execution context details.

This was flagged as an ongoing observation in REVIEW-05 memory.

**Required before IMPL-06:** The spec must define a concrete stack trace sanitization policy: maximum lines (e.g., top 3), path stripping (remove absolute file paths from stack frames), and exclusion of Lambda runtime internal frames (`/var/runtime/`, `bootstrap`).

---

**N-01 — ARCH-05 §2.2 embedding write is synchronous on create; 201 response is blocked by Bedrock latency**

**File:** `docs/vector-search.md` §2.2

**Detail:** The spec states "The `POST /skills` handler must not return 201 until the embedding is written to DynamoDB." This adds Bedrock embed latency (~50ms p50) plus a DynamoDB UpdateItem (~5ms) to every skill create response. At p95, this adds ~100ms to the create path. This is a deliberate trade-off (the document explains that skills without embeddings do not appear in `/resolve`), and it is correctly documented. No action required — this is an observation for Ada to be aware of when writing the create handler latency SLO.

**Severity:** Suggestion (no action required; noted for implementation awareness).

---

**N-02 — ARCH-06 §8.5 latency EMA formula uses different alpha for p95 vs p50 with no justification**

**File:** `docs/execution-sandbox.md` §8.5

**Detail:** The Phase 2 EMA formula uses alpha=0.1 for p50 (`new_p50 = 0.9 * existing + 0.1 * new`) but alpha=0.3 for p95 when the new value exceeds the existing estimate (`new_p95 = 0.7 * existing + 0.3 * new`). The asymmetric alpha for p95 is described as a "proxy" — the intent is to react more quickly to latency spikes. This is a reasonable approximation, but the condition "if `latency_ms > existing_p95`" means the p95 estimate only moves upward quickly, never downward. A skill whose latency improves will have its p95 estimate decay very slowly (alpha=0.1). The document calls this "explicitly a Phase 2 approximation," which is an appropriate qualification. No blocking issue.

**Severity:** Suggestion (acknowledged approximation; acceptable for Phase 2).

---

**N-03 — ARCH-05 §7.4 latency_ms measurement excludes Kinesis write time but Kinesis is fire-and-forget**

**File:** `docs/vector-search.md` §7.4

**Detail:** The spec says `latency_ms` should be measured "before serialization" and must "not include time spent in the Kinesis PutRecord call." Since Kinesis is fire-and-forget (not awaited), its call time is not included in the response latency anyway. The instruction is vacuously true as written. No implementation risk, but the note could be clearer: "latency_ms is the wall-clock time from handler entry to response assembly; the Kinesis write is non-blocking and excluded by design."

**Severity:** Suggestion (clarity only).

---

**W-04 — ARCH-06 §8.1 and §5 reference the stale skill_version (S) field — N-NEW-01 was resolved in REVIEW-FIX-05**

**File:** `docs/execution-sandbox.md` §5 (Cache Write PutItem), §8.1 (Note on skill_version)

**Detail:** REVIEW-FIX-05 updated `docs/dynamo-schemas.md` to rename the cache table field from `skill_version (S, semver string)` to `version_number (N, integer)`. ARCH-06 §8.1 still instructs Ada to use `skill_version (S, version_label)` and defers the fix to Jorven — but Jorven already made it. ARCH-06 §5's PutItem spec still writes `skill_version (S)`. If Ada implements IMPL-07 directly from this document, the cache table will be written with the wrong field name and type.

**Required fix before IMPL-07:** Jorven must update ARCH-06 §5 and §8.1 to use `version_number (N)`. The ARCH-06 §8.1 note about N-NEW-01 being open should be removed and replaced with "N-NEW-01 resolved in REVIEW-FIX-05."

**Severity:** Must fix before IMPL-07 begins (not before IMPL-06, which does not write the `version_number` field in isolation).

---

**N-04 — ARCH-06 does not specify reserved concurrency value for runner Lambdas**

**File:** `docs/execution-sandbox.md` §8.8 CDK Constructs table

**Detail:** ADR-006 states "Mitigated by setting reserved concurrency on runner Lambdas and returning 429 when throttled." The implementation notes in §8.8 do not specify what reserved concurrency value to use, nor the Lambda response when throttled (Lambda throttle returns an HTTP 429 at the `InvokeCommand` level, which the `/execute` handler must translate to an HTTP 429 for the API caller). This is a gap that Ada will need to decide during implementation. The CDK construct table should include a `Reserved concurrency` column with a placeholder value (e.g., 10) and the expected behavior when throttled.

**Severity:** Non-critical (Ada can make a reasonable default, but the gap means implementation may differ from design intent).

---

## Notes for Ada and Jorven

1. **C-01 is the only blocker for IMPL-05.** Jorven must decide: does `/resolve` return 200 with empty result on no-match (as `api.md` specifies) or 404 (as `vector-search.md` §4.4 specifies)? The `api.md` contract and the `ResolveResponse` schema already accommodate the 200 path cleanly (`best_match: null`, `evolve_triggered: true`). The 404 path would require updating `api.md`'s error table and all client documentation.

2. **W-03 (stack trace sanitization) must be resolved before IMPL-06 ships.** The `details.error_detail` field reaches agents via the API. Leaking Lambda execution paths or runtime internals is an unnecessary information exposure. Jorven should update `docs/execution-sandbox.md` §6 with a concrete sanitization rule; Ada implements the sanitizer.

3. **N-NEW-01 (skill_version type mismatch) — RESOLVED.** Per REVIEW-FIX-05, `docs/dynamo-schemas.md` was updated to rename the cache table field to `version_number` (N type). ARCH-06 §8.1 references `skill_version` (S, version_label) based on the prior schema state and is now out of date. Ada should use the current `dynamo-schemas.md` §3 as the authoritative reference for the cache table schema — specifically, `version_number` (N, integer) is the correct field name and type, not `skill_version` (S, version_label). The note in ARCH-06 §8.1 about N-NEW-01 being "open" is stale. Jorven should update ARCH-06 §8.1 and §5 (Cache Write PutItem spec) to reflect the resolved schema before IMPL-07 is submitted.

4. **IMPL-07 (cache layer) may be implemented in parallel with IMPL-06 (execute handler) since the cache module is isolated.** The file responsibility split in §8.7 supports this parallelism: `src/cache/cache.ts` has no dependency on `src/execution/execute.ts`.

5. **The Node 22 runner uses `new Function(...)`.** This is explicitly acknowledged in ADR-006 as providing no V8-level heap isolation. Ada must not attempt to "improve" this by adding `vm.runInNewContext` in IMPL-06 — that change would require a new ADR if desired in Phase 4.

---

## Resolution Notes

**Date resolved:** 2026-03-21
**Resolved by:** Jorven

**C-01 — RESOLVED.**
`docs/vector-search.md` §4.4 updated to match `docs/api.md`. The no-match and below-threshold cases now both return HTTP 200 with `best_match: null`, `resolve_confidence: <highest_score or 0>`, and `evolve_triggered: true`. HTTP 404 is explicitly documented as never valid for a no-match resolve result. Consistent fixes were applied to the §1 overview flow diagram, the §7.3 error handling table (DynamoDB empty scan row and all-below-threshold row), and the §7.6 test case 2.

**W-02 — RESOLVED.**
`docs/execution-sandbox.md` §4 "Note on HTTP status for OOM" corrected. The prose now reads: "OOM maps to 504 and timeout maps to 408." The earlier incorrect claim that both map to 504 has been removed.

**W-03 — RESOLVED.**
`docs/execution-sandbox.md` §6 now includes a "Stack trace sanitization" sub-section specifying: maximum 5 stack frames, strip `/var/task/` and `/var/runtime/` path prefixes from all stack frame strings, strip absolute paths from error messages, remove Lambda runtime-internal frames entirely. Ada implements this sanitizer in the `/execute` Lambda with unit tests in `tests/unit/execution/`.

**W-04 — RESOLVED.**
`docs/execution-sandbox.md` §5 (Cache Write PutItem spec) and §8.1 (note on the field) updated. `skill_version (S)` replaced with `version_number (N)` throughout. The §8.1 note now states that N-NEW-01 was resolved in REVIEW-FIX-05 and instructs Ada to use `version_number` (integer, DynamoDB `N` type). The §5 cache invalidation description was also corrected to reference `version_number` comparisons rather than `skill_version`/`version_label` comparisons.
