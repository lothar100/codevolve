# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: codeVolve

A global registry of reusable CLI tools and scripts. Problems are "bricks" in a visual "mountain." Solutions evolve through stages: Unsolved → Partial → Verified → Optimized. Designed primarily for AI agents (Claude Code, etc.) as consumers, secondarily for humans.

**Core value proposition:** Save Claude API token usage by replacing agentic computation with pre-written, retrievable scripts. Instead of asking Claude to reason through a task from scratch, use exact lookup or intent routing to get a summary, fetch the implementation only if needed, and run it locally.

**Execution model:** Skills are local CLI tools — scripts that run in the caller's own environment using their own credentials, filesystem, and installed tools. The registry provides discoverability and retrieval; execution is always the caller's responsibility. There is no Lambda runner or sandboxed execution layer.

## Named Project Agents

This repo defines five named project agents and they should be preferred over generic role agents whenever the task clearly matches their remit:

- `Jorven` for architecture, planning, API contracts, AWS system design, and task decomposition
- `Ada` for implementation, bug fixing, tests, and scoped code changes
- `Iris` for review, verification, correctness, security, and edge cases
- `Amber` for platform design, contributor workflow UX, dashboard and policy design, and API ergonomics
- `Quimby` for documentation, task tracking, summaries, and lessons learned

If a request fits one of these roles, route to the named agent first. Use generic planner, worker, reviewer, designer, or reporter agents only when no named codeVolve agent is a clear fit.

---

## Architecture

```
Client / Agent (local machine)
    │
    ├── Exact lookup or intent routing
    │                      returns skill summary + implementation ref
    ├── Fetch implementation only if needed
    ├── Execute locally in the caller's environment
    ├── Record execution report / feedback
    ├── Record feedback / confidence update
    └── events emitted  → Kinesis → Analytics Store (ClickHouse / BigQuery)
                                         └── Decision Engine (scheduled Lambda)
                                               ├── ranking and portability signals
                                               ├── optimization flag
                                               └── gap → /evolve pipeline (Claude Code agent)

Skill lifecycle:
  exact lookup or intent → summary → implementation fetch if needed → run locally → feedback
```

**Infrastructure:** AWS (API Gateway, DynamoDB, Kinesis). Embeddings stored in DynamoDB with client-side similarity (ADR-004). Analytics store (ClickHouse) separate from primary DB. No Lambda execution runners.

---

## Core Data Models

### Skill (DynamoDB)
```json
{
  "skill_id": "uuid",
  "problem_id": "uuid",
  "name": "string",
  "description": "string",
  "version": "semver",
  "is_canonical": "boolean",
  "status": "unsolved | partial | verified | optimized",
  "language": "string",
  "domain": ["string"],
  "tags": ["string"],
  "inputs": [{ "name": "string", "type": "string" }],
  "outputs": [{ "name": "string", "type": "string" }],
  "examples": [{ "input": {}, "output": {} }],
  "tests": [{ "input": {}, "expected": {} }],
  "implementation": "string | s3_ref",
  "confidence": "number (0–1)",
  "latency_p50_ms": "number",
  "latency_p95_ms": "number"
}
```

### Analytics Event (ClickHouse / BigQuery)
```json
{
  "event_type": "resolve | execute | validate | fail",
  "timestamp": "ISO8601",
  "skill_id": "string",
  "intent": "string",
  "latency_ms": "number",
  "confidence": "number",
  "cache_hit": "boolean",
  "input_hash": "string",
  "success": "boolean"
}
```

---

## API Surface

| Method | Path | Description |
|--------|------|-------------|
| POST | /skills | Create skill |
| GET  | /skills/:id | Get skill |
| GET  | /skills | List/filter by tag, language, domain |
| POST | /skills/:id/promote-canonical | Set as canonical |
| POST | /problems | Create problem |
| GET  | /problems/:id | Problem + all skills |
| POST | /intent | Route intent → best skill summary |
| POST | /execute | Record local execution report |
| POST | /execute/chain | Record local chain execution report |
| POST | /validate/:skill_id | Record local test feedback and update confidence |
| POST | /events | Emit analytics event |
| GET  | /analytics/dashboards/:type | Dashboard data |
| POST | /evolve | Async: agent generates new skill from gap |

---

## Analytics Dashboards (5 required)

1. **Resolve Performance** — routing latency p50/p95, embedding search time, % high-confidence (>0.9)
2. **Retrieval Efficiency** *(highest priority)* — exact lookup rate, summary-first retrieval rate, payload size, repetition rate, local execution latency
3. **Skill Quality** — test pass rate, confidence over time, real-world failure rate, competing implementations
4. **Evolution / Gap** — unresolved intents, low-confidence resolves, failed executions, domains with low coverage
5. **Agent Behavior** — intent→local execution conversion, repeated lookups, abandoned runs, skill chaining patterns

---

## Automated Decision Rules (analytics-driven)

```
IF intent_repetition > threshold AND usage_high                        → prioritize summary caching or prefetching
IF latency_p95 > threshold AND usage_high                        → mark skill for optimization
IF intent_confidence < 0.7 OR no skill found                     → send intent to /evolve
```

---

## Development Phases

### Phase 1 — Foundation (start here)
- DynamoDB tables: Problems, Skills
- Basic CRUD API (API Gateway + Lambda, TypeScript or Python)
- Skill contract schema + input validation
- Kinesis stream + event emission
- ClickHouse or BigQuery setup (analytics store, separate from primary)

### Phase 2 — Routing + Retrieval
- Embedding generation on skill create (AWS Bedrock or OpenAI)
- Exact lookup by alias / canonical key, plus intent routing fallback
- Summary-first retrieval by default
- Implementation fetch only when needed
- Token-aware ranking and payload sizing

### Phase 3 — Analytics + Feedback Loop
- 5 dashboards (Grafana or custom React)
- Scheduled Lambda: decision rules (auto-cache, optimization flag, gap detection)
- `/evolve` stub → Claude Code agent for skill generation

### Phase 4 — Validation + Quality
- Caller-reported local test feedback
- Confidence score auto-update from feedback
- Canonical promotion logic

### Phase 5 — Visualization + Scale
- Mountain visualization (Three.js / WebGL)
- Community auth + contributions
- Agent SDK / MCP server wrapper
- Edge caching

---

## Bootstrap Strategy

- Seed ~100 well-known problems (LeetCode-style) across 5–10 domains
- Use Claude Code to generate initial skill implementations
- Run `/validate` to establish baseline confidence scores
- Mark highest-confidence implementations as canonical

## Key Design Rules

- Prefer algorithmic execution over agentic reasoning
- Use agents only for: generating new skills, improving weak ones
- Never store analytics events in primary DynamoDB tables
- All skills must have passing tests before `is_canonical = true`
- Confidence threshold < 0.7 always triggers `/evolve`
