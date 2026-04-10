# codeVolve — Lessons Learned

> Maintained by Quimby. Append-only — never remove or edit past entries.

---

## L-000: Bootstrap — Project Setup

**Date:** 2026-03-21
**Phase:** Pre-Phase 1
**Category:** Process

**What happened:**
The codeVolve project was bootstrapped on 2026-03-20. Several foundational decisions were made before any implementation began:

1. **Project structure established.** The repository was organized with `docs/` (architecture, decisions, API reference, platform design, archive policy) and `tasks/` (todo, lessons). Stub files were created for each document with correct headers and ownership annotations so that each agent knows where to write.

2. **AWS infrastructure choices locked in.** AWS account 178778217786 in region us-east-2 was selected, with IAM user `codevolve-dev` created for development. The tech stack was defined: TypeScript on Node.js 22, AWS CDK v2, DynamoDB (on-demand), OpenSearch Serverless, Kinesis Data Streams, ClickHouse or BigQuery for analytics, Bedrock Titan Embeddings v2, and Claude API (claude-sonnet-4-6) restricted to the `/evolve` path only.

3. **Task tracking system designed with agent-based workflow.** Five specialized agents were defined: Jorven (architecture), Amber (platform design), Ada (implementation), Quimby (documentation), and Iris (review). Each agent has a dedicated agent definition file under `.claude/agents/` with explicit rules, responsibilities, and output locations. Tasks in `tasks/todo.md` are assigned by agent and tracked with a five-state status system (`[ ]` Planned, `[~]` In Progress, `[!]` Blocked, `[✓]` Verified, `[x]` Complete). No task can be marked Complete without Iris review.

4. **Analytics-first approach chosen as the starting surface area.** Rather than beginning with routing or execution, the project chose to build the analytics and feedback system first. The rationale: event-driven telemetry drives routing, caching, and skill evolution automatically, so instrumenting early ensures data flows from day one. All seven hard architectural rules were documented in `docs/architecture.md` before any implementation task was created.

5. **Agent parallelization planned for Phase 1 design work.** Architecture tasks (Jorven: ARCH-01 through ARCH-04) and design tasks (Amber: DESIGN-01 through DESIGN-03) were structured to run in parallel with no mutual blockers. Documentation tasks (Quimby: DOCS-01, DOCS-02) also run independently. Implementation tasks (Ada: IMPL-01 through IMPL-04) are deliberately sequential and blocked on architecture completion, enforcing the "plan before build" principle.

6. **Archive-is-never-deletion principle established.** The archive policy (`docs/archive-policy.md`) codified that archived records are flagged `status: "archived"` and excluded from routing and search, but never hard-deleted. ClickHouse/BigQuery analytics events for archived skills are never deleted. All archive decisions are reversible via `POST /skills/:id/unarchive`.

**What we learned:**
- Defining agent responsibilities and output locations before any work begins eliminates ambiguity about who writes what and where. Each agent has a single source of truth to update.
- Structuring tasks with explicit blocking dependencies (e.g., IMPL-02 depends on ARCH-01 and ARCH-02) prevents premature implementation and makes parallelism safe.
- Documenting hard architectural rules early (analytics separation, no LLM in resolve path, sandboxed execution, archive-not-delete) prevents drift as the system grows. These rules were written into both `CLAUDE.md` and `docs/architecture.md` so every agent sees them regardless of entry point.
- Choosing a separate analytics store (ClickHouse/BigQuery) from the primary database (DynamoDB) from the start avoids a painful migration later. This was worth deciding before any tables exist.

**Action taken:**
- Created `tasks/todo.md` with full Phase 1-5 task breakdown (39 tasks across 5 agents).
- Created `docs/` stubs: `architecture.md`, `decisions.md`, `api.md`, `platform-design.md`, `archive-policy.md`.
- Created `.claude/agents/` definitions for all five agents.
- Documented seven hard architectural rules in `docs/architecture.md`.
- Established archive principles in `docs/archive-policy.md`.
- Rule: Always review `tasks/todo.md` at session start before invoking any agent.

---

### L-005: Parallel worktrees for CDK-touching tasks

**Observation:** When multiple Ada agents implement tasks that both modify `infra/codevolve-stack.ts`, dispatching them to the same working tree causes file conflicts. Starting Phase 2, IMPL-05 and IMPL-06 are dispatched in parallel to isolated git worktrees.
**Rule:** When multiple implementation tasks modify the same CDK stack file, always use isolated git worktrees per agent. Merge CDK changes manually after agent completion.
**Action:** Adopted isolated git worktree dispatch pattern for Phase 2 (IMPL-05/IMPL-06 parallel dispatch). Recorded as standard procedure.

