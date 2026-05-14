# codeVolve Agent Efficiency Roadmap

Date: 2026-04-12
Author: Codex
Status: Proposed

## Goal

Make codeVolve materially better for AI agents than doing the work directly with local commands by improving one or both of:

1. End-to-end time to useful execution
2. Token cost for planning, lookup, and composition

The current codebase does not yet do that reliably. It mostly helps with discovery and analytics, while the agent still pays most of the planning and orchestration cost itself.

## What The Codebase Currently Does

### Current strengths

- `src/router/resolve.ts` returns ranked matches with `implementation_token_size`, which is the right primitive for token-aware routing.
- `src/execution/execute.ts` treats execution as local and keeps server-side responsibility narrow.
- `scripts/benchmark-deploy-skill.mjs` already gives a benchmark harness that can be extended into a repeatable scorecard.
- `src/analytics/dashboards.ts` and the Kinesis/ClickHouse pipeline give a path to measure real agent behavior once the right events exist.

### Current gaps that work against the value proposition

1. Resolve is still a slow lookup path.
- `src/router/resolve.ts` embeds the request on every call and then scans or broad-queries DynamoDB candidates before local scoring.
   - Language-less requests still scan the full skills table.

2. Retrieval payloads are still too large.
   - `src/registry/getSkill.ts` always returns `examples`, `tests`, and full `implementation`.
   - The main agent path often needs only a summary, contract, or implementation pointer first.

3. MCP mostly wraps the REST API instead of compressing agent work.
   - `packages/mcp-server/src/tools.ts` serializes whole API responses into plain text blocks.
   - `packages/mcp-server/src/client.ts` reparses full JSON payloads after full-body reads.
   - `chain_skills` in the published package still resolves steps sequentially or calls `/execute/chain`, which is not aligned with the local-execution model.

4. The product surface is internally inconsistent.
- The repo still carries `/resolve` terminology in docs and task history even though `/intent` is the active routing concept.
   - `src/execution/execute.ts` is analytics-only, but docs and some MCP surfaces still describe server-side execution or chain execution.
   - `src/registry/getSkill.ts` emits an `execute` analytics event on read, which pollutes measurement.

5. Ranking does not yet optimize for “best agent outcome”.
- `src/router/resolve.ts` scores by similarity plus tag/domain boost.
   - It does not rank by success rate, portability, payload size, or chainability.

6. Analytics are not yet measuring the core value proposition.
   - `src/analytics/dashboards.ts` focuses on resolve/execute volumes and caching-style views.
   - It does not measure “tokens saved vs direct local path”, “lookup overhead vs direct command path”, or “composition steps avoided”.

## Product Direction

The strongest near-term value is not “hosted execution”. It is:

1. Faster exact lookup than natural-language search
2. Smaller responses than full skill retrieval
3. Better composition than ad hoc agent planning
4. Better ranking for agent success than simple similarity

The product should bias toward:

- exact/alias resolution before embeddings
- summary-first retrieval
- chain suggestion and chain packaging
- portability metadata and compatibility-aware ranking
- token-aware responses by default

## Agent Flow

### Current flow in the repo

This is the effective flow today, despite naming drift across surfaces:

1. Agent uses exact lookup when it already knows the skill
2. Agent uses intent routing when it does not
3. Router returns a skill summary first
4. Agent fetches the implementation only if it still needs code
5. Agent executes locally
6. Agent reports the run or validation back to codeVolve

In shorthand:

`exact lookup or intent -> skill summary -> implementation fetch if needed -> local execution -> feedback`

### Why the current flow is still inefficient

- The first step is too expensive for experienced agents because semantic lookup is still the default path.
- The second fetch is too large because full skill retrieval is still the default read contract.
- MCP naming still implies an older mental model, so agents are nudged toward the wrong tool choice.

### Target flow

For single-skill tasks:

`exact lookup or intent -> skill summary -> implementation fetch only if needed -> local execution -> feedback`

For multi-step tasks:

`intent -> chain suggestion or chain plan -> targeted implementation fetches -> local execution -> feedback`

### Product rule

The canonical product story should be:

