# codeVolve — Next Wave Roadmap
> Author: Jorven | Date: 2026-04-03 | Status: Draft — pending project lead approval

This document covers the next wave of platform improvements across seven categories. Each item is sized, prioritized, and dependency-ordered. The primary audience for codeVolve is AI agents; human UX improvements are explicitly lower priority unless they also reduce agent friction.

---

## How to Read This Document

- **Scope:** S = single Ada session (~half day). M = 2–3 Ada sessions. L = week or longer, likely multi-agent.
- **Priority:** P1 = must have before scale. P2 = high value, schedule next. P3 = nice to have, schedule when capacity allows.
- **Dependencies:** Every item lists what must already be complete before work begins.
- **Files Ada Would Touch:** Concrete file paths so tasks can be written without ambiguity.

---

## 1. Performance Enhancements

### PERF-01 — Provisioned Concurrency on Hot-Path Lambdas

**What it is.** Enable provisioned concurrency on `router-handler` (POST /resolve), `execution-handler` (POST /execute), and `registry-handler` (GET /skills, GET /skills/:id). Cold starts on these paths currently add 800ms–1.5s on first invocation after a cold window.

**Why it matters.** Agents calling `/resolve` then `/execute` in a single task session experience compounding cold starts. A p50 of 40ms becomes 1.5s cold. This undermines the core value proposition (sub-second skill retrieval). Provisioned concurrency eliminates cold starts on the three most latency-sensitive functions.

**Rough scope.** S — CDK change only. Add `ProvisionedConcurrencyConfig` on each alias. Alias-per-environment pattern. Cost: ~$8–15/month at 3 PCUs.

**Dependencies.** BETA-02 (usage plan must exist — provisioned concurrency only makes sense once real traffic patterns are known). IMPL-17 (CloudFront already in place as the outer cache layer).

**Priority.** P1 — cold starts are observable by agents making sequential resolve+execute calls.

**Files Ada would touch.**
- `infra/codevolve-stack.ts` — add `lambda.Alias` + `ProvisionedConcurrencyConfig` for `routerFn`, `executionFn`, `registryFn`.
- `docs/architecture.md` — update Lambda functions table to note provisioned concurrency.

---

### PERF-02 — DAX (DynamoDB Accelerator) for Skill Registry Reads

**What it is.** Add a DAX cluster in front of `codevolve-skills` and `codevolve-problems` for GetItem and Query reads. DAX provides microsecond read latency vs DynamoDB's single-digit millisecond. This complements CloudFront/API Gateway caching (IMPL-17) for the registry read path.

**Why it matters.** GET /skills/:id is the hot read path for agents that have just resolved a skill and want its full contract before executing. At scale, shaving 5–8ms per read reduces overall agent task latency meaningfully. DAX also reduces DynamoDB read capacity consumption.

**Rough scope.** M — DAX cluster CDK construct, VPC placement (Lambda functions must move to VPC or use DAX public endpoint), client swap in DynamoDB utility files.

**Dependencies.** PERF-01 (Lambda configuration is stable before moving Lambdas to VPC). The Lambda functions currently run outside a VPC. DAX requires either a VPC-placed Lambda or the DAX public endpoint (which has security implications). Jorven must decide VPC vs public endpoint before Ada begins — recommend VPC placement using an existing or new VPC CDK construct.

**Priority.** P2 — CloudFront+API GW caching (IMPL-17) already covers the repeat-read case. DAX adds value primarily at >10K req/min to the registry. Worth planning now but not urgent until that traffic level is reached.

**Files Ada would touch.**
- `infra/codevolve-stack.ts` — `CfnSubnetGroup`, `CfnCluster` (DAX), VPC construct, Lambda VPC config.
- `src/shared/dynamoClient.ts` — swap `DynamoDBDocumentClient` for DAX client where applicable.
- `docs/architecture.md` — update AWS Resources table.
- `docs/decisions.md` — ADR-012: DAX vs CloudFront for read acceleration.

---

### PERF-03 — ClickHouse Query Optimization for Dashboard Endpoints

**What it is.** Profile and optimize the five ClickHouse dashboard queries currently implemented in `src/analytics/dashboards.ts`. Specifically: add materialized views for the resolve-performance and execution-caching dashboards (which aggregate over all time), ensure the `analytics_events` table partition pruning is exploited by all queries, and tune the `ReplacingMergeTree` merge schedule.

**Why it matters.** The five dashboard endpoints hit ClickHouse directly on every request (with a 300s CloudFront cache in front). As event volume grows past 10M rows, unoptimized queries will start exceeding the 30s ClickHouse Cloud timeout. Materialized views pre-aggregate the hot aggregations so dashboard queries scan pre-computed summaries rather than the raw event table.

**Rough scope.** M — two new ClickHouse materialized view DDL scripts, updated SQL in `dashboards.ts` to read from MVs where applicable, updated `clickhouse-init.sql`.

**Dependencies.** IMPL-08 complete and deployed (the `analytics_events` table must exist with real data to profile against). IMPL-09 (dashboard queries must be the final form before MVs are designed around them).

**Priority.** P2 — not urgent at current event volumes, but the schema for materialized views must be planned before event volume makes a migration disruptive.

**Files Ada would touch.**
- `scripts/clickhouse-init.sql` — add `CREATE MATERIALIZED VIEW` DDL for resolve-performance and execution-caching aggregates.
- `src/analytics/dashboards.ts` — update resolve-performance and execution-caching queries to read from MVs.
- `scripts/clickhouse-seed-verify.sql` — add MV verification queries.

---

### PERF-04 — /resolve Latency Reduction: Embedding Cache Warm-Up

**What it is.** Pre-compute and cache the intent embedding for the top-100 most-resolved intents in ElastiCache (Redis) or a DynamoDB TTL table. On a /resolve call, check the embedding cache before calling Bedrock Titan. Cache key: SHA-256 of normalized intent string. TTL: 1 hour.

