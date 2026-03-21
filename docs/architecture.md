# codeVolve — Architecture

> Maintained by Quimby. Updated after each architectural change. Source of truth for system structure.

---

## System Overview

codeVolve is an AI-native registry of programming problems and solutions ("skills"). The platform is designed primarily for AI agent consumption — agents resolve intents to canonical skills, execute them, and contribute improvements back. The feedback loop drives continuous improvement: more usage → better analytics → better routing → less agentic computation.

---

## Request Flow

```
Client / Agent
    │
    ├── POST /resolve    → Skill Router     (Lambda + OpenSearch Serverless + DynamoDB tag filter)
    │                                        Returns: { skill_id, confidence, skill }
    │
    ├── POST /execute    → Execution Layer  (Lambda + ElastiCache/DynamoDB cache + sandboxed runner Lambda)
    │                                        Returns: { outputs, latency_ms, cache_hit }
    │
    ├── POST /validate   → Validation Layer (Lambda + per-language Docker test runner)
    │                                        Returns: { pass_rate, test_results, confidence_score }
    │
    ├── POST /evolve     → Evolution Layer  (Lambda + SQS + Claude API — async)
    │                                        Returns: 202 Accepted, { job_id }
    │
    └── All handlers → Kinesis Data Stream
                              └── Analytics Consumer Lambda
                                        └── ClickHouse / BigQuery
                                                  └── Decision Engine Lambda (EventBridge, scheduled)
                                                            ├── auto-cache trigger → ElastiCache
                                                            ├── optimization flag → DynamoDB
                                                            ├── gap detection → SQS GapQueue → /evolve
                                                            └── archive evaluation → SQS ArchiveQueue → archive Lambda
```

---

## AWS Resources

| Resource | Type | Purpose |
|----------|------|---------|
| `codevolve-problems` | DynamoDB | Problem records |
| `codevolve-skills` | DynamoDB | Skill records |
| `codevolve-cache` | DynamoDB (TTL) or ElastiCache | Input/output cache |
| `codevolve-archive` | DynamoDB | Archived problems and skills |
| OpenSearch Serverless | OpenSearch | Skill embeddings for /resolve |
| Kinesis Data Stream | Kinesis | Analytics event pipeline |
| ClickHouse / BigQuery | Analytics store | All analytics events (separate from primary DB) |
| SQS GapQueue | SQS | Unresolved intents queued for /evolve |
| SQS ArchiveQueue | SQS | Archive decisions queued for archive Lambda |
| EventBridge | Scheduler | Triggers Decision Engine Lambda every 5 minutes |
| Bedrock (Titan Embeddings v2) | AI | Embedding generation for skills |
| Claude API (claude-sonnet-4-6) | AI | Skill generation in /evolve only |

---

## Lambda Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `registry-handler` | API Gateway | Skill + Problem CRUD |
| `router-handler` | API Gateway | /resolve |
| `execution-handler` | API Gateway | /execute |
| `validation-handler` | API Gateway | /validate |
| `evolve-handler` | API Gateway + SQS | /evolve (async) |
| `archive-handler` | SQS (ArchiveQueue) | Archive/unarchive skills and problems |
| `analytics-consumer` | Kinesis | Events → ClickHouse/BigQuery |
| `decision-engine` | EventBridge (5-min) | Auto-cache, optimization flags, gap detection, archive evaluation |
| `skill-runner-python` | Lambda (invoked by execution-handler) | Sandboxed Python skill execution |
| `skill-runner-node` | Lambda (invoked by execution-handler) | Sandboxed Node.js skill execution |

---

## Source Layout

```
src/
  registry/       ← Skill + Problem CRUD (DynamoDB)
  router/         ← /resolve (OpenSearch + tag filter, no LLM)
  execution/      ← /execute (cache + sandboxed runner invocation)
  validation/     ← /validate (test runner)
  analytics/      ← dashboard endpoints + analytics consumer
  evolve/         ← /evolve (Claude API — only LLM usage in codebase)
  archive/        ← archive mechanism
  shared/         ← types, DynamoDB client, Kinesis emitter, zod schemas, errors
infra/            ← AWS CDK stacks and constructs
tests/            ← Jest unit + integration tests (mirrors src/ structure)
docs/             ← Architecture, API contracts, design docs, decisions
tasks/            ← Task tracker and lessons
```

---

## Hard Architectural Rules

1. Analytics events → Kinesis only. Never write analytics to DynamoDB primary tables.
2. LLM calls (Claude API) → `src/evolve/` only. Never in `/resolve` or `/execute` paths.
3. Skill execution → sandboxed Lambda only. No network access, no filesystem writes.
4. Archive → `status: "archived"` flag only. Never hard-delete records.
5. ClickHouse/BigQuery → append-only. No analytics record deletion, even for archived skills.
6. Canonical promotion → requires `confidence >= 0.85` AND all tests passing.
7. `/resolve` → pre-computed embeddings only. No real-time embedding at query time.

---

*Last updated: 2026-03-20 — initial bootstrap*
