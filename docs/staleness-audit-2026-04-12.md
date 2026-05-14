# codeVolve Staleness Audit

Date: 2026-04-12
Author: Codex
Status: Open

## Purpose

This audit captures recurring stale references caused by partial migration from the older `/resolve` plus server-execution model to the current exact lookup or `/intent` plus local-execution model.

The goal is to stop rediscovering the same smell in reviews and planning discussions.

## Summary

The repo currently has four major classes of drift:

1. Route-name drift
   - `/resolve` still appears in active docs even though `/intent` is the canonical routing concept
2. MCP-name drift
   - `resolve_skill` and `validate_skill` still describe an older surface
3. Execution-model drift
   - many docs still imply server-side execution or chain execution
4. Validation-model drift
   - several docs and task descriptions still imply server-side test runners

## Highest-Priority Findings

### 1. MCP still presents stale route naming

Evidence:
- `packages/mcp-server/src/index.ts`
- `packages/mcp-server/src/tools.ts`
- `tests/unit/mcp/server.test.ts`
- `tests/unit/mcp/tools.test.ts`

Why it matters:
- The API has already moved toward `/intent`, but some user-facing docs and MCP surfaces still use `resolve_skill` or `/resolve`.
- That keeps the old mental model alive and makes cleanup harder.

Recommended action:
- Canonicalize on `intent` as the routing concept
- Keep a compatibility alias only if needed, then remove it on a schedule

### 2. Read path emits execute analytics

Evidence:
- `src/registry/getSkill.ts`

Why it matters:
- A read is being recorded as an execution.
- This corrupts agent-behavior metrics, ranking inputs, and any future “did codeVolve save work?” analysis.

Recommended action:
- Remove the event entirely or replace it with an explicit retrieval/read event type

### 3. Docs still describe server-side execution

Evidence:
- `docs/api.md`
- `docs/architecture.md`
- `CLAUDE.md`
- `.claude/agents/*.md`
- `docs/platform-design.md`

Examples:
- `/execute` described as if it runs code
- `/execute/chain` described as if server-side orchestration executes the chain
- architecture diagrams still show execution and validation layers with runner infrastructure

Why it matters:
- This is the most visible recurring smell.
- It causes new work to be specified against the wrong architecture.

Recommended action:
- Rewrite the public and internal docs around one canonical flow:
  - intent or exact lookup
  - summary fetch
  - implementation fetch
  - local execution
  - feedback

### 4. Docs and task history still describe server-side validation runners

Evidence:
- `docs/api.md`
- `docs/architecture.md`
- `tasks/todo.md`

Why it matters:
- Validation semantics directly affect confidence scores and canonical promotion.
- If the contract is ambiguous, ranking and trust signals become ambiguous too.

Recommended action:
- Decide whether the concept remains `validate` or becomes `feedback`
- Rewrite all surfaces to match the actual caller-reported model

## Secondary Findings

### 5. Discovery and docs do not present the same product model

Evidence:
- `src/registry/discovery.ts`
- `docs/api.md`
- `CLAUDE.md`

Why it matters:
- Agents bootstrap from discovery and MCP, not just human docs.
- A stale discovery surface makes every new agent integration worse.

Recommended action:
- Treat discovery, MCP, and API docs as one change set whenever naming or semantics change

### 6. Historical task descriptions are still bleeding into current planning

Evidence:
- `tasks/todo.md`

Why it matters:
- The file mixes historical completion notes, correction notes, and future tasks.
- That is fine for audit history, but bad as an operational source of truth when stale descriptions remain near active tasks.

Recommended action:
- Keep historical notes, but add a dedicated canonical current model section near the top of `tasks/todo.md`
- Mark superseded execution-model tasks more aggressively

## Cleanup Workstream

### Wave 1: Semantics and metrics

- Remove read-path `execute` emission from `src/registry/getSkill.ts`
- Decide canonical route naming: `intent` vs `resolve`
- Decide canonical feedback naming: `validate` vs `feedback`
- Update benchmark harness to reflect the canonical flow

### Wave 2: MCP and discovery

- Rename or alias MCP tools to the canonical concepts
- Update `src/registry/discovery.ts`
- Update MCP tests to match the canonical names

### Wave 3: Docs and task history

- Rewrite `docs/api.md`
- Rewrite `docs/architecture.md`
- Rewrite `CLAUDE.md`
- Add a current-model section to `tasks/todo.md`

## Rule To Prevent Recurrence

Any future rename or execution-model change should be considered incomplete until the same PR or task updates all of:

1. API route wiring
2. MCP tool/resource names
3. discovery document
4. public docs
5. internal architecture docs
6. tests
7. task tracker notes

If one of those is intentionally deferred, the deferral should be listed explicitly in the task, not left implicit.
