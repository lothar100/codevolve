# codeVolve — Task List

> Single source of truth for task status. Updated by Quimby. Tasks marked Complete only after Iris approval.

**Status legend:** `[ ]` Planned · `[~]` In Progress · `[!]` Blocked · `[✓]` Verified · `[x]` Complete

---

## Phase 1 — Foundation

### Architecture & Design (Jorven + Amber — run in parallel, no blockers)

| ID | Owner | Status | Task | Blocks |
|----|-------|--------|------|--------|
| ARCH-01 | Jorven | [ ] | Design complete DynamoDB schemas for all tables: `codevolve-problems`, `codevolve-skills`, `codevolve-cache`, `codevolve-archive`. Include GSIs, partition keys, sort keys, and access patterns for every API endpoint. | IMPL-01, IMPL-02, IMPL-04 |
| ARCH-02 | Jorven | [ ] | Write full API contract specs for all 12 endpoints: request shape (zod schema), response shape, error codes, HTTP status codes. Output to `docs/api.md`. | IMPL-02, IMPL-03, IMPL-05, IMPL-06 |
| ARCH-03 | Jorven | [ ] | Design archive mechanism data flow: what triggers archival, what Lambda runs it, what DynamoDB and OpenSearch operations it performs, how it emits events. Must handle: skill archive, problem archive, reversal (un-archive). | IMPL-07 |
| ARCH-04 | Jorven | [ ] | Write ADR-001 (tech stack) and ADR-002 (analytics separation) to `docs/decisions.md`. | — |
| DESIGN-01 | Amber | [ ] | Define skill contract UX: required vs optional vs inferred fields, contributor-facing validation messages, contributor submission flow (what an agent or human POSTs to create a skill). Output to `docs/platform-design.md`. | ARCH-01 |
| DESIGN-02 | Amber | [ ] | Write analytics dashboard specifications: exact ClickHouse/BigQuery queries for all 5 dashboards, refresh cadence, alert thresholds. Output to `docs/platform-design.md`. | IMPL-08 |
| DESIGN-03 | Amber | [ ] | Define archive threshold policy document: exact metric thresholds, cadence, edge cases, reversal conditions. Output to `docs/archive-policy.md`. | ARCH-03 |

**Verification:** Jorven reviews DESIGN-01 for feasibility. Iris reviews ARCH-01, ARCH-02 before implementation begins.

---

### Implementation (Ada — sequential, blocked on architecture)

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| IMPL-01 | Ada | [ ] | Scaffold Lambda project: TypeScript strict mode, Jest, AWS CDK v2, folder structure (`src/registry/`, `src/router/`, `src/execution/`, `src/validation/`, `src/analytics/`, `src/evolve/`, `src/archive/`, `src/shared/`, `infra/`, `tests/`). Set up `package.json`, `tsconfig.json`, `jest.config.ts`, `cdk.json`. | ARCH-01 |
| IMPL-02 | Ada | [ ] | Implement Skill + Problem CRUD API: `POST /skills`, `GET /skills/:id`, `GET /skills`, `POST /problems`, `GET /problems/:id`. DynamoDB DocumentClient, zod validation, Kinesis event emission on every write. Tests required. | ARCH-01, ARCH-02 |
| IMPL-03 | Ada | [ ] | Implement Kinesis event emission utility (`src/shared/emitEvent.ts`): typed `AnalyticsEvent` interface, fire-and-forget (never crash handler on emission failure), unit tests with mocked Kinesis client. | ARCH-02 |
| IMPL-04 | Ada | [ ] | Implement archive mechanism Lambda: reads Decision Engine output from SQS, sets `status: "archived"` in DynamoDB, removes from OpenSearch index, emits `event_type: "archive"` event. Handles skill + problem archival and reversal. Tests required. | ARCH-01, ARCH-03, DESIGN-03 |

---

### Documentation (Quimby — no blockers, run in parallel)

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| DOCS-01 | Quimby | [ ] | Set up `docs/` folder: create stub files for `architecture.md`, `decisions.md`, `api.md`, `platform-design.md`, `archive-policy.md` with correct headers and section scaffolding. | — |
| DOCS-02 | Quimby | [ ] | Create `tasks/lessons.md` with L-000 bootstrap entry. | — |

---

### Review (Iris — runs after architecture artifacts exist)

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| REVIEW-01 | Iris | [ ] | Review ARCH-01 (DynamoDB schemas) and ARCH-02 (API contracts) for completeness, correctness, and edge case coverage before IMPL-02 begins. | ARCH-01, ARCH-02 |
| REVIEW-02 | Iris | [ ] | Review IMPL-01 (project scaffold) — verify folder structure, tsconfig, jest config, CDK setup. | IMPL-01 |
| REVIEW-03 | Iris | [ ] | Review IMPL-02 (CRUD API) + IMPL-03 (event emission) together. | IMPL-02, IMPL-03 |
| REVIEW-04 | Iris | [ ] | Review IMPL-04 (archive mechanism) — pay special attention to: no hard deletions, OpenSearch removal correctness, event emission on archive/unarchive. | IMPL-04 |

