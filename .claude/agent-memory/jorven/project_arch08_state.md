---
name: project_arch08_state
description: ARCH-08 validation/evolve/canonical design (2026-03-22): key decisions, runner reuse, confidence formula, sub-task breakdown for IMPL-11/12/13
type: project
---

## ARCH-08 — Completed 2026-03-22

### Key decisions

1. **Runner reuse for /validate:** reuses `codevolve-runner-python312` and `codevolve-runner-node22` from IMPL-06 (same InvokeCommand pattern). No new runner infrastructure in Phase 4.

2. **Confidence formula:** `pass_count / total_tests` (simple ratio). Zero tests = 0.0. All pass = 1.0. additional_tests count toward score but are not persisted.

3. **Status transitions after /validate:** pass_rate 0 + empty impl = unsolved; pass_rate 0 + impl = partial; 0 < pass_rate < 1 = partial; pass_rate 1.0 = verified (or stays optimized).

4. **Canonical gate:** confidence >= 0.85 AND test_fail_count === 0 AND status in {verified, optimized} AND not archived AND not already canonical. Uses DynamoDB TransactWriteItems (promote + demote + update problems table — up to 3 items).

5. **/evolve consumer:** SQS FIFO (codevolve-gap-queue.fifo), batchSize 1, 5 min Lambda timeout. Calls Claude API (claude-sonnet-4-6) from Secrets Manager key. Writes to codevolve-evolve-jobs table (new, Phase 4). Auto-invokes ValidateFn async after creating skill.

6. **New DynamoDB attributes on codevolve-skills:** `last_validated_at` (S), `test_pass_count` (N), `test_fail_count` (N). Ada adds these in IMPL-11-A.

7. **New table:** `codevolve-evolve-jobs` (PK: evolve_id, GSI: status+created_at, 30-day TTL). Ada adds schema to dynamo-schemas.md in IMPL-12-A.

### Output files

- `docs/validation-evolve.md` — full spec
- `docs/decisions.md` — ADR-009
- `tasks/todo.md` — IMPL-11, IMPL-12, IMPL-13 sub-tasks added

### Sub-task structure

- IMPL-11 (4 sub-tasks A-D): deepEqual utility + schema update, CDK, handler, integration tests
- IMPL-12 (5 sub-tasks A-E): schema + package, CDK, Claude client + parser, SQS handler, smoke test
- IMPL-13 (3 sub-tasks A-C): CDK, promotion gate (pure function), handler

### Dependency order

IMPL-11 must complete before IMPL-12 and IMPL-13 (both need test_pass_count/test_fail_count).
IMPL-12 and IMPL-13 can run in parallel after IMPL-11.
