# codeVolve — Vector Search Architecture

> Designed by Jorven (ARCH-05). Ada implements directly from this spec. Do not modify without a new ADR or an ARCH update.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Embedding Strategy](#2-embedding-strategy)
3. [DynamoDB Embedding Storage](#3-dynamodb-embedding-storage)
4. [Cosine Similarity in Lambda](#4-cosine-similarity-in-lambda)
5. [Latency Budget](#5-latency-budget)
6. [ADR-005 Summary](#6-adr-005-summary)
7. [Implementation Notes for IMPL-05](#7-implementation-notes-for-impl-05)

---

## 1. Overview

`POST /resolve` is the skill routing endpoint. A caller submits a natural-language `intent` (and optional filters: `language`, `domain`, `tags`). The system returns the best matching skill, or `null` if no skill scores above the threshold.

The routing mechanism is **client-side vector search**:

```
POST /resolve
     │
     ├── 1. Validate request (Zod schema)
     ├── 2. Call AWS Bedrock Titan Embed Text v2 on the intent string
     ├── 3. Scan codevolve-skills for non-archived skills
     │        (optional pre-filter by language via GSI-language-confidence
     │         if request includes language filter)
     ├── 4. For each candidate skill: compute cosine similarity between
     │        intent embedding and skill embedding
     ├── 5. Apply tag/domain boost to raw scores
     ├── 6. Rank by final score descending
     ├── 7. If top score >= 0.70, return matches
     │        else return 200 (best_match: null, evolve_triggered: true)
     └── 8. Emit resolve event to Kinesis
```

No LLM is invoked at query time. Bedrock is called only for the embedding generation step (step 2), which is a deterministic mathematical operation with no generation. Skill embeddings are pre-computed at write time.

This architecture is valid for the Phase 2 skill registry (up to ~5,000 skills). Migration to OpenSearch Serverless is triggered at 5,000 skills. See section 5 and ADR-005.

---

## 2. Embedding Strategy

### 2.1 Fields to Embed

The embedding captures the semantic identity of a skill. The following fields are concatenated into a single string at write time and passed to Bedrock:

| Field | Source | Included as |
|-------|--------|-------------|
| `name` | `codevolve-skills.name` | Plain text |
| `description` | `codevolve-skills.description` | Plain text |
| `domain` | `codevolve-skills.domain` (array) | Space-joined tokens |
| `tags` | `codevolve-skills.tags` (array) | Space-joined tokens |

**Concatenation format** (exact):

```
{name}. {description} domain:{domain[0]} {domain[1]} ... tags:{tags[0]} {tags[1]} ...
```

Example for a skill named "Binary Search" with description "Find element in sorted array using divide and conquer", domain `["searching", "arrays"]`, tags `["binary-search", "sorted", "divide-conquer"]`:

```
Binary Search. Find element in sorted array using divide and conquer domain:searching arrays tags:binary-search sorted divide-conquer
```

Rules:
- If `domain` is empty (should not occur per schema; domain has `min(1)`), omit the `domain:` prefix entirely.
- If `tags` is empty, omit the `tags:` prefix entirely.
- Strip all leading/trailing whitespace from each field before concatenation.
- Do not include `implementation` (code) in the embedding — code text degrades semantic quality for intent matching.
- Do not include `inputs` or `outputs` type definitions — these are structural, not semantic.
- Maximum concatenated string length: 8,192 characters. If the concatenated string exceeds this, truncate `description` first (preserve the rest). Titan Embed Text v2 accepts up to 8,192 tokens; truncating at 8,192 characters is a safe approximation.

### 2.2 When to Embed

| Operation | Trigger | Action |
|-----------|---------|--------|
| `POST /skills` (create) | After DynamoDB PutItem succeeds | Call Bedrock, store embedding on skill record via UpdateItem |
| `POST /skills/:id/unarchive` | After status is restored | Regenerate embedding via Bedrock, store via UpdateItem |
| `POST /resolve` (query) | On each request | Call Bedrock on the `intent` string; result is ephemeral (not stored) |
| `POST /skills/:id/archive` | After status set to `archived` | Set `embedding` attribute to null via UpdateItem |

Embedding generation at skill create time is a synchronous write-path step. The `POST /skills` handler must not return 201 until the embedding is written to DynamoDB. If Bedrock fails during create, the skill record is still written (embedding is null), and the handler returns 201 with a response header `X-Embedding-Status: failed`. Ada should note this failure in the Kinesis event for monitoring purposes. The skill will not appear in `/resolve` results until the embedding is populated.

> **Note on embedding update:** If a skill's `name`, `description`, `domain`, or `tags` are modified in the future (via a skill update endpoint, which is not in Phase 2), the embedding must be regenerated. This is a Phase 3+ concern — do not implement now.

### 2.3 Model

- **Model ID:** `amazon.titan-embed-text-v2:0`
- **Dimensions:** 1024
- **AWS Service:** Bedrock Runtime (`bedrock-runtime.us-east-2.amazonaws.com`)
- **API Call:** `InvokeModel` with body `{ "inputText": "<concatenated string>", "dimensions": 1024, "normalize": true }`

The `"normalize": true` parameter instructs Bedrock to return an L2-normalized vector. See section 2.4.

### 2.4 Normalization

All embedding vectors must be L2-normalized before storage and before cosine similarity computation.

**Why:** For L2-normalized vectors, cosine similarity simplifies to a dot product: `cos(A, B) = A · B` (since `|A| = |B| = 1`). This eliminates division and square root operations in the Lambda compute loop, reducing per-comparison cost from ~3,000 floating-point operations to ~1,024 (one dot product).

**How:** Pass `"normalize": true` in the Bedrock InvokeModel request body. Bedrock returns a pre-normalized vector. Do not apply any additional normalization in application code — the Bedrock-returned vector is already unit-length. Verify by asserting `|sum of squares - 1.0| < 1e-6` in tests.

**Stored format:** The 1024-element normalized float array is stored as-is in DynamoDB.

---

## 3. DynamoDB Embedding Storage

### 3.1 Attribute

Embeddings are stored on the `codevolve-skills` table as the `embedding` attribute.

| Attribute | DynamoDB Type | Value |
|-----------|---------------|-------|
| `embedding` | `L` (List of `N`) | 1024 floats, L2-normalized. Null when skill is archived. |

This attribute is already declared in `docs/dynamo-schemas.md` §2. No schema change is required for IMPL-05.

### 3.2 Size Considerations

- Each float in DynamoDB's `N` type is stored as a decimal string. A 6-decimal-place float like `-0.023451` occupies ~10 bytes in the wire format.
- 1024 elements × ~10 bytes = ~10 KB per embedding in DynamoDB item storage.
- DynamoDB item size limit: 400 KB. A full skill item with embedding occupies roughly 10–15 KB, well within limit.
- At 5,000 skills: 5,000 × 10 KB = ~50 MB of embedding data scanned per `/resolve` call.
- Lambda memory must be provisioned to hold this in-flight. Recommendation: 512 MB for the resolve Lambda.

### 3.3 Access Pattern for Resolve

**Phase 2 access pattern: DynamoDB Scan with optional pre-filter.**

Step-by-step:

1. If the request includes a `language` filter: Query `GSI-language-confidence` with `language = :lang` and `FilterExpression: attribute_exists(embedding) AND #status <> :archived`. This narrows the scan to a single language's skills.
2. If no `language` filter: Scan the full `codevolve-skills` table with `FilterExpression: attribute_exists(embedding) AND #status <> :archived`.
3. Use `ProjectionExpression` to return only: `skill_id`, `version_number`, `name`, `description`, `language`, `status`, `is_canonical`, `confidence`, `domain`, `tags`, `embedding`. Do not project `implementation`, `tests`, or `examples` — these fields are large and not needed for similarity ranking.
4. Handle DynamoDB pagination: Scan/Query results may be paginated if the result set is large. Loop using `LastEvaluatedKey` until exhausted. Collect all results before computing similarity.

### 3.4 Migration Path to OpenSearch

When the `/resolve` p95 latency exceeds 300ms (a leading indicator that the 500ms p95 budget is at risk), begin the OpenSearch migration process. The hard trigger is **5,000 active skills** in the registry.

Migration steps (to be designed in a future ARCH task):
1. Provision an OpenSearch Serverless collection with k-NN index.
2. Bulk-index all existing skill embeddings from DynamoDB into OpenSearch. The embedding format (1024-dimension float array) is directly compatible — no transformation needed.
3. Update the `/resolve` Lambda to query OpenSearch instead of scanning DynamoDB.
4. Retain DynamoDB embeddings (do not delete the `embedding` attribute) — they serve as the source of truth for re-indexing if needed.
5. New skills written during migration must be dual-written (DynamoDB + OpenSearch) until the migration is complete.

The tag/domain boost logic (section 4.2) and confidence formula (section 4.3) remain identical post-migration — only the candidate retrieval step changes.

---

## 4. Cosine Similarity in Lambda

### 4.1 Client-Side Computation

After loading all candidate skill embeddings from DynamoDB (section 3.3), the resolve Lambda performs similarity ranking in-memory.

**Algorithm:**

```typescript
// intent_vec: Float32Array of length 1024, L2-normalized (from Bedrock)
// skills: array of { skill_id, embedding: number[], name, description,
//                    language, status, is_canonical, confidence, domain, tags }

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // Both vectors are L2-normalized, so cosine similarity = dot product.
  let dot = 0;
  for (let i = 0; i < 1024; i++) {
    dot += a[i] * b[i];
  }
  return Math.min(1.0, Math.max(-1.0, dot)); // clamp for floating-point safety
}
```

Use `Float32Array` (not `number[]`) for both intent and skill embeddings during the compute loop. This reduces memory pressure: 1024 × 4 bytes = 4 KB per vector instead of 1024 × 8 bytes for a JavaScript `number[]`. Load skill embeddings from DynamoDB's `L(N)` attribute as `Float32Array` at parse time.

**Important:** Convert DynamoDB `L(N)` attribute to `Float32Array` once per skill during the initial parse step, before entering the similarity loop. Do not re-parse within the loop.

### 4.2 Tag and Domain Boost

After computing the raw cosine similarity score, apply a boost based on overlap between the request's `tags` and `domain` and the skill's `tags` and `domain`.

**Boost rules:**

| Match type | Boost per match | Cap |
|------------|-----------------|-----|
| Tag match (request tag appears in skill's `tags`) | +0.05 | — |
| Domain match (request domain appears in skill's `domain`) | +0.10 | — |
| Combined boost (all tag + domain boosts summed) | — | +0.20 maximum |

**Implementation:**

```typescript
function computeBoost(
  requestTags: string[],
  requestDomains: string[],
  skillTags: string[],
  skillDomains: string[]
): number {
  const skillTagSet = new Set(skillTags);
  const skillDomainSet = new Set(skillDomains);

  let boost = 0;
  for (const tag of requestTags) {
    if (skillTagSet.has(tag)) boost += 0.05;
  }
  for (const domain of requestDomains) {
    if (skillDomainSet.has(domain)) boost += 0.10;
  }
  return Math.min(boost, 0.20);
}
```

Tag and domain comparison is **exact string match** (case-sensitive). The caller is responsible for normalizing tags/domains to lowercase when submitting the request. The system does not perform fuzzy or case-insensitive matching.

If the request includes no `tags` and no `domain`, boost is 0 for all skills.

### 4.3 Confidence Formula

```
final_score = cosine_score + boost(tags, domains)
confidence  = Math.min(final_score, 1.0)
```

The `confidence` value on the `ResolveMatch` object is this capped value. The `similarity_score` field on `ResolveMatch` is the raw cosine similarity before boosting. Both fields are returned to the caller.

### 4.4 Threshold and Routing Decision

After ranking all candidates by `confidence` descending:

| Condition | Action |
|-----------|--------|
| Top candidate `confidence >= 0.70` | Return HTTP 200 with up to `top_k` matches. `best_match` = top candidate. `evolve_triggered = false`. |
| Top candidate `confidence < 0.70` OR no candidates | Return HTTP 200. Body: `{ matches: [], best_match: null, resolve_confidence: <highest_score or 0>, evolve_triggered: true }`. Trigger `/evolve` asynchronously. |

**Empty result set (zero skills with embeddings):** Treat as confidence = 0. Return HTTP 200 with `best_match: null`, `resolve_confidence: 0`, `evolve_triggered: true`.

**HTTP 404 is never returned for a no-match or below-threshold resolve result.** A no-match is not an error — it is a valid routing outcome that triggers the `/evolve` pipeline. HTTP 404 is reserved for skill-not-found-by-ID operations (e.g. `GET /skills/:id`). See `docs/api.md` POST /resolve: "An empty result set is NOT an error."

**`/evolve` async trigger:** Do not await the evolve enqueue. Emit the Kinesis event for the `/evolve` request after the resolve response has been sent (or fire it concurrently without blocking). The resolve handler must not fail if the evolve enqueue fails — log the error and continue.

**The `min_confidence` request parameter:** If the caller specifies `min_confidence` in the request, apply it as an additional filter on top of the 0.70 system threshold. Use `Math.max(0.70, request.min_confidence)` as the effective threshold. This means callers cannot lower the system threshold below 0.70 by setting `min_confidence: 0`.

---

## 5. Latency Budget

### 5.1 Component Breakdown at 5,000 Skills

| Component | Estimate | Notes |
|-----------|----------|-------|
| API Gateway routing | ~5 ms | Fixed overhead |
| Request validation (Zod) | <1 ms | Negligible |
| Bedrock Titan Embed Text v2 (intent) | ~50 ms p50, ~100 ms p95 | Network call to Bedrock Runtime in us-east-2. Measured from Lambda in same region. |
| DynamoDB Scan / GSI Query (5K skills, projection) | ~80–150 ms p50 | Varies with item size and pagination. Embeddings are 10 KB each; a full table scan of 5K skills projects ~50 MB of embedding data. May require 2–5 paginated scan calls. |
| Float32Array construction (parse DynamoDB L(N)) | ~20 ms | One-time parse of 5K × 1024 numbers |
| Cosine similarity loop (5K × 1024 dot products) | ~50 ms | ~5 billion FLOPs; V8 JIT-compiled. Empirically ~10 ms per 1K skills. |
| Boost computation + sort | ~5 ms | O(n) boost, O(n log n) sort |
| Kinesis PutRecord (fire-and-forget) | ~10 ms | Does not block response |
| **Total p50 (estimated)** | **~220 ms** | |
| **Total p95 (estimated)** | **~400 ms** | Bedrock p95 ~100ms, DynamoDB p95 scan ~200ms |

### 5.2 Latency Target

- **Phase 2 target (DynamoDB scan + Lambda cosine):** p95 < 500 ms at 5,000 skills.
- **Post-migration target (OpenSearch Serverless):** p95 < 100 ms. This is the target referenced in ADR-004 and the API contract's `embedding_search_time_p95_ms` dashboard metric.

> **API contract note:** The `resolve-performance` dashboard (`GET /analytics/dashboards/resolve-performance`) currently tracks `latency_p95_ms` and `embedding_search_time_p95_ms` without explicit phase-based targets. Quimby should annotate the Phase 2 acceptable threshold as 500 ms in the dashboard documentation and alert thresholds. The 100 ms target is a Phase 3 post-migration SLO, not a Phase 2 requirement.

### 5.3 Lambda Configuration for Resolve

| Setting | Value | Reason |
|---------|-------|--------|
| Memory | 512 MB | Holds ~50 MB of embedding data in-flight plus overhead |
| Timeout | 10 seconds | Well above p95 estimate; protects against Bedrock or DynamoDB spikes |
| Reserved concurrency | None (use unreserved) | Bursty traffic; auto-scales |

---

## 6. ADR-005 Summary

Full text in `docs/decisions.md` under `## ADR-005`.

**Decision:** Use DynamoDB scan + Lambda cosine similarity for `/resolve` in Phase 2 (up to 5,000 skills). No OpenSearch.

**This ADR clarifies the latency target stated in ADR-004.** ADR-004 references "p95 < 100ms" as the migration trigger. That figure is the post-OpenSearch target, not the Phase 2 acceptable threshold. The Phase 2 p95 target is < 500 ms. Migration to OpenSearch is triggered at 5,000 active skills (not when latency degrades past 100 ms in Phase 2).

---

## 7. Implementation Notes for IMPL-05

These notes are prescriptive. Ada implements exactly as written here.

### 7.1 DynamoDB Attribute Name

The embedding attribute on `codevolve-skills` is `embedding` (lowercase, no prefix). This is already declared in the schema. No migration required.

### 7.2 Archived Skill Exclusion

The DynamoDB Scan / GSI Query for `/resolve` must always include the following `FilterExpression`:

```
attribute_exists(embedding) AND #st <> :archived
```

With `ExpressionAttributeNames`:
```json
{ "#st": "status" }
```

And `ExpressionAttributeValues`:
```json
{ ":archived": { "S": "archived" } }
```

`attribute_exists(embedding)` is a safety guard that excludes skills whose Bedrock call failed at create time (embedding is null). Without this guard, null embeddings would cause a null-pointer exception in the similarity loop.

Do not use `#status` as the expression name — `status` is a DynamoDB reserved word. Use `#st` or another alias consistently.

### 7.3 Error Handling

| Failure scenario | Required behavior |
|-----------------|-------------------|
| Bedrock InvokeModel returns 4xx (bad request) | Return `503 SERVICE_UNAVAILABLE` with code `EMBEDDING_ERROR`. Do not fall through to a random result. |
| Bedrock InvokeModel returns 5xx or times out | Return `503 SERVICE_UNAVAILABLE` with code `EMBEDDING_ERROR`. Do not fall through. |
| Bedrock InvokeModel returns throttling (429) | Retry once with 200ms exponential backoff. If still throttled, return `503 SERVICE_UNAVAILABLE` with code `EMBEDDING_THROTTLED`. |
| DynamoDB Scan returns no items | Treat as zero candidates. Return HTTP 200 with `best_match: null`, `resolve_confidence: 0`, `evolve_triggered: true`. |
| DynamoDB Scan times out | Return `503 SERVICE_UNAVAILABLE` with code `DB_SCAN_ERROR`. |
| All candidates have confidence < 0.70 | Return HTTP 200 with `best_match: null`, `resolve_confidence: <highest_score>`, `evolve_triggered: true`. |

Never return a 200 with a random or arbitrary skill when the similarity computation fails. Failing loudly is correct — the caller needs to know the resolve was not successful.

### 7.4 Kinesis Event on Resolve

Every invocation of `POST /resolve` — success or failure — must emit a `resolve` event to Kinesis before returning. Emit the event fire-and-forget (do not await; do not let Kinesis failure block the response).

Required event fields:

```typescript
{
  event_type: "resolve",
  timestamp: new Date().toISOString(),     // server-side
  skill_id: best_match?.skill_id ?? null,  // null if no match
  intent: request.intent,
  latency_ms: Date.now() - requestStartMs,
  confidence: resolve_confidence,           // max final_score, or 0 if no match
  cache_hit: false,                         // resolve never uses cache
  input_hash: null,                         // not applicable for resolve
  success: matches.length > 0,
}
```

`latency_ms` must be measured from the point the Lambda handler begins execution (before Zod validation) to the point the response object is assembled (before serialization). Do not include time spent in the Kinesis PutRecord call itself.

### 7.5 File Location

The resolve handler lives at:

```
src/handlers/resolve.ts
```

Shared embedding utility (Bedrock call + Float32Array construction) lives at:

```
src/lib/embeddings.ts
```

Cosine similarity and boost computation lives at:

```
src/lib/similarity.ts
```

These utility modules are also used by the `POST /skills` handler (embedding generation at create time).

### 7.6 Test Coverage Requirements

Before IMPL-05 is marked Verified, the following test cases must pass:

1. **Exact match:** A skill whose embedding closely matches the intent returns `confidence >= 0.70`.
2. **No match:** An intent with no close skills returns HTTP 200 with `best_match: null`, `resolve_confidence: 0`, and `evolve_triggered: true`.
3. **Archived exclusion:** A skill with `status: "archived"` is never returned as a match, even if its embedding would score highest.
4. **Null embedding exclusion:** A skill with `embedding: null` is excluded from results (does not throw).
5. **Tag boost:** A skill with matching tags scores higher than an otherwise identical-cosine-score skill without matching tags.
6. **Domain boost cap:** Total boost cannot exceed 0.20 regardless of how many tags/domains match.
7. **min_confidence override:** Setting `min_confidence: 0.9` raises the effective threshold above 0.70.
8. **Bedrock failure:** Mocked Bedrock returning 500 causes the handler to return 503 `EMBEDDING_ERROR`, not a random result.
9. **L2 normalization check:** The `generateEmbedding` function in `src/lib/embeddings.ts` asserts that the returned vector's L2 norm is within 1e-6 of 1.0.

---

*Last updated: 2026-03-21 — ARCH-05 design by Jorven*