---

## Phase 2 — Routing + Execution

*Blocked on Phase 1 completion.*

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| ARCH-05 | Jorven | [ ] | Design vector search architecture: OpenSearch Serverless index schema, embedding strategy (when to embed, field to embed, dimension), `/resolve` ranking logic (vector score + tag boost). | Phase 1 complete |
| ARCH-06 | Jorven | [ ] | Design execution sandbox: Lambda container per language (Python 3.12, Node 22), input/output serialization format, timeout and memory limits, error taxonomy. | Phase 1 complete |
| IMPL-05 | Ada | [ ] | Implement `/resolve` endpoint: embed intent via Bedrock, vector search OpenSearch, tag filter boost, return best match + confidence. Latency target: p95 < 100ms. | ARCH-05 |
| IMPL-06 | Ada | [ ] | Implement `/execute` endpoint: check cache (DynamoDB TTL), deserialize inputs per skill contract, invoke sandboxed runner Lambda, serialize outputs, update cache on hit. | ARCH-06 |
| IMPL-07 | Ada | [ ] | Implement cache layer: `(skill_id, input_hash)` → output, DynamoDB TTL table or ElastiCache. Cache invalidated on skill version update. | ARCH-05 |
| REVIEW-05 | Iris | [ ] | Review IMPL-05 (/resolve) — verify no LLM calls in path, latency targets met in tests, confidence scoring logic. | IMPL-05 |
| REVIEW-06 | Iris | [ ] | Review IMPL-06 (/execute) + IMPL-07 (cache) — verify sandbox isolation, cache correctness, no data leakage between skill executions. | IMPL-06, IMPL-07 |

---

## Phase 3 — Analytics + Feedback Loop

*Blocked on Phase 2 completion.*

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| ARCH-07 | Jorven | [ ] | Design Decision Engine: scheduling (EventBridge), rules logic (auto-cache, optimization flag, gap detection), SQS queue for /evolve pipeline. | Phase 2 complete |
| IMPL-08 | Ada | [ ] | Implement analytics event consumer: Kinesis → Lambda → ClickHouse/BigQuery. Batch writes, dead-letter queue, idempotent processing. | ARCH-07, DESIGN-02 |
| IMPL-09 | Ada | [ ] | Implement 5 dashboard API endpoints (read from ClickHouse/BigQuery). | IMPL-08, DESIGN-02 |
| IMPL-10 | Ada | [ ] | Implement Decision Engine Lambda (scheduled): auto-cache trigger, optimization flag, gap detection → SQS GapQueue, archive evaluation → SQS ArchiveQueue. | ARCH-07, DESIGN-03 |
| DESIGN-04 | Amber | [ ] | Design mountain visualization data shape: what JSON does the frontend need, how to aggregate skill data for rendering. Output to `docs/platform-design.md`. | Phase 2 complete |
| REVIEW-07 | Iris | [ ] | Review IMPL-08 + IMPL-09 — verify analytics separation, no primary DB writes, query correctness. | IMPL-08, IMPL-09 |
| REVIEW-08 | Iris | [ ] | Review IMPL-10 (Decision Engine) — verify rule logic, archive trigger safety (no premature archival), gap detection accuracy. | IMPL-10 |

---

## Phase 4 — Validation + Quality

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| ARCH-08 | Jorven | [ ] | Design /validate endpoint and test runner: Lambda container approach, test execution format, confidence score formula, canonical promotion gate logic. | Phase 3 complete |
| IMPL-11 | Ada | [ ] | Implement /validate: sandboxed test runner, confidence score update in DynamoDB, emit validation event. | ARCH-08 |
| IMPL-12 | Ada | [ ] | Implement /evolve: consume GapQueue, construct skill-generation prompt, call Claude API (claude-sonnet-4-6), parse output into skill contract, auto-trigger /validate. | ARCH-08 |
| IMPL-13 | Ada | [ ] | Implement canonical promotion: `POST /skills/:id/promote-canonical` — verify confidence >= 0.85, all tests passing, demote previous canonical for same problem. | ARCH-08 |

---

## Phase 5 — Visualization + Scale

| ID | Owner | Status | Task |
|----|-------|--------|------|
| DESIGN-05 | Amber | [ ] | Full mountain visualization spec: Three.js approach, React component tree, interaction model, filter/zoom behavior. |
| IMPL-14 | Ada | [ ] | Implement mountain visualization frontend (React + Three.js). |
| IMPL-15 | Ada | [ ] | Implement agent SDK / MCP server wrapper over /resolve + /execute. |
| IMPL-16 | Ada | [ ] | Implement community auth (Cognito) + per-user trusted mountain (saved skill sets). |