- use `intent` only when the agent does not know the skill already
- use exact or canonical lookup when the skill is known
- fetch summary by default
- fetch implementation explicitly
- execute locally
- send feedback back only after the local run

## Roadmap

### Cleanup track: remove stale surfaces before adding new ones

This is a prerequisite track, not optional polish. The repo already shows that stale naming and stale execution semantics keep resurfacing in docs, MCP tools, tests, and task records. New agent-efficiency work will keep inheriting that smell unless the surface is normalized first.

Cleanup goals:

1. Pick one canonical route name
   - `intent` should replace lingering `resolve` surface names unless the product deliberately keeps both as a compatibility alias
2. Pick one canonical feedback name
   - keep `validate` only if it truly means caller-reported validation
   - otherwise rename to `feedback`
3. Remove server-execution language everywhere it is no longer true
4. Align MCP tool names with the actual product model
5. Stop emitting analytics that imply actions that did not happen

Definition of done for the cleanup track:

- no stale `resolve_skill` names remain if `intent` is the canonical concept
- no docs claim server-side skill execution
- no docs claim server-side validation runners
- no MCP tool implies hosted execution when execution is local
- no analytics event is emitted for a read-only fetch

### Short-term: make single-skill lookup cheaper than local planning

#### Milestone S1: Add direct lookup paths that bypass embedding search

Why:
- The benchmark overhead is dominated by lookup and wrapping, not execution.
- Agents with prior knowledge should not pay embedding + scan cost.

Changes:
- Add `alias`, `slug`, and `canonical_key` fields to skill records.
- Add `GET /skills/by-alias/:alias` and `GET /skills/by-problem/:problem_id/canonical?language=...`.
- Add MCP tools `get_skill_summary` and `get_canonical_skill`.
- Keep `/intent` as the fallback, not the default for experienced agents.

Repo impact:
- `src/registry/createSkill.ts`
- `src/registry/getSkill.ts`
- `src/registry/listSkills.ts`
- `infra/codevolve-stack.ts`
- `packages/mcp-server/src/tools.ts`
- `src/shared/types.ts`

Success metric:
- Exact lookup p95 under 250 ms from cold network path
- 80%+ of experienced-agent retrievals bypass embedding search

#### Milestone S2: Split summary retrieval from implementation retrieval

Why:
- `GET /skills/:id` currently returns everything, including tests and implementation.
- Agents often need a cheap decision payload before they need code.

Changes:
- Add `GET /skills/:id/summary` returning:
  - identity
  - contract
  - confidence
  - execution stats
  - portability metadata
  - `implementation_token_size`
  - `implementation_ref`
- Add `GET /skills/:id/implementation` returning only implementation payload plus language/runtime metadata.
- Add query param `view=summary|full|implementation`.
- Make MCP `get_skill` default to summary and expose an explicit `get_skill_implementation`.

Repo impact:
- `src/registry/getSkill.ts`
- `docs/api.md`
- `packages/mcp-server/src/tools.ts`
- `packages/mcp-server/src/resources.ts`

Success metric:
- Reduce average bytes returned on first retrieval by at least 70%
- Reduce first-call MCP/API orchestration tokens by at least 50% on benchmarked flows

#### Milestone S3: Fix MCP to return agent-optimized shapes, not text-wrapped blobs

Why:
- Current MCP returns JSON serialized into text content, which adds protocol and parsing overhead.
- It does not help the model decide what to fetch next.

Changes:
- Return compact structured objects in tool outputs instead of pretty-printed full JSON strings where the SDK allows it.
- Add “small result” defaults:
  - resolve returns top 1 by default, not top 5
  - list returns summaries only
  - get returns summary unless implementation explicitly requested
- Add `fields` selection to MCP tools and REST endpoints.
- Remove or redesign `chain_skills` so it returns a chain plan for local execution, not server-execution semantics.

Repo impact:
- `packages/mcp-server/src/tools.ts`
- `packages/mcp-server/src/index.ts`
- `src/mcp/tools.ts`
- `src/mcp/server.ts`

Success metric:
- MCP experienced-user benchmark under 3.5 s total for fetch + local execution on the deploy skill
- MCP session/orchestration token estimate under 900 on the same flow