---

### L-006: Cache and execute in same phase

**Observation:** The cache layer (IMPL-07) and execute endpoint (IMPL-06) share the same DynamoDB table (`codevolve-cache`) and the same `getCachedOutput`/`writeCachedOutput` interface. Implementing them in parallel worktrees means each worktree holds its own copy of `cache.ts` during development.
**Rule:** When two parallel tasks share an interface or table, identify the canonical owner at dispatch time (IMPL-07 owns `src/cache/cache.ts`). The non-owning task (IMPL-06) works from a local copy in its worktree and reconciles at merge. Never let the non-owning task's copy become the merged artifact.
**Action:** IMPL-07 designated as canonical owner of `src/cache/cache.ts`. IMPL-06 worktree uses a temporary local copy for compilation; both are reconciled at merge time.

---

---

### L-001: Worktree agents do not auto-commit — files must be manually copied to main repo

**Observation:** Worktree agents (dispatched for Phase 3 parallel implementation) write files into their worktree directory but do not automatically commit or push. Files existed in the worktree but were absent from the main branch until manually copied.
**Rule:** After every worktree agent completes, always manually copy output files from the worktree directory to the main repo before committing. Never assume worktree writes are visible in the main branch.
**Action:** Procedure documented here. Worktree dispatch instructions updated to include an explicit copy-and-commit step.

---

### L-002: Keep handler.ts as a stub when splitting implementation across worktree agents

**Observation:** When Phase 3 implementation was split across multiple worktree agents (one per rule file), each agent attempted to wire up `handler.ts` independently. This produced conflicting versions of the handler that could not be merged cleanly.
**Rule:** When splitting implementation across worktree agents, designate `handler.ts` (or any top-level orchestrator file) as a stub owned by the main repo. Wire it up in the main repo only after all rule files from all worktrees have been copied over.
**Action:** Phase 3 worktree dispatch revised to keep `handler.ts` as a stub. Final wiring performed in the main repo after merge.

---

### L-003: DynamoDB GSI queries do not support IN (...) conditions — issue one query per status value

**Observation:** An attempt to filter a DynamoDB GSI query using an `IN (...)` condition (e.g., `status IN ("partial", "verified")`) failed at runtime. DynamoDB condition expressions do not support the `IN` operator on key attributes in GSI queries.
**Rule:** Never use `IN (...)` in DynamoDB GSI key conditions. When filtering on multiple discrete values of a GSI key, issue one query per value and merge the results in Lambda.
**Action:** Decision Engine implementation revised to issue one DynamoDB query per status value. Recorded as a hard constraint for all future GSI usage.

---

## Session: 2026-03-21 Phase 2 Kick-off

- Phase 1 complete: IMPL-01 through IMPL-04 all [✓] Verified, all FIX tasks done
- Phase 2 started: IMPL-05 (/resolve), IMPL-06 (/execute), IMPL-07 (cache) dispatched in parallel worktrees
- Architecture complete: ARCH-05, ARCH-06, REVIEW-06-ARCH all approved
- ARCH-07 (Decision Engine) and DESIGN-04 (mountain visualization) now being designed in parallel
- Next: merge worktree results, run Iris review (REVIEW-05-IMPL05, REVIEW-07)

---

### L-004: Architecture drift accumulates silently and must be audited when the model changes

**Observation:** After the execution model switched from server-side Lambda runners to local CLI tools, stale references accumulated across 11 distinct locations: task descriptions, doc files, test mocks, CDK constructs, and source handlers. No single agent caught all of them during normal implementation. The drift was only found through a dedicated Jorven audit pass run against both tasks and code simultaneously.
**Rule:** Whenever the execution model or a foundational architectural assumption changes, immediately dispatch a Jorven audit pass covering tasks/todo.md, docs/, src/, infra/, and tests/ before any further implementation work proceeds. Do not assume implementation agents will self-identify drift.
**Action:** 11 ALIGN tasks created and dispatched in parallel. ADR-012 written recording the model change. docs/architecture.md, docs/validation-evolve.md, docs/decisions.md rewritten. Stale tests deleted and broken tests fixed.

---

### L-007: A rejected security task may be obsolete if the attack surface was eliminated by design

