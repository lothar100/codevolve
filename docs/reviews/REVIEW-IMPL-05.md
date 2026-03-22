# REVIEW-IMPL-05: /resolve Endpoint

**Reviewer:** Iris
**Date:** 2026-03-21
**Verdict:** Approved with notes

---

## Summary

The `/resolve` implementation is well-structured and broadly correct. All 14 tests pass,
`tsc --noEmit` exits 0, and every hard architectural constraint is satisfied: no LLM calls,
no HTTP 404 on no-match, correct 0.70 floor threshold, Float32Array throughout, DynamoDB
pagination handled, and the CDK construct matches the spec exactly (512 MB, 10s timeout,
`bedrock:InvokeModel` grant on `amazon.titan-embed-text-v2:0`).

Two issues are worth fixing before IMPL-05 is marked Complete, but neither is a blocking
hard-rule violation. They are documented below. There is one spec deviation (case-insensitive
boost matching) that I am elevating to a WARNING because it diverges from the written spec;
whether to keep it or revert it requires Jorven to decide and update the spec.

---

## Critical Issues

None found.

---

## Non-Critical Issues

### N-01 — Kinesis event not emitted on early-exit error paths

**File:** `src/router/resolve.ts` lines 150–154 (Bedrock failure) and 162–167 (DynamoDB failure)

**Spec reference:** `docs/vector-search.md` §7.4 states: "Every invocation of `POST /resolve`
— success OR failure — must emit a `resolve` event to Kinesis before returning."

The current implementation returns `503` on Bedrock failure and DynamoDB scan failure without
emitting a Kinesis event first. These are the two most operationally significant failures —
they are exactly the cases where analytics observability matters most.

**Impact:** The analytics pipeline has a blind spot on Bedrock throttling spikes and DynamoDB
outages. The Decision Engine (ARCH-07) cannot detect patterns in these failures, and the
resolve-performance dashboard (`latency_ms`, `success: false` records) will be missing
data for those invocations.

The fix is straightforward: extract a helper that emits a failure event and call it in both
error branches before the early return. The Kinesis call must remain fire-and-forget.

---

### N-02 — `computeBoost` uses case-insensitive comparison; spec mandates case-sensitive

**File:** `src/lib/similarity.ts` lines 36, 46–47, 52, 58

**Spec reference:** `docs/vector-search.md` §4.2 states: "Tag and domain comparison is
**exact string match (case-sensitive)**. The caller is responsible for normalizing
tags/domains to lowercase when submitting the request."

The implementation normalizes both request tags/domains and skill tags/domains to lowercase
before comparison. This makes the boost match `"Sorting"` against `"sorting"` when the spec
says it should not.

This is a divergence from the spec, not a bug in isolation — case-insensitive matching is
arguably a better user experience. However:

1. The spec explicitly delegates normalization responsibility to the caller.
2. If the skill registry stores `"Algorithms"` (capitalized from a contributor), and the
   system silently normalizes, two different callers could get different boost results
   depending on whether they send `"algorithms"` or `"Algorithms"`, and neither would be
   aware of the behavior.
3. The discrepancy will confuse future maintainers reading the spec.

**Required action:** Either (a) revert to case-sensitive matching to match the spec, or
(b) update `docs/vector-search.md` §4.2 to explicitly allow case-insensitive matching.
Jorven must adjudicate. Do not leave code and spec contradicting each other.

---

### N-03 — `emitEvent` is `await`-ed rather than truly fire-and-forget

**File:** `src/router/resolve.ts` lines 239–253

`emitEvent` internally swallows all exceptions, so `await`-ing it does not risk an uncaught
rejection and the handler will never crash. However, the `await` means the Lambda response
is held open until the Kinesis `PutRecord` call completes, adding ~10 ms to every response's
latency.

The spec says to emit "fire-and-forget (do not await; do not let Kinesis failure block the
response)." The spirit of the spec is that Kinesis latency should not be included in
`latency_ms`. Currently `latency_ms` is stamped before the `emitEvent` call (line 233), so
the measured value is correct. But the caller's actual wall-clock wait includes the Kinesis
round-trip.