### Medium-term: make composition cheaper than agent planning

#### Milestone M1: Teach intent resolution to return chain suggestions

Why:
- The repo already recognizes that future value is in planning/composition cost.
- Today the agent still has to invent chains itself.

Changes:
- Extend `/intent` response with optional `chain_suggestion`:
  - ordered steps
  - step intent
  - candidate skill summaries
  - input/output mapping hints
  - overall confidence
  - estimated payload cost
- Attempt chain suggestion when:
  - no strong direct hit
  - the request looks compositional
  - the direct hit has poor portability or high payload cost

Repo impact:
- `src/router/resolve.ts`
- `src/shared/types.ts`
- `tests/unit/resolve/resolve.test.ts`
- `packages/mcp-server/src/tools.ts`

Success metric:
- For multi-step benchmark tasks, reduce agent-issued registry/tool calls by at least 40%
- Increase resolve-to-useful-execution conversion rate for compositional intents by at least 20%

#### Milestone M2: Add a first-class chain packaging endpoint

Why:
- Agents need a compact, deterministic package they can execute locally.
- A chain suggestion alone still leaves packaging work to the agent.

Changes:
- Add `POST /chains/plan`:
  - accepts intent or explicit steps
  - returns a local execution plan
  - includes step order, mapping, required env/tools, and implementation refs
- Optionally add `POST /chains/materialize`:
  - returns a compact bundle manifest
  - can omit implementations until explicitly requested

Repo impact:
- new handler under `src/router/` or `src/chains/`
- `infra/codevolve-stack.ts`
- `packages/mcp-server/src/tools.ts`
- benchmark script extension under `scripts/`

Success metric:
- For chain-shaped tasks, first successful local run requires one planning call plus N implementation fetches, not repeated resolve loops
- Median orchestration token cost for chain workflows drops by at least 60%

#### Milestone M3: Rank by agent outcome, not similarity alone

Why:
- Similarity is necessary but not sufficient.
- Agents care about success, portability, and cheap payloads.

Changes:
- Add ranking features:
  - validation success rate
  - recent local execution success
  - portability score
  - implementation size penalty
  - compatibility with caller runtime
  - canonical preference only when quality is proven
- Persist and expose:
  - `portability_score`
  - `compatibility`
  - `avg_payload_bytes`
  - `avg_lookup_latency_ms`
  - `agent_success_rate`

Repo impact:
- `src/router/resolve.ts`
- `src/analytics/consumer.ts`
- `src/analytics/dashboards.ts`
- `src/shared/types.ts`
- storage schema docs

Success metric:
- Top-1 resolved skill is actually used in the next step more often
- Reduce repeated-resolve rate by at least 30%

### Later: make codeVolve a low-friction execution substrate for agents

#### Milestone L1: Portable runtime contract for skills

Why:
- A registry only helps if fetched skills run reliably in arbitrary agent environments.

Changes:
- Define a strict portability contract:
  - runtime
  - OS assumptions
  - external tool dependencies
  - network requirement
  - credential requirement
  - file system expectation
- Add normalized manifests to skill records.
- Reject or down-rank skills that do not meet portability standards.

Success metric:
- 90%+ of “portable” skills run without agent-side manual patching in benchmark harnesses

#### Milestone L2: Prefetch and caching for hot skills and hot intent summaries

Why:
- Once summary-first and exact lookup exist, hot-path caching becomes valuable.

Changes:
- Read cache for `summary` and `implementation_ref` objects
- Optional embedding cache only for fallback semantic lookup
- MCP-side memoization for repeated skill summaries in a session

Success metric:
- Hot exact lookup p95 under 100 ms
- Hot summary retrieval p95 under 80 ms

## Success Metrics To Add Now

These are measurable in this repo and should be added to the benchmark script plus analytics.

### Benchmark metrics

Extend `scripts/benchmark-deploy-skill.mjs` to report:

- time to first usable plan
- time to first implementation bytes
- time to first local execution start
- bytes returned by each API/MCP step
- summary-bytes vs implementation-bytes
- estimated tokens for:
  - request envelopes
  - response payloads
  - MCP wrapper overhead

