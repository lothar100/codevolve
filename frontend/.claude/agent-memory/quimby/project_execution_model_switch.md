---
name: execution_model_switch
description: Architecture switched from server-side Lambda runners to local CLI tool model; impacts IMPL-06, IMPL-07, IMPL-11, IMPL-12, and all ALIGN tasks
type: project
---

As of 2026-04-07, the codeVolve execution model changed from server-side Lambda runners to a local CLI tool model. Key impacts:

- `/execute` no longer invokes any runner Lambda. It logs the run and updates analytics only. The caller runs the skill locally.
- `/validate` runner Lambda invocation is stale. BETA-07 is the task to redesign the validate contract.
- `src/runners/` and `tests/unit/runners/` were deleted.
- `docs/execution-sandbox.md` was deleted.
- ADR-012 was written documenting the switch. ADR-006 (Lambda sandbox) is superseded.
- 11 ALIGN tasks (ALIGN-01 through ALIGN-11) were created and implemented to clean up drift. They are pending Iris review as of session end.
- BETA-01 (SSRF in runner sandbox) was cancelled — attack surface eliminated by design.

Lesson: When the execution model changes, run a Jorven audit pass immediately across tasks, docs, src, infra, and tests before further implementation.