The correct pattern is `void emitEvent(...)` (no `await`). This is a minor latency concern
— at 5,000 skills and ~10 ms Kinesis overhead it is not a compliance issue, but it should
be fixed to match spec intent before load testing begins.

---

## ARCH-07 Follow-Up Items (not blocking)

ARCH-07 (Decision Engine design) identified two additions that IMPL-05 should eventually include.
Neither is present in this implementation. Neither blocks approval — they are explicitly flagged
as follow-up work from ARCH-07.

**OI-01 — Gap-log write on `evolve_triggered: true`**
When `evolve_triggered` is `true`, the spec (ARCH-07) requires a fire-and-forget write to
the `codevolve-gap-log` DynamoDB table so the Decision Engine can read gaps on its next
scheduled run. This is not present. Track as a follow-up task to be added when the Decision
Engine table is provisioned in IMPL-10.

**OI-02 — `last_resolve_at` update on successful resolve**
When `best_match` is non-null, ARCH-07 specifies a fire-and-forget `UpdateItem` on the
`codevolve-problems` record for the matched skill's `problem_id`, setting `last_resolve_at`.
This is not present. Track as a follow-up task for IMPL-10 or alongside the gap-log work.

---

## Completion Gate Check

- [x] `tsc --noEmit` — exits 0 (confirmed)
- [x] `jest tests/unit/resolve/` — 14/14 pass (confirmed)
- [x] No LLM calls in resolve path — only `InvokeModelCommand` for embedding generation;
      no `InvokeAgent`, no Anthropic/OpenAI SDK usage anywhere in `src/router/` or `src/lib/`
- [x] No 404 returned for no-match — handler always returns 200 with `best_match: null`
      and `evolve_triggered: true` for below-threshold results

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. The handler is cleanly structured, reads top-to-bottom without cleverness, and all
variable names are accurate (`intentEmbedding`, `fetchCandidates`, `computeBoost`,
`effectiveThreshold`). The `ScoredCandidate` interface defined inline inside the handler
function is acceptable at this size but could move to the module level. The inline interface
definition at line 173–177 is a minor style point, not a problem.

**2. Is there a simpler solution?**

No. The implementation follows the spec exactly and avoids unnecessary abstraction. The
`fetchCandidates` helper is correctly extracted. The scoring loop is O(n) with a single
`Float32Array` construction per candidate, as specified.

**3. Are there unintended side effects?**

None. `resolveFn` has `grantReadData` on the skills table (not `grantReadWriteData`) — it
cannot write to DynamoDB. It writes only to Kinesis. No cross-table contamination.

**4. Are edge cases handled?**

Most are handled. Gaps:

- Bedrock failure and DynamoDB failure exit without emitting Kinesis events (N-01).
- All-null-embedding table returns `best_match: null`, `evolve_triggered: true` correctly.
- Empty `scored` array is safe — `slice(0, top_k)` on an empty array returns `[]`.
- `resolveConfidence` when `topMatches.length === 0` is correctly 0.
- Malformed JSON body handled (400).
- Missing `intent` field handled by Zod (400).

**5. Does the change follow the architectural plan?**

Yes, with the spec deviation noted in N-02. CDK construct matches spec:
512 MB memory, 10s timeout, `bedrock:InvokeModel` on `amazon.titan-embed-text-v2:0`,
`grantReadData` on skills table, `grantWrite` on Kinesis stream. The handler lives at
`src/router/resolve.ts` (spec says `src/handlers/resolve.ts` in §7.5, but `src/router/`
is the established project convention and is where the CDK expects it — this is a spec
documentation artifact, not a code problem).

---

## Security Check

- **Input validation:** PASS — Zod schema with `min(1).max(1000)` on `intent`,
  `min(1).max(20)` on `top_k`, `min(0).max(1)` on `min_confidence`.
- **DynamoDB safety:** PASS — `FilterExpression` uses parameterized `ExpressionAttributeValues`
  with `:archived` and `:lang`. No string concatenation. `ExpressionAttributeNames` used for
  all reserved words (`status`, `name`, `language`, `domain`).