**Why it matters.** Bedrock Titan embedding generation adds 50–80ms to every /resolve call. For agents that repeatedly resolve the same intent (common in agentic loops), this is wasted latency on every call. An embedding cache eliminates this overhead for hot intents. The /resolve latency target is p95 < 100ms (ADR-004/ADR-005); Bedrock alone consumes most of that budget.

**Rough scope.** S–M — new `src/router/embeddingCache.ts` module, DynamoDB TTL table or ElastiCache client, warm-up script triggered by Decision Engine on a 1-hour schedule.

**Dependencies.** IMPL-05 (/resolve complete). IMPL-10 (Decision Engine can run the warm-up job on schedule). The warm-up script needs access to ClickHouse to identify the top-100 intents by resolve count.

**Priority.** P1 — the 100ms p95 target is an architectural constraint (ADR-004). Bedrock latency puts this target at risk under real traffic.

**Files Ada would touch.**
- `src/router/embeddingCache.ts` (new) — `getEmbeddingFromCache`, `writeEmbeddingToCache`.
- `src/router/handler.ts` — add cache check before `bedrockClient.invokeModel`.
- `src/analytics/decisionEngine/warmUpEmbeddingCache.ts` (new) — top-100 query from ClickHouse, Bedrock batch embed, cache write.
- `infra/codevolve-stack.ts` — add `codevolve-embedding-cache` DynamoDB table (TTL on `expires_at`) or ElastiCache Redis cluster.

---

### PERF-05 — Skill Execution Result Streaming

**What it is.** For long-running skill executions (Python or Node runners where execution time > 1s), stream partial output back to the caller rather than waiting for full completion. Use Lambda response streaming (supported since Node 18, available on `NODEJS_22_X` with `ResponseStreamingConfig`).

**Why it matters.** Agents executing skills that produce incremental output (e.g., iterative algorithms, generative skills) currently block until the full result is ready. Streaming lets the agent begin processing output while the skill is still running — critical for skill chaining where output of one skill is the input to the next.

**Rough scope.** L — requires Lambda response streaming CDK configuration, runner protocol changes to emit chunks, execution handler changes to pipe the stream, and API Gateway streaming passthrough (HTTP/2 only). Non-trivial infrastructure change.

**Dependencies.** IMPL-06 and IMPL-07 complete. BETA-02 (rate limiting before exposing streaming, which is harder to rate-limit than standard responses). Requires API Gateway HTTP API (not REST API) for response streaming — check current API type in `infra/codevolve-stack.ts`.

**Priority.** P3 — most skills complete in < 100ms (algorithmic, cached). Streaming is valuable for a minority of use cases. Schedule after P1 and P2 items are stable.

**Files Ada would touch.**
- `infra/codevolve-stack.ts` — `lambda.FunctionUrlConfig` with `invokeMode: RESPONSE_STREAM` or HTTP API upgrade.
- `src/execution/handler.ts` — streaming response wrapper.
- `src/runners/node22/handler.js` and Python equivalent — chunk-emit protocol.
- `docs/api.md` — document streaming response shape for /execute.

---

## 2. Visual / Frontend Enhancements

### VIS-01 — Mountain Visualization: True 3D Mode

**What it is.** Upgrade the mountain from the current 2D flat grid to a genuine 3D extruded mountain shape. In 3D mode, skill bricks are stacked vertically by domain depth — domains with more problems form taller peaks. Camera uses the existing OrbitControls but with a default isometric perspective rather than top-down. The existing 2D mode remains as a toggle ("flat view" vs "mountain view").

**Why it matters.** The "mountain" metaphor is currently unrealized in the 3D geometry. At 100 problems, a flat grid is navigable. At 1,000+, the visual information density of a genuine 3D mountain (peaks = active domains, valleys = coverage gaps) becomes a meaningful readout for agents and human operators assessing registry health at a glance.

**Rough scope.** M — geometry generation changes in `MountainCanvas.tsx`, Y-position calculation per-problem based on domain/skill count, camera default position change, toggle UI in `FilterSidebar.tsx`, no backend changes required.

**Dependencies.** IMPL-14 (3D mountain frontend complete). The current `GET /mountain` endpoint response shape already includes enough data (`skill_count`, `dominant_status`, `execution_count_30d`) to compute heights without backend changes.

**Priority.** P2 — visual impact is high for human operators and demos, but agents don't look at the mountain. Schedule after security/auth beta gates.

**Files Ada would touch.**
- `frontend/src/components/mountain/MountainCanvas.tsx` — Y-position calculation, geometry mode toggle.
- `frontend/src/components/mountain/FilterSidebar.tsx` — 2D/3D view toggle control.
- `frontend/src/hooks/useMountainData.ts` — no changes required.
- `frontend/src/types/mountain.ts` — add `viewMode: "2d" | "3d"` to state shape.

---

### VIS-02 — Skill Detail Page: Confidence History Chart

**What it is.** Add a time-series chart to the skill detail view (currently shown as a modal in the mountain frontend) showing how `confidence` has changed over time. Each /validate run emits an event to ClickHouse with the post-validation confidence value — query the `analytics_events` table to reconstruct the confidence history.

**Why it matters.** A skill's current confidence score alone is insufficient for assessing trajectory. A skill at 0.80 confidence that was 0.90 last week is regressing. A skill at 0.80 that was 0.60 last month is improving. Agents evaluating whether to rely on a skill should have access to this trend.

**Rough scope.** S — new ClickHouse query in `dashboards.ts` (or a new endpoint `GET /skills/:id/confidence-history`), new `ConfidenceHistoryChart` component in the frontend using Recharts `LineChart`.

**Dependencies.** IMPL-09 (ClickHouse dashboards complete). IMPL-08 (validate events must be flowing to ClickHouse). IMPL-14 (mountain detail modal exists as the host component).

**Priority.** P2 — improves agent decision quality when selecting skills to execute.

