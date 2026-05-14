---
name: project_execution_model_change
description: Architecture switched from Lambda execution runners to local CLI tool model — ALIGN-01 through ALIGN-11 tasks written 2026-04-07, full audit complete
type: project
---

## Execution Model Change (confirmed 2026-04-07)

The project switched from a server-side Lambda execution runner model to a local CLI tool model. This is now the authoritative architecture documented in CLAUDE.md.

### What changed
- Skills are local CLI tools. The registry provides discoverability and retrieval only.
- Execution is always the caller's responsibility, in their own environment.
- There is NO Lambda runner (`codevolve-runner-python312`, `codevolve-runner-node22`).
- There is NO server-side sandboxed execution of user-submitted skill code.
- `/execute` endpoint: logs the run and updates analytics only — does NOT run any skill code.
- `/validate` endpoint: implemented as caller-reported `pass_count / fail_count / total_tests` (not runner Lambda invocation).

### Current codebase alignment (audit 2026-04-07)

- `src/execution/execute.ts` — CLEAN. Correctly logs run and emits Kinesis event. No runner invocation.
- `src/validation/handler.ts` — CLEAN. Correctly accepts caller-reported results.
- `src/evolve/handler.ts` — MOSTLY CLEAN. Has no Lambda invocation, but comments/docblock say it should invoke a validate Lambda (step 8). That step was never implemented.
- `tests/unit/runners/node22-sandbox.test.js` — BROKEN. Imports `src/runners/node22/handler.js` which does not exist. Will fail.
- `tests/unit/evolve/handler.test.ts` — BROKEN. Two test cases assert `mockLambdaSend` was called, but the handler never invokes a Lambda. Tests will fail.
- `docs/execution-sandbox.md` — STALE. Entire document describes old runner model. Should be deleted.
- `docs/architecture.md` — STALE. Hard Rule 3 and Lambda Functions table still mention runner Lambdas.
- `docs/validation-evolve.md` — STALE. Sections 1 and 2 still describe runner Lambda invocation for validate.
- `docs/decisions.md` — INCOMPLETE. ADR-006 (Lambda sandbox) not marked superseded. No ADR documenting the model switch.
- `infra/codevolve-stack.ts` line 873 — BROKEN. `/evolve` API Gateway resource has no POST method wired — orphaned resource.
- `codevolve-cache` DynamoDB table — PROVISIONED BUT UNUSED. No Lambda reads from or writes to it.

### Cleanup tasks (ALIGN-01 through ALIGN-11 in tasks/todo.md)

- **ALIGN-01** (Ada): Delete `tests/unit/runners/` directory and `node22-sandbox.test.js`.
- **ALIGN-02** (Ada): Delete `docs/execution-sandbox.md`.
- **ALIGN-03** (Jorven): Rewrite Hard Rule 3 and Lambda Functions table in `docs/architecture.md`.
- **ALIGN-04** (Jorven): Rewrite stale runner sections in `docs/validation-evolve.md`.
- **ALIGN-05** (Jorven): Write ADR-012 (model switch); mark ADR-006 Superseded.
- **ALIGN-06** (Ada): Delete broken Lambda invocation tests in `tests/unit/evolve/handler.test.ts` (lines 242 and 389).
- **ALIGN-07** (Ada): Audit remaining handler.test.ts cases after ALIGN-06.
- **ALIGN-08** (Jorven): Mark IMPL-11-B and IMPL-11-C Complete in todo.md.
- **ALIGN-09** (Jorven): Correct IMPL-12-D description in todo.md (remove "async ValidateFn invocation").
- **ALIGN-10** (Ada): Annotate unused `codevolve-cache` table in CDK and architecture doc.
- **ALIGN-11** (Ada): Fix orphaned `/evolve` API Gateway resource in CDK stack.
