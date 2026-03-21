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
