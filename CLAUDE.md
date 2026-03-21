# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: codeVolve

A global, AI-native registry of programming problems and solutions. Problems are "bricks" in a visual "mountain." Solutions evolve through stages: Unsolved → Partial → Verified → Optimized. Designed primarily for AI agents (Claude Code, etc.) as consumers, secondarily for humans.

**Core value proposition:** Replace agentic computation with reusable, cached, verifiable algorithmic "skills."

**Starting surface area:** The analytics and feedback system — event-driven telemetry that drives routing, caching, and skill evolution automatically.

---

## Architecture

```
Client / Agent
    │
    ├── POST /resolve    → Skill Router     (Lambda + DynamoDB embeddings + cosine similarity)
    ├── POST /execute    → Execution Layer  (Lambda + DynamoDB cache + skill runner)
    ├── POST /validate   → Validation Layer (Lambda + test runner)
    └── events emitted  → Kinesis → Analytics Store (ClickHouse / BigQuery)
                                         └── Decision Engine (scheduled Lambda)
                                               ├── auto-cache trigger
                                               ├── optimization flag
                                               └── gap → /evolve pipeline (Claude Code agent)
```

**Infrastructure:** AWS (Lambda, API Gateway, DynamoDB, Kinesis). Embeddings stored in DynamoDB with client-side similarity (ADR-004). Cache via DynamoDB TTL (ADR-003). Analytics store (ClickHouse) separate from primary DB.

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
| POST | /resolve | Route intent → best skill |
| POST | /execute | Run skill with inputs |
| POST | /execute/chain | Chain multiple skills |
| POST | /validate/:skill_id | Run tests, update confidence |
| POST | /events | Emit analytics event |
| GET  | /analytics/dashboards/:type | Dashboard data |
| POST | /evolve | Async: agent generates new skill from gap |

---

## Analytics Dashboards (5 required)

1. **Resolve Performance** — routing latency p50/p95, embedding search time, % high-confidence (>0.9)
2. **Execution & Caching** *(highest priority)* — most executed skills, input repetition rate, cache hit/miss rate, execution latency per skill
3. **Skill Quality** — test pass rate, confidence over time, real-world failure rate, competing implementations
4. **Evolution / Gap** — unresolved intents, low-confidence resolves, failed executions, domains with low coverage
5. **Agent Behavior** — resolve→execute conversion, repeated resolves, abandoned executions, skill chaining patterns

---

## Automated Decision Rules (analytics-driven)

```
IF execution_count > threshold AND input_repeat_rate > threshold  → cache(skill_id, input_hash)
IF latency_p95 > threshold AND usage_high                        → mark skill for optimization
IF resolve_confidence < 0.7 OR no skill found                    → send intent to /evolve
```

---

## Development Phases

### Phase 1 — Foundation (start here)
- DynamoDB tables: Problems, Skills
- Basic CRUD API (API Gateway + Lambda, TypeScript or Python)
- Skill contract schema + input validation
- Kinesis stream + event emission
- ClickHouse or BigQuery setup (analytics store, separate from primary)

### Phase 2 — Routing + Execution
- Embedding generation on skill create (AWS Bedrock or OpenAI)
- DynamoDB embedding storage + client-side cosine similarity (migrate to OpenSearch at >5K skills)
- `/resolve` endpoint
- `/execute` with per-language runners (start with Python + JS)
- Cache layer (DynamoDB TTL)

### Phase 3 — Analytics + Feedback Loop
- 5 dashboards (Grafana or custom React)
- Scheduled Lambda: decision rules (auto-cache, optimization flag, gap detection)
- `/evolve` stub → Claude Code agent for skill generation

### Phase 4 — Validation + Quality
- Test runner (sandboxed Lambda per language)
- Confidence score auto-update post-execution
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