**Observation:** BETA-01 (SSRF in Node 22 runner sandbox) was rejected by Iris — the handler was never committed, tests were broken, and there was no `executeSkill` export. However, investigation revealed the entire attack surface no longer exists: the architecture switched to a local CLI model with no server-side skill execution. The security task was not just poorly implemented; it was addressing a threat that does not apply to the current architecture.
**Rule:** Before re-opening or re-implementing a rejected security task, verify that the threat model it addresses still applies to the current architecture. If the attack surface has been eliminated by design, cancel the task and document the cancellation with the architectural reason.
**Action:** BETA-01 cancelled. Cancellation note written in todo.md explaining the attack surface was eliminated by the architecture switch, not patched.

---

## Session Summary — 2026-04-07

### Completed
- [BETA-01] Rejected by Iris; subsequently cancelled — SSRF attack surface eliminated by architecture switch to local CLI model
- [BETA-00] Stale runner artifacts deleted (`src/runners/`, `tests/unit/runners/`), execution and validation handlers audited, `docs/execution-sandbox.md` flagged as superseded
- [ALIGN-01] Deleted `tests/unit/runners/node22-sandbox.test.js` and `tests/unit/runners/` directory
- [ALIGN-02] Deleted `docs/execution-sandbox.md`
- [ALIGN-03] Rewrote Hard Architectural Rule 3 in `docs/architecture.md`; removed runner Lambda entries from the Lambda Functions table
- [ALIGN-04] Rewrote `docs/validation-evolve.md` to describe caller-reported validation model
- [ALIGN-05] Wrote ADR-012 to `docs/decisions.md`; marked ADR-006 Superseded; added supersession note to ADR-009
- [ALIGN-06] Deleted broken Lambda invocation test cases from `tests/unit/evolve/handler.test.ts`; removed `@aws-sdk/client-lambda` mock block
- [ALIGN-07] Audited remaining test cases in `tests/unit/evolve/handler.test.ts` for additional `mockLambdaSend` references
- [ALIGN-08] Updated IMPL-11-B and IMPL-11-C sub-task descriptions in todo.md to reflect caller-reported model
- [ALIGN-09] Updated IMPL-12-D sub-task description to remove Lambda invocation step
- [ALIGN-10] Annotated `codevolve-cache` construct in CDK as inactive pending BETA-07; updated `docs/architecture.md`
- [ALIGN-11] Removed orphaned `/evolve` API Gateway resource from `infra/codevolve-stack.ts`; updated `docs/api.md`
- [UI-01 through UI-04] New tasks added for registry left panel cleanup
- All changes committed (c260d31), pushed to GitHub, frontend built and deployed to S3

### In Progress
- [IMPL-08] Analytics event consumer Lambda not yet written. CDK constructs (IMPL-08-B) and sub-tasks A–E are Planned. ClickHouse env var injection issue (REVIEW-08-IMPL08 NEW CRITICAL) unresolved. Status: `[~]`.
- [REVIEW-08-IMPL08] Blocked on IMPL-08 completion. New critical (ClickHouse env vars not injected into CDK) remains open.

### Lessons Recorded
- L-004: Architecture drift accumulates silently — run a dedicated audit pass after any model change
- L-007: A rejected security task may be obsolete if the attack surface was eliminated by design

### Files Changed
- `tasks/todo.md` — corrected ALIGN-01 through ALIGN-11 and BETA-00 statuses from `[✓]`/`[x]` (unapproved) to `[~]`; ALIGN-03/04/05 from `[x]` to `[~]`; added session summary
- `tasks/lessons.md` — added L-004, L-007, and Session Summary 2026-04-07
- `docs/architecture.md` — Rule 3 rewritten for local CLI model; runner Lambda entries removed; codevolve-cache annotated as inactive
- `docs/validation-evolve.md` — rewritten to describe caller-reported validation model
- `docs/decisions.md` — ADR-012 added; ADR-006 marked Superseded; ADR-009 updated
- `tests/unit/evolve/handler.test.ts` — broken Lambda invocation test cases and `@aws-sdk/client-lambda` mock deleted
- `tests/unit/runners/` — directory deleted (ALIGN-01 / BETA-00)
- `docs/execution-sandbox.md` — deleted (ALIGN-02)
- `infra/codevolve-stack.ts` — codevolve-cache annotated; orphaned `/evolve` resource removed
- `docs/api.md` — POST /evolve documented as SQS-only (no direct HTTP trigger)

### Next Session
Begin at [IMPL-08]: write the analytics event consumer Lambda (sub-tasks IMPL-08-A through IMPL-08-E). The ClickHouse env var injection issue (REVIEW-08-IMPL08 NEW CRITICAL) must be resolved as part of IMPL-08-B (CDK resources). Confirm ClickHouse Cloud instance is provisioned before starting IMPL-08-A.
