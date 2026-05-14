---
name: project_arch06_state
description: ARCH-06 execution sandbox design completed 2026-03-21. Documents key decisions, open items for Ada, and status of Phase 2 architecture work so far.
type: project
---

## Context

ARCH-06 was designed on 2026-03-21. Phase 1 is complete (IMPL-01 through IMPL-04 all verified/approved). Phase 2 architecture work:
- ARCH-05: [✓] vector search — `docs/vector-search.md`, ADR-005 written
- ARCH-06: [✓] execution sandbox — `docs/execution-sandbox.md`, ADR-006 written

## Key ARCH-06 Decisions

1. **Sandbox model:** Separate Lambda per language (`codevolve-runner-python312`, `codevolve-runner-node22`). Not Docker/Fargate. IAM-enforced isolation (CloudWatch Logs only on runners). 10-second hard Lambda timeout.

2. **Cache write policy:** Cache writes are Decision Engine-controlled (IMPL-10), not on every `/execute` miss. Phase 2 uses an `auto_cache` flag on the skill record to signal when `/execute` should write to cache. This is consistent with `dynamo-schemas.md` §3 and `api.md` side effects for `/execute`.

3. **Error taxonomy HTTP status codes:** Use `api.md` as authoritative. `408 EXECUTION_TIMEOUT`, `422 EXECUTION_FAILED` (runtime + validation), `504 EXECUTION_OOM` (new code — Ada must add to `api.md` as part of IMPL-06), `500 INTERNAL_ERROR`.

4. **Skill implementation convention:** All skill code must define a function named `solve`. This is the runner entrypoint contract. Both the Python and Node runners call `solve(**inputs)` / `solve(inputs)`.

5. **input_hash:** SHA-256 of canonical JSON (keys sorted recursively). `canonicalJson` and `computeInputHash` utility functions go in `src/execution/inputHash.ts`.

6. **execution_count and latency updates on skill record:** Only on actual runner invocations (cache misses), not cache hits. Fire-and-forget after response is prepared.

## Open Items for Ada (IMPL-06 + IMPL-07)

- Add `504 EXECUTION_OOM` error code to `/execute` error table in `docs/api.md`.
- Runner files (`src/runners/python312/handler.py`, `src/runners/node22/handler.js`) are NOT TypeScript — CDK must bundle them with their respective runtimes separately from the main esbuild bundle.
- Environment variables on `/execute` Lambda: `RUNNER_LAMBDA_PYTHON`, `RUNNER_LAMBDA_NODE` — injected by CDK, not hardcoded.
- `skill_version` field in cache write: use `version_label` string (semver) — N-NEW-01 from REVIEW-02 is still open; do not change field type without a schema update.

## Phase 2 Implementation Status

| ID | Status | Unblocked? |
|----|--------|-----------|
| ARCH-05 | [✓] | Yes |
| ARCH-06 | [✓] | Yes |
| IMPL-05 | [ ] | Blocked on ARCH-05 review (Iris must verify) |
| IMPL-06 | [ ] | Unblocked — ARCH-06 complete |
| IMPL-07 | [ ] | Unblocked — ARCH-06 complete |