**Files Ada would touch.**
- `src/analytics/dashboards.ts` — new query function `getSkillConfidenceHistory(skill_id, days)`.
- `docs/api.md` — document new `GET /analytics/skills/:id/confidence-history` endpoint.
- `infra/codevolve-stack.ts` — route for new endpoint.
- `frontend/src/components/mountain/DetailPanel.tsx` — add `ConfidenceHistoryChart`.
- `frontend/src/components/dashboards/ConfidenceHistoryChart.tsx` (new).

---

### VIS-03 — Skill Diff Viewer

**What it is.** Side-by-side comparison of two skill implementations (by `skill_id` and `version`). Displays a syntax-highlighted diff of the `implementation` field. Accessible from the skill detail panel: "Compare with..." picker lists other skills for the same `problem_id` and `language`.

**Why it matters.** When multiple skills exist for the same problem and language, human operators need to understand what changed between versions or competing implementations before deciding which to promote as canonical. Currently there is no way to compare implementations in the UI.

**Rough scope.** M — frontend only (new diff component using a library such as `react-diff-viewer-continued`), `GET /skills/:id/versions` endpoint is already specified in `docs/api.md` (it needs implementation), compare-picker UI.

**Dependencies.** `GET /skills/:id/versions` must be implemented (currently spec'd in `docs/api.md` but not implemented in `src/registry/`). IMPL-14 (skill detail panel host exists).

**Priority.** P3 — human-facing feature. Useful but not on the critical agent path.

**Files Ada would touch.**
- `src/registry/getSkillVersions.ts` (new) — implement the already-spec'd versions endpoint.
- `frontend/src/components/mountain/DetailPanel.tsx` — "Compare with..." entry point.
- `frontend/src/components/skills/SkillDiffViewer.tsx` (new) — diff component.
- `frontend/package.json` — add `react-diff-viewer-continued`.

---

### VIS-04 — Dashboard Auto-Refresh UX: Staleness Indicator

**What it is.** Add a "last updated N seconds ago" indicator to each dashboard panel header. When data is more than 2x the refresh interval stale (e.g., fetch has silently failed), surface a yellow warning badge. The `useDashboardData` hook already tracks `intervalMs` — extend it to expose `lastFetchedAt` and `fetchError` state.

**Why it matters.** Dashboard panels currently update silently. When a fetch fails (ClickHouse down, CORS issue, etc.), the panel shows stale data with no indication. Operators watching dashboards to monitor a deploy or a traffic spike need to know if the numbers are live.

**Rough scope.** S — hook change in `useDashboardData.ts`, new `StalenessIndicator` component, minor per-panel layout change.

**Dependencies.** IMPL-18 (dashboard frontend complete). No backend changes.

**Priority.** P2 — directly improves operator trust in dashboard data.

**Files Ada would touch.**
- `frontend/src/hooks/useDashboardData.ts` — expose `lastFetchedAt` and `fetchError`.
- `frontend/src/components/dashboards/StalenessIndicator.tsx` (new).
- Each dashboard panel component (`ResolvePerformanceDashboard.tsx`, etc.) — add `StalenessIndicator` to panel header.

---

### VIS-05 — Problem/Skill Browser: Search and Filter UI

**What it is.** A dedicated `/browse` route in the frontend (separate from the mountain visualization) with a searchable, filterable table of problems and their canonical skills. Filters: domain (multi-select), language (multi-select), status, confidence range slider, `is_canonical` toggle. Text search hits the existing `GET /skills?search=` and `GET /problems?search=` query params (which the backend already supports via DynamoDB filter expressions).

**Why it matters.** At 100+ problems, the mountain visualization is a high-level heatmap, not a navigable index. Human contributors and operators need a list view with filtering to find specific problems, identify skill gaps (problems with no verified skills), and audit low-confidence skills before they trigger archival.

**Rough scope.** M — new React route + page component, reuse existing API endpoints with filter params, no backend changes required.

**Dependencies.** IMPL-14 (frontend scaffolding exists). BETA-03 (auth, so operators can see write actions from the browser). No backend changes.

**Priority.** P3 — human-facing feature. Agents use /resolve and /execute, not a browser UI.

**Files Ada would touch.**
- `frontend/src/App.tsx` — add `/browse` route.
- `frontend/src/components/browse/ProblemBrowser.tsx` (new).
- `frontend/src/components/browse/SkillTable.tsx` (new).
- `frontend/src/components/browse/FilterPanel.tsx` (new).
- `frontend/src/hooks/useBrowseData.ts` (new).

---

## 3. Agent Experience (DX for AI Consumers)

### AGENT-01 — MCP Server: Remaining Open Items from REVIEW-15

**What it is.** Resolve the three open items from REVIEW-15-IMPL15 that were non-blocking at approval but represent real agent-facing correctness issues: (W-01) resource handler error catching, (W-02) language field enum enforcement in tool schemas, (W-03) submitSkillSchema status enum.

**Why it matters.** The MCP server is the primary integration path for agent consumers. Error contract inconsistency between tools and resources (W-01) means agents using resources get unpredictable error shapes. Unvalidated `language` and `status` fields (W-02, W-03) allow agents to submit malformed skills that fail downstream with opaque errors rather than clear validation feedback at the MCP layer.

**Rough scope.** S — targeted fixes in three files. No architecture changes.

**Dependencies.** IMPL-15 approved (complete). BETA-03 (API key auth must work before the MCP server is used in production).

**Priority.** P1 — the MCP server is the agent's primary integration surface. These are correctness issues, not cosmetic.

**Files Ada would touch.**
- `packages/mcp-server/src/resources.ts` — wrap `client.request` calls in try/catch, return structured error content.
- `packages/mcp-server/src/tools.ts` — change `language` to `z.enum([...SupportedLanguage])`, change `submitSkillSchema.status` to `z.enum([...SkillStatus])`.
- `tests/unit/mcp-server/resources.test.ts` — add error path tests.
- `tests/unit/mcp-server/tools.test.ts` — update schema tests.

---

### AGENT-02 — Batch Resolve API

**What it is.** New endpoint `POST /resolve/batch` accepting an array of up to 20 intents and returning an array of resolve results (same shape as individual `/resolve` responses). Embeddings are generated in parallel via `Promise.all` calls to Bedrock, then vector search is run once per intent against OpenSearch.

**Why it matters.** Agents frequently need to resolve multiple intents at the start of a task session (e.g., "I need to: sort a list, find the GCD, and check if a number is prime"). Issuing three sequential /resolve calls adds 3x the latency. Batch resolve collapses this to a single round-trip with parallel embedding generation.

**Rough scope.** M — new Lambda handler (`src/router/batchResolve.ts`), CDK route, Zod schema for array input (max 20), parallel Bedrock + OpenSearch calls, single Kinesis batch event emit. The existing single-resolve handler logic is reused per-intent inside the batch.

**Dependencies.** IMPL-05 (/resolve complete and stable). ARCH-05 (vector search design already accounts for parallel embedding calls). BETA-02 (rate limit on /resolve/batch must be tighter than individual /resolve — 5 req/s burst 10).

**Priority.** P1 — directly reduces agent task latency for multi-intent sessions. Agents are the primary consumer.

**Files Ada would touch.**
- `src/router/batchResolve.ts` (new) — batch handler.
- `src/router/handler.ts` — extract single-resolve logic into a shared function callable from both handlers.
- `infra/codevolve-stack.ts` — `POST /resolve/batch` route, rate limit override in usage plan.
- `docs/api.md` — `POST /resolve/batch` contract.
- `tests/unit/router/batchResolve.test.ts` (new).

---

### AGENT-03 — Webhook Notifications: Skill Improvement Alerts

**What it is.** Allow agents (or their operators) to register a webhook URL to receive a `POST` notification when a skill they have previously executed is improved (confidence increases past a threshold, or a new canonical is promoted). Registration via `POST /webhooks` with `{ url, skill_id, event_types: ["canonical_promoted", "confidence_improved"] }`. The Decision Engine Lambda triggers webhook delivery on qualifying events.

**Why it matters.** Agents cache skill results locally and rely on the skill's current confidence. When a skill improves, agents should re-evaluate cached decisions. Without webhooks, agents have no way to know a skill has been updated without polling /skills/:id repeatedly. Webhooks push this signal proactively.

**Rough scope.** L — new DynamoDB table (`codevolve-webhooks`), registration/listing/deletion API endpoints, webhook delivery Lambda (retry logic, signature validation, DLQ), CDK constructs, Decision Engine integration to trigger delivery.

**Dependencies.** IMPL-10 (Decision Engine in place — webhook triggers fire from its event loop). BETA-03 (webhook registration must require an API key — no unauthenticated webhook registration). ARCH must write a design document for the webhook system before Ada implements.

**Priority.** P2 — useful for sophisticated agent consumers but requires significant infrastructure. Not needed for initial beta.

**Files Ada would touch (after Jorven writes design).**
- `src/webhooks/` (new module) — registration handler, delivery Lambda.
- `infra/codevolve-stack.ts` — `codevolve-webhooks` table, WebhookDeliveryFn Lambda, DLQ.
- `src/analytics/decisionEngine/` — add webhook trigger invocation.
- `docs/api.md` — webhook registration contract.

---

### AGENT-04 — Agent-Readable Skill Changelog

**What it is.** New endpoint `GET /skills/:id/changelog` returning a structured list of notable changes to a skill over time: validation runs (pass rate change), confidence deltas, canonical promotions, status transitions, and /evolve-generated versions. Data sourced from ClickHouse `analytics_events` table (validate events, archive events) plus DynamoDB skill version records.

**Why it matters.** Agents selecting a skill to depend on need more than a current confidence score — they need to assess stability. A changelog lets an agent determine: "this skill has been canonical for 30 days with stable confidence" vs "this skill was promoted yesterday and has 2 validation runs." This is richer signal than confidence alone.

**Rough scope.** M — new ClickHouse query aggregating validate/promote/evolve events by `skill_id`, joined with DynamoDB version records. New endpoint in `src/analytics/dashboards.ts` or a new `src/registry/skillChangelog.ts`. Response is agent-readable JSON (no HTML, no markdown).

**Dependencies.** IMPL-08 (validate and evolve events flowing to ClickHouse). IMPL-09 (ClickHouse client and query patterns established). IMPL-11, IMPL-12, IMPL-13 (the events being logged must exist).

**Priority.** P2 — improves agent decision quality. Does not block beta but should be in the roadmap before the registry has significant skill history.

**Files Ada would touch.**
- `src/registry/skillChangelog.ts` (new) — handler + ClickHouse query.
- `infra/codevolve-stack.ts` — `GET /skills/{id}/changelog` route.
- `docs/api.md` — changelog response contract.
- `tests/unit/registry/skillChangelog.test.ts` (new).

---

### AGENT-05 — MCP Server: Hot API Key Reload

**What it is.** The MCP server currently reads `CODEVOLVE_API_KEY` once at startup. If a key is rotated while a session is active, the MCP server continues using the stale key. Implement hot reload: on each HTTP request, re-read the key from an environment variable or a mounted secret file, with a 60-second in-memory cache to avoid reading the file on every call.

**Why it matters.** DESIGN-06 flagged this as an open item. For long-running agent sessions (overnight batch jobs), key rotation will silently break the session mid-task. The MCP server is stateless — hot reload is a small change with significant reliability upside.

**Rough scope.** S — change in `packages/mcp-server/src/client.ts` (or wherever the `Authorization` header is assembled). Add a cached key reader with 60s TTL.

**Dependencies.** IMPL-15 (MCP server complete). BETA-03 (API key system must exist before key rotation is a real scenario).

**Priority.** P2 — low implementation effort, meaningful reliability improvement.

**Files Ada would touch.**
- `packages/mcp-server/src/client.ts` — replace static key read with `getCachedApiKey()`.
- `packages/mcp-server/src/apiKey.ts` (new) — 60s cached key reader.
- `tests/unit/mcp-server/apiKey.test.ts` (new).

---

## 4. Skill Quality and Evolution

### QUAL-01 — A/B Testing Framework for Competing Skill Implementations

**What it is.** When two or more non-archived, non-canonical skills exist for the same `problem_id` and `language`, the `/execute` endpoint can route a configurable percentage of requests to each skill and track outcomes separately in ClickHouse. The Decision Engine evaluates A/B results and can auto-promote the winner when confidence delta is statistically significant.

**Why it matters.** Currently, canonical promotion is a binary gate — a human or agent must explicitly call `/promote-canonical`. A/B testing automates the evaluation of competing implementations by routing real traffic and measuring outcomes, then promoting based on data rather than a single validation run.

**Rough scope.** L — requires: routing logic in execution handler (weighted random selection when multiple skills exist), per-variant event tagging in Kinesis events, new ClickHouse query for variant comparison, Decision Engine rule for auto-promotion from A/B data, CDK config table entry for A/B feature flag. Jorven must write a design document before Ada begins.

**Dependencies.** IMPL-06 (/execute complete). IMPL-10 (Decision Engine in place for auto-promotion). IMPL-13 (canonical promotion mechanism must be stable). BETA-02 (rate limiting must be in place — A/B routing logic adds latency to execute path).

**Priority.** P2 — significant quality improvement but requires careful design to avoid corrupting confidence scores.

**Files Ada would touch (after Jorven writes design).**
- `src/execution/handler.ts` — A/B routing logic.
- `src/analytics/decisionEngine/abPromotion.ts` (new).
- `src/shared/emitEvent.ts` — add `variant_id` to analytics event schema.
- `infra/codevolve-stack.ts` — A/B config table entry.

---

### QUAL-02 — Automated Benchmark Suite

**What it is.** A scheduled Lambda (or CDK EventBridge rule) that runs all canonical skills against a standard input set every 24 hours and records execution latency and output correctness in ClickHouse. Results are visible on the skill-quality dashboard as a "benchmark history" chart. Skills whose benchmark latency degrades by > 20% from their baseline are flagged for optimization.

**Why it matters.** Confidence scores measure test correctness but not performance. A skill can have 1.0 confidence and terrible latency. The optimization flag in the Decision Engine currently relies on p95 latency from live traffic — the benchmark suite provides a consistent, traffic-independent baseline.

**Rough scope.** M — new `src/analytics/benchmarkRunner.ts` Lambda, CDK EventBridge rule (daily), standard input set stored in `codevolve-config` DynamoDB table per skill, ClickHouse `benchmark_runs` table (new DDL), Decision Engine integration for latency regression detection.

**Dependencies.** IMPL-10 (Decision Engine established as the pattern for scheduled Lambdas). IMPL-06 (runner Lambdas are the execution substrate). IMPL-09 (ClickHouse write pattern established).

**Priority.** P2 — necessary before the optimization flag is meaningful for skills with low live traffic.

**Files Ada would touch.**
- `src/analytics/benchmarkRunner.ts` (new).
- `scripts/clickhouse-init.sql` — add `benchmark_runs` table DDL.
- `infra/codevolve-stack.ts` — `BenchmarkRunnerFn` Lambda, daily EventBridge rule.
- `src/analytics/decisionEngine/optimizationFlag.ts` — add benchmark regression detection.

---

### QUAL-03 — Cross-Language Skill Parity Testing

**What it is.** For problems that have skills in multiple languages (e.g., both Python and JavaScript), run the same input set against all language variants and compare outputs. A parity check fails when the canonical Python skill and the canonical JavaScript skill produce different outputs for the same input. Parity failures are surfaced in the skill-quality dashboard.

**Why it matters.** Agents may call the Python version of a skill on one platform and the JavaScript version on another. If outputs differ, the system is non-deterministic from the agent's perspective. Parity testing catches these cross-language divergences before agents encounter them in production.

**Rough scope.** M — new parity check function in the benchmark suite (QUAL-02 is a natural dependency), ClickHouse query for parity failure events, skill-quality dashboard extension.

**Dependencies.** QUAL-02 (benchmark suite provides the input runner infrastructure). IMPL-06 (both runners must be deployed). Skills must have canonical versions in at least two languages — this is a data readiness dependency, not a code one.

**Priority.** P3 — valuable but requires both QUAL-02 and sufficient multi-language skill coverage. Schedule after QUAL-02 is stable.

**Files Ada would touch.**
- `src/analytics/benchmarkRunner.ts` — add parity comparison after per-language runs.
- `src/analytics/dashboards.ts` — extend skill-quality dashboard with parity failure data.
- `scripts/clickhouse-init.sql` — add `parity_failures` event type to `analytics_events` DDL.

---

### QUAL-04 — /evolve Prompt Improvement: Multi-Turn Refinement

**What it is.** The current /evolve SQS consumer calls Claude API once (single-turn) to generate a skill. Replace this with a multi-turn refinement loop: (1) generate initial skill, (2) run /validate, (3) if confidence < 0.85, send the test failure details back to Claude as a follow-up message with the instruction to fix the failures, (4) repeat up to 3 rounds. If confidence >= 0.85 after any round, proceed to canonical promotion gate.

**Why it matters.** The current single-turn approach frequently produces skills that pass some but not all tests. The test failure details are rich signal for Claude — feeding them back in a follow-up message leverages the model's ability to self-correct. In testing, 2-turn refinement is expected to push pass rates from ~60% to ~85% for moderately complex skills.

**Rough scope.** M — changes to `src/evolve/handler.ts` (refinement loop), `src/evolve/claudeClient.ts` (multi-turn message array support), extended `codevolve-evolve-jobs` status tracking (round_number attribute). Lambda timeout is already 5 minutes which allows up to 3 rounds.

**Dependencies.** IMPL-12 (/evolve SQS handler complete). IMPL-11 (/validate must be callable inline from the evolve handler, not just via async Lambda invocation — refactoring required).

**Priority.** P2 — directly improves the quality of auto-generated skills, reducing human intervention in the evolution loop.

**Files Ada would touch.**
- `src/evolve/handler.ts` — refinement loop (up to 3 rounds).
- `src/evolve/claudeClient.ts` — `buildRefinementMessages(previousPrompt, testResults)` helper.
- `docs/dynamo-schemas.md` — add `round_number` (N) attribute to `codevolve-evolve-jobs`.
- `tests/unit/evolve/handler.test.ts` — multi-round test cases.

---

## 5. Registry Scale

### SCALE-01 — OpenSearch Migration Trigger and Execution Plan

**What it is.** Define the exact trigger condition and migration playbook for switching from DynamoDB client-side cosine similarity (ADR-005) to OpenSearch Serverless. The trigger is > 5,000 active (non-archived) skills in `codevolve-skills` (as specified in ARCH-05). The playbook covers: dual-write period, backfill of existing embeddings, OpenSearch index schema, cutover, rollback procedure.

**Why it matters.** Client-side cosine similarity loads all embeddings into Lambda memory at /resolve time. At 5,000 skills × 1,024 float32 dimensions × 4 bytes = 20 MB per Lambda invocation. This approaches Lambda memory limits and degrades /resolve latency significantly. The migration must be designed before hitting the threshold so it can be executed without downtime.

**Rough scope.** M (design) + L (implementation) — design document first (Jorven), then implementation of dual-write, backfill script, OpenSearch CDK construct, cutover logic in /resolve handler.

**Dependencies.** ARCH-05 (the current DynamoDB approach is already designed; OpenSearch migration was deferred with a documented trigger). The migration itself requires > 0 skills in the registry to backfill. Recommended: design now, implement when skill count reaches 2,000 (to have runway before the 5,000 threshold).

**Priority.** P1 — architectural constraint. Not urgent at current skill count but must be designed and ready before the threshold is hit. ADR-012 (or ADR-013 if DAX takes ADR-012) should document the migration decision.

**Files Jorven would write first.**
- `docs/opensearch-migration.md` — playbook document.
- `docs/decisions.md` — ADR for OpenSearch migration decision.

**Files Ada would touch (implementation).**
- `infra/codevolve-stack.ts` — `CfnCollection` (OpenSearch Serverless), dual-write feature flag in `codevolve-config`.
- `src/router/handler.ts` — OpenSearch client branch (behind feature flag).
- `scripts/opensearch-backfill.ts` — one-time backfill script.
- `src/shared/opensearchClient.ts` (new).

---

### SCALE-02 — Bulk Skill Import/Export API

**What it is.** Two new endpoints: `POST /skills/bulk-import` accepting a JSON array of up to 500 skill records (same schema as `POST /skills`), processed as a DynamoDB `BatchWriteItem` with Bedrock embedding generation in parallel. `GET /skills/export` returning a newline-delimited JSON (NDJSON) stream of all non-archived skills for backup or migration.

**Why it matters.** The current registry has been seeded with ~100 problems. Growing to 1,000+ requires a bulk import path — manually calling `POST /skills` 900 times is not viable. Export is needed for backup, for seeding development environments, and as a prerequisite for registry federation (SCALE-03).

**Rough scope.** M — new Lambda handlers, Bedrock parallel embedding (up to 25 concurrent Bedrock calls per batch to stay within Titan rate limits), DynamoDB BatchWriteItem chunking (25 items per call), S3-backed streaming for export (Lambda streaming response or S3 presigned URL pattern).

**Dependencies.** IMPL-02 (CRUD is the base). PERF-04 (embedding cache warm-up — bulk import will be a significant Bedrock workload; caching avoids re-embedding duplicate descriptions). BETA-03 (bulk import requires API key auth — open bulk import is a data integrity risk).

**Priority.** P2 — required before the registry can grow significantly beyond its seeded state.

**Files Ada would touch.**
- `src/registry/bulkImport.ts` (new).
- `src/registry/exportSkills.ts` (new).
- `infra/codevolve-stack.ts` — `POST /skills/bulk-import` and `GET /skills/export` routes.
- `docs/api.md` — bulk import/export contracts.

---

### SCALE-03 — Problem Taxonomy: Category Tree and Difficulty Ratings

**What it is.** Add a hierarchical category system to the `codevolve-problems` table: `category` (top-level, e.g., "graphs", "dynamic-programming", "strings") and `subcategory` (e.g., "shortest-path", "knapsack", "palindromes"). Add `difficulty` field (`easy | medium | hard | expert`). Expose these as filter dimensions on `GET /problems` and `POST /resolve`.

**Why it matters.** The current domain system is flat tags. At 100 problems, tag-based filtering is adequate. At 1,000+ problems, agents need structured navigation: "find me a verified dynamic programming skill for this subproblem, medium difficulty." Category + difficulty gives agents a structured intent without requiring natural language. It also improves /resolve accuracy by allowing tag-boost to incorporate category/difficulty alignment.

**Rough scope.** M — DynamoDB schema addition (GSI on category), API filter param updates, /resolve tag-boost update, `docs/dynamo-schemas.md` update, migration for existing records.

**Dependencies.** IMPL-02 (problem CRUD complete). ARCH-05 (/resolve boost logic documented — category boost must be spec'd by Jorven before Ada touches the boost algorithm).

**Priority.** P2 — important for agent navigability at scale but not blocking at current problem count.

**Files Ada would touch.**
- `docs/dynamo-schemas.md` — add `category`, `subcategory`, `difficulty` to `codevolve-problems` schema, new GSI `GSI-category`.
- `src/registry/createProblem.ts` and `listProblems.ts` — add new fields.
- `src/router/handler.ts` — category/difficulty boost in scoring.
- `docs/api.md` — update `POST /problems` and `GET /problems` contracts.
- `scripts/seed-taxonomy.ts` (new) — one-time migration to add category/difficulty to existing problems.

---

## 6. Security and Operations

### SEC-01 — BETA-01 Completion (SSRF Fix in Node 22 Runner)

**What it is.** This is an existing planned task (BETA-01) that must be called out here because it is the single most important security item before any public traffic. The Node 22 sandbox executes skill implementations via `new Function()` but does not block `fetch`, `WebSocket`, `process.env`, or other network/process globals introduced in Node 22. Any submitted skill can exfiltrate Lambda IAM credentials.

**Why it matters.** codeVolve is a public registry. Any agent or human can submit a skill. Without this fix, the execution environment is fundamentally unsafe for public use. This is not an optional enhancement — it is a blocker for all public beta traffic.

**Rough scope.** S — targeted changes to `src/runners/node22/handler.js`. Design note is fully specified in BETA-01 (the shadow injection pattern via `new Function()` parameter list is documented).

**Dependencies.** None — this is the first fix that must ship.

**Priority.** P1 — security blocker. No public traffic until resolved.

**Files Ada would touch.** See BETA-01 for exact specification.

---

### SEC-02 — Python Runner Sandbox Audit

**What it is.** Audit the Python skill runner sandbox (`src/runners/python312/`) for equivalent SSRF and process escape vectors. Python 3.12 provides `urllib`, `http.client`, `socket`, `subprocess`, `os`, and `importlib` — all of which can be used to exfiltrate credentials or escape the sandbox. Document the current sandbox approach and close any identified gaps.

**Why it matters.** BETA-01 addresses Node 22. Python is the second supported language. If the Python runner does not have equivalent protections, a malicious skill submitted in Python bypasses the Node fix entirely.

**Rough scope.** S–M — audit (S) then fix (S–M depending on findings). The audit must produce a written checklist before Ada begins fixes. Jorven and Iris should review the audit output before implementation.

**Dependencies.** BETA-01 (Node fix establishes the pattern — Python audit follows the same shadow/block methodology). IMPL-06 (runner must be deployed and stable before auditing).

**Priority.** P1 — same urgency as BETA-01. Both runners are public-facing. Audit before beta, fix before beta.

**Files Ada would touch.**
- `src/runners/python312/handler.py` — restricted `__builtins__`, `RestrictedPython` or equivalent.
- `tests/unit/runners/python312-sandbox.test.py` (new) — mirror of the Node sandbox tests.
- `docs/architecture.md` — update Rule 3 to document both sandbox implementations.

---

### SEC-03 — Audit Logging for Write Operations

**What it is.** Structured audit log entry written to a dedicated ClickHouse table (`audit_log`) on every write operation: `POST /skills`, `POST /problems`, `POST /skills/:id/promote-canonical`, `POST /skills/:id/archive`, `POST /skills/:id/unarchive`, `POST /validate/:skill_id`, `POST /evolve`. Log includes: timestamp, endpoint, `owner_id` (from API key or Cognito), resource_id, request summary (no PII, no implementation code), HTTP status of response.

**Why it matters.** The current analytics event stream tracks operational events (resolve, execute, validate) but not who performed write operations. Audit logging is necessary for compliance, debugging production issues, and identifying malicious contributors (e.g., who submitted a skill that bypassed sandbox checks).

**Rough scope.** M — new ClickHouse `audit_log` table DDL, shared `emitAuditLog` utility in `src/shared/`, integration into all write handlers, Kinesis event type extension (or direct ClickHouse write — Jorven must decide before implementation).

**Dependencies.** BETA-03 (API key system must exist to have an `owner_id` to log). IMPL-08 (ClickHouse write pattern established).

**Priority.** P2 — not blocking beta launch but required before production scale.

**Files Ada would touch.**
- `scripts/clickhouse-init.sql` — `audit_log` table DDL.
- `src/shared/emitAuditLog.ts` (new).
- `src/registry/createSkill.ts`, `createProblem.ts`, `promoteCanonical.ts`, `archiveUtils.ts` — add `emitAuditLog` calls.
- `src/validation/handler.ts`, `src/evolve/handler.ts` — add `emitAuditLog` calls.

---

### SEC-04 — Secret Rotation Automation

**What it is.** Enable automatic rotation for the two Secrets Manager secrets currently requiring manual rotation: `codevolve/clickhouse-credentials` (ClickHouse Cloud API key) and `codevolve/anthropic-api-key` (Claude API key). Each secret gets an AWS Lambda rotation function (using the Secrets Manager rotation Lambda pattern) that generates a new key via the provider's API, stores it, and validates it before promoting.

**Why it matters.** Manual secret rotation is a compliance and operational risk. At beta scale, manual rotation is manageable. At production scale with multiple operators, unrotated secrets are a common security incident vector. The ClickHouse and Anthropic credentials are high-value targets.

**Rough scope.** M — two rotation Lambda functions (one per secret), CDK `SecretRotationSchedule` constructs, integration tests confirming the rotation Lambda validates the new secret before promoting it.

**Dependencies.** IMPL-08 (ClickHouse client reads the secret — rotation must not break the client singleton pattern). IMPL-12 (Anthropic client reads the secret similarly). BETA-03 (API key rotation design may inform the pattern here).

**Priority.** P2 — operational necessity before production but not blocking beta.

**Files Ada would touch.**
- `src/secrets/clickhouseRotation.ts` (new).
- `src/secrets/anthropicRotation.ts` (new).
- `infra/codevolve-stack.ts` — `SecretRotationSchedule` constructs, rotation Lambda IAM.

---

### SEC-05 — Cost Alerting and Budget Guards

**What it is.** AWS Budgets alert (via SNS → email/Slack) when monthly spend exceeds $50 (warning) or $100 (critical). Per-service budgets for the top three cost drivers: Lambda invocations, Bedrock API calls, and ClickHouse Cloud usage. CloudWatch alarm on Decision Engine Lambda `Errors` metric > 0 for 5 consecutive evaluation periods.

**Why it matters.** codeVolve uses pay-per-use services (Bedrock, Lambda, ClickHouse Cloud). An agentic loop that sends 10,000 /evolve requests would generate significant unexpected cost. Budget alerts with hard stops prevent surprise bills during beta. The Decision Engine error alarm catches the most likely failure mode (scheduled Lambda silently failing) before it causes analytics data loss.

**Rough scope.** S — CDK `CfnBudget` constructs, SNS topic, CloudWatch alarms. No Lambda code changes.

**Dependencies.** IMPL-10 (Decision Engine deployed). IMPL-08 (analytics consumer deployed — want alerts on both).

**Priority.** P1 — operational safety for a pay-per-use system. Low implementation cost, high risk reduction.

**Files Ada would touch.**
- `infra/codevolve-stack.ts` — `CfnBudget`, SNS topic, CloudWatch alarms.
- `docs/architecture.md` — add cost alerting section.

---

## 7. Community and Monetization (Future)

*These items are planning horizons, not scheduled work. They are included to ensure architectural decisions made now do not foreclose these paths. None are assigned to Ada.*

### COMM-01 — Skill Author Attribution

**What it is.** Track `contributed_by` on skill records (an `owner_id` from BETA-03's API key system). Surface contributor leaderboards in the analytics dashboard showing top contributors by skill count, total executions across their skills, and canonical promotion rate.

**Why it matters.** Attribution drives contribution. Agents and operators who submit high-quality skills should receive recognition. The leaderboard is also a signal for agents evaluating a new skill: "this contributor has 12 canonical skills with average confidence 0.91" is meaningful provenance.

**Rough scope.** M — add `contributed_by` to skill schema (requires BETA-03), ClickHouse leaderboard query, new analytics dashboard tab.

**Dependencies.** BETA-03 (API key system — `owner_id` is the attribution key). IMPL-08 (ClickHouse for leaderboard queries).

**Priority.** P3 — community feature, not a core capability.

---

### COMM-02 — Usage-Based API Pricing Tiers

**What it is.** Three-tier API key model: Free (100 resolves/day, 50 executes/day, no /evolve), Pro (10,000 resolves/day, 5,000 executes/day, 100 /evolve/day), Enterprise (unlimited, SLA-backed). Tracked via DynamoDB usage counters per `owner_id`, enforced at the Lambda authorizer level.

**Why it matters.** codeVolve runs on pay-per-use AWS services. At scale, the compute cost of supporting free users must be offset by paid tiers. The MCP server + API key combination (BETA-03 + AGENT-01) is the natural packaging for a paid tier.

**Rough scope.** L — usage counter table, authorizer changes, Stripe integration for billing, plan upgrade flow.

**Dependencies.** BETA-03 (API key system is the billing identity anchor). SEC-03 (audit log is the usage record for billing disputes). SCALE-02 (bulk import is a Pro/Enterprise feature).

**Priority.** P3 — post-beta monetization feature.

---

### COMM-03 — Community Voting on Canonical Promotion

**What it is.** Allow registered agents and operators (API key holders) to vote on which skill should be canonical for a given problem+language pair. Votes are advisory, not automatic — the canonical promotion gate (confidence >= 0.85, all tests passing) remains the hard requirement. Vote counts are visible on the skill detail panel and can influence Decision Engine weighting.

**Why it matters.** Canonical promotion is currently determined by confidence scores from automated test runs. Community voting adds a signal that pure test metrics miss: "is this implementation idiomatic? Is it readable? Does it handle edge cases the tests don't cover?" This is particularly relevant as the skill count grows and multiple high-confidence implementations compete.

**Rough scope.** L — voting table, voting endpoints, Decision Engine weight integration, frontend voting UI.

**Dependencies.** BETA-03 (voting requires identity). COMM-01 (author attribution needed to prevent self-voting). QUAL-01 (A/B testing provides the competing implementations that warrant voting).

**Priority.** P3 — long-term community feature.

---

## Priority Summary

| Priority | Items | Rationale |
|----------|-------|-----------|
| P1 | SEC-01 (SSRF fix), SEC-02 (Python sandbox), SEC-05 (cost alerting), PERF-01 (provisioned concurrency), PERF-04 (embedding cache), AGENT-01 (MCP fixes), AGENT-02 (batch resolve), SCALE-01 (OpenSearch migration plan) | Must be done before meaningful public traffic |
| P2 | PERF-02 (DAX), PERF-03 (ClickHouse MVs), VIS-01 (3D mountain), VIS-02 (confidence history), VIS-04 (staleness indicator), AGENT-03 (webhooks), AGENT-04 (changelog), AGENT-05 (hot key reload), QUAL-02 (benchmark suite), QUAL-04 (/evolve refinement), SCALE-02 (bulk import), SCALE-03 (taxonomy), SEC-03 (audit log), SEC-04 (secret rotation) | High value, schedule after P1 |
| P3 | PERF-05 (streaming), VIS-03 (diff viewer), VIS-05 (browser UI), QUAL-01 (A/B), QUAL-03 (parity), COMM-01, COMM-02, COMM-03 | Nice to have, long-horizon |

---

## Ordering Recommendation for Next Two Ada Sessions

**Session 1 (security gate before beta):**
1. SEC-01 (BETA-01 completion — SSRF fix, Node 22 runner)
2. SEC-02 (Python sandbox audit + fix)
3. SEC-05 (cost alerting CDK constructs)

**Session 2 (agent DX + performance):**
1. AGENT-01 (MCP server open items from REVIEW-15)
2. AGENT-02 (batch resolve API)
3. PERF-04 (embedding cache warm-up)

Neither session requires new Jorven design documents before Ada begins — all three Session 1 tasks have complete specifications. AGENT-02 needs a brief API contract review by Jorven before Ada begins (30 minutes, not a full ARCH session).

---

*Last updated: 2026-04-03 — Jorven, blue-sky planning session*