### Product metrics

Emit and dashboard:

- `resolve_path`: exact | alias | semantic | chain_suggestion
- `retrieval_view`: summary | implementation | full
- `payload_bytes`
- `implementation_bytes`
- `agent_followed_recommendation`
- `repeated_lookup_within_5m`
- `lookup_to_execution_start_ms`
- `local_execution_success`
- `portability_fail_reason`

### Target thresholds

Short-term targets:

- Exact lookup total overhead < 500 ms
- Summary retrieval payload < 20% of current full skill payload
- API first-time orchestration tokens < 1000 for known-skill flow
- MCP experienced-user orchestration tokens < 900

Medium-term targets:

- Chain planning overhead < 800 ms
- Multi-step workflow token reduction > 60% vs current MCP/API path
- Repeated resolve rate down 30%

## Architectural Decisions Currently Fighting The Goal

1. Full-table semantic scan on the hot path
- `src/router/resolve.ts` still scans when language is absent.
   - This makes semantic fallback too expensive to be the default path.

2. Full-skill retrieval as the default read contract
   - `src/registry/getSkill.ts` returns the entire payload instead of enabling cheap staged fetches.

3. Analytics event pollution on reads
   - `src/registry/getSkill.ts` emits `execute` on read.
   - This will corrupt ranking and success metrics.

4. Inconsistent API naming and semantics
- `/intent` vs stale `/resolve` terminology
   - `/execute` documented as execution in some places, but implemented as logging
   - `chain_skills` exposed with conflicting meanings across codepaths

5. MCP surface optimized for parity, not agent leverage
   - It mirrors REST calls instead of collapsing planning work.

6. Analytics not yet tied to the value proposition
   - Existing dashboards cannot prove that codeVolve saved time or tokens versus local work.

## Recommended Execution Order

1. Fix semantics and measurement
   - stop emitting `execute` from `GET /skills/:id`
- standardize on `/intent` and keep `/resolve` only where it is historical or compatibility-scoped
   - extend benchmark script

2. Build exact lookup and summary retrieval
   - this is the fastest path to a real speed/token win

3. Rework MCP around summary-first and explicit implementation fetch
   - this is the fastest path to a real token win

4. Add chain suggestion and chain planning
   - this is the highest-upside path for long-term differentiation

5. Add ranking by portability/success/payload cost
   - this improves outcome quality after the cheaper paths exist

## Immediate Tasks I Would Open

### Short-term

- STALE-01: Canonicalize the agent flow in docs and discovery output
- STALE-02: Remove read-path analytics pollution from `GET /skills/:id`
- STALE-03: Audit and remove stale `/resolve` versus `/intent` naming across API, MCP, tests, and docs
- STALE-04: Audit and remove stale server-execution language across docs, MCP descriptions, and task history
- STALE-05: Audit and remove stale validation-runner language across docs and task history
- AGENT-EFF-01: Remove analytics pollution from `GET /skills/:id`
- AGENT-EFF-02: Add skill summary endpoint and implementation endpoint
- AGENT-EFF-03: Add exact alias/canonical lookup endpoints
- AGENT-EFF-04: Add benchmark reporting for bytes and token overhead
- AGENT-EFF-05: Redesign MCP `get_skill` and `intent` routing for summary-first responses

### Medium-term

- AGENT-EFF-06: Add chain suggestion to intent resolution
- AGENT-EFF-07: Add first-class chain planning endpoint
- AGENT-EFF-08: Add outcome-aware ranking inputs and analytics events
- AGENT-EFF-09: Add portability manifest and compatibility metadata

### Later

- AGENT-EFF-10: Add hot-path read caches for summaries and implementation refs
- AGENT-EFF-11: Add session-level MCP memoization for repeated lookups

## Bottom Line

codeVolve will not beat direct local commands by trying to be a slower indirection layer around code retrieval. It can beat local ad hoc work if it becomes:

- the fastest path to the right skill
- the cheapest path to the minimum useful payload
- the easiest path to a correct chain plan

That means exact lookup, summary-first retrieval, chain planning, and ranking by agent outcome should be the core roadmap, in that order.