- **Sandbox integrity:** N/A — no skill execution in this handler.
- **Error response safety:** PASS — `503` responses return only `code` and `message`; no
  stack traces, no DynamoDB table names, no internal paths are leaked to the caller. The
  `console.error` calls send to CloudWatch only.

---

## Notes for Ada and Jorven

- N-01 (missing Kinesis emit on error paths) should be fixed before this endpoint sees
  production traffic. The analytics blind spot on failure paths is the most operationally
  significant gap in this implementation.
- N-02 (case sensitivity) requires a spec decision from Jorven before Ada acts.
- N-03 (`void emitEvent(...)` vs `await`) is the smallest change — one word — and should
  be done alongside N-01.
- The file path discrepancy in `docs/vector-search.md` §7.5 (`src/handlers/resolve.ts`
  vs actual `src/router/resolve.ts`) should be corrected by Jorven in a docs update.
  It is a documentation artifact with no code impact.

---

## Re-review: N-01/N-02/N-03

**Reviewer:** Iris
**Date:** 2026-03-21
**Scope:** Targeted re-review of the three non-critical fixes applied by Ada after the original REVIEW-IMPL-05 verdict.

---

### N-01 — Kinesis event emitted on Bedrock failure AND DynamoDB scan failure: Verified

**Bedrock failure path** (`src/router/resolve.ts` lines 154–165):

`void emitEvent({...}).catch(...)` is present immediately before `return error(503, ...)`. The emitted payload contains exactly the fields mandated by spec §7.4:

- `event_type: "resolve"` — present
- `skill_id: null` — present
- `intent: req.intent` — present (uses the validated request value)
- `latency_ms: Date.now() - startMs` — present (uses `startMs` declared at line 110)
- `confidence: 0` — present
- `cache_hit: false` — present
- `input_hash: null` — present
- `success: false` — present

**DynamoDB scan failure path** (`src/router/resolve.ts` lines 178–189):

Identical structure. All eight §7.4 fields present with the same correct values. The `void ... .catch(...)` pattern is used in both branches — the emit is fire-and-forget with the error silently logged to CloudWatch via `console.warn`. Neither branch blocks on Kinesis or allows a Kinesis failure to prevent the 503 response from being returned.

Result: N-01 Verified.

---

### N-02 — `computeBoost` uses exact case-sensitive string matching: Verified

**`src/lib/similarity.ts`** (entire file reviewed):

- Line 48: `new Set(requestTags)` — raw strings, no `.toLowerCase()`.
- Line 49: `new Set(requestDomain)` — raw strings, no `.toLowerCase()`.
- Line 54: `requestTagSet.has(tag)` — direct Set lookup on the unmodified tag string.
- Line 60: `requestDomainSet.has(domain)` — direct Set lookup on the unmodified domain string.

No `.toLowerCase()` call appears anywhere in the file. The JSDoc comment on `computeBoost` (lines 36–38) explicitly states: "Comparison is exact string match (case-sensitive). The caller is responsible for normalizing tags/domains to lowercase when submitting the request. See docs/vector-search.md §4.2." Code and spec are now in agreement.

Result: N-02 Verified.

---

### N-03 — Success-path `emitEvent` is fire-and-forget: Verified

**`src/router/resolve.ts` lines 263–274**:

```
void emitEvent({
  event_type: "resolve",
  ...
}).catch((emitErr) =>
  console.warn("[resolve] emitEvent failed (swallowed):", emitErr),
);
```

No `await` keyword. The `void` operator discards the Promise, and `.catch(...)` is chained to ensure the unhandled-rejection path is also silenced. The `latencyMs` value (line 257) is stamped before this call, so Kinesis round-trip time is correctly excluded from the reported `latency_ms`. The Lambda response is no longer held open waiting for Kinesis to acknowledge.

Result: N-03 Verified.

---

### Overall Verdict: APPROVED

All three fixes are correctly implemented. The code matches the spec in all three dimensions examined. IMPL-05 may be marked Complete.
