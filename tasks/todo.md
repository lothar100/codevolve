# codeVolve - Beta Task Log

> Purpose: current beta-only source of truth. Historical implementation detail lives in git history and `docs/reviews/`.

**Status legend:** `[ ]` Planned · `[~]` In Progress · `[!]` Blocked · `[x]` Complete

---

## Current Product Model

The current product story is:

`exact lookup or intent -> skill summary -> implementation fetch if needed -> local execution -> feedback`

Rules for all beta work:

- Treat `/intent` as the canonical routing concept.
- Treat `/execute` as reporting and telemetry only. It does not run user code server-side.
- Treat `/validate` as feedback-style validation under the local execution model.
- Treat cache fields as caller telemetry only. Public beta has no server-managed execution cache, read-through cache, or edge-cache contract.
- Do not reintroduce server-runner, server-cache, or hosted chain-execution wording.

---

## Beta Launch Gate

Public beta launch is approved as of May 27, 2026 because all of the following were satisfied by dated evidence:

1. `npm run test:unit` is green.
2. The `/validate` and feedback contract is settled and reflected consistently in code and docs.
3. MCP, auth, and canonical-promotion carry-forward issues are closed or explicitly accepted.
4. One real beta happy path is verified end to end.
5. Public docs and examples match the shipped behavior.

---

## Shipped Baseline

These are considered present enough to build on for beta. They are not active backlog items unless called out below:

- Skill and problem registry CRUD exists.
- API key auth exists.
- MCP server exists.
- Intent routing exists.
- Chain planning endpoints exist.
- Analytics pipeline and dashboard frontend exist.
- Canonical promotion exists, but still needs hardening.

---

## Beta Blockers

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| BETA-07 | Jorven -> Ada | [x] Complete | **Finalize `/validate` as a caller-reported local feedback endpoint.** The canonical beta contract is now `{ version?, pass_count, fail_count, total_tests }`, alias inputs remain compatibility-only, archived validation returns `409 SKILL_ARCHIVED`, and the public docs, MCP wording, and discovery surface now describe feedback-style local validation rather than hosted execution. | - |
| BETA-08 | Ada | [x] Complete | **Get the unit suite green.** Verified on 2026-05-12 with `npm run test:unit -- --runInBand`: 43/43 suites passed, 526/526 tests passed. The beta gate is now reliable again after auth, archive, promotion, MCP, and stale execute-semantic fixes. | - |
| BETA-09 | Ada + Iris | [x] Complete | **Add and verify a beta smoke path.** The authoritative runbook lives in `docs/beta-smoke-path.md`, and the live execution history is captured in `docs/beta-smoke-record-2026-05-13.md`, `docs/beta-smoke-record-2026-05-13-rerun.md`, `docs/beta-smoke-record-2026-05-13-rerun-2.md`, and the passing rerun in `docs/beta-smoke-record-2026-05-13-rerun-3.md`. As of May 13, 2026 after redeploy, the beta happy path now passes end to end: discovery, registration, API key issuance/use, problem setup, skill submission, anonymous intent lookup, MCP read, feedback submission, canonical promotion, and public readback all succeeded against the live AWS API URL. Vanity API/docs domains remain intentionally out of scope until explicitly revived, but they are no longer required for the smoke-path proof because discovery now uses the real shared onboarding URL. | BETA-07, BETA-08 |
| BETA-10 | Ada | [x] Complete | **Remove stale runner-era artifacts and semantics.** Phase 2 removed stale execute-side effects from `GET /skills/:id`, and Phase 3 cleaned the beta-facing docs, discovery, MCP prompts, and API reference so they no longer imply hosted execution, hosted validation, or a public server-cache contract. | BETA-07 |
| BETA-11 | Ada | [x] Complete | **Harden MCP for external beta users.** MCP resource reads now throw structured resource errors, and the MCP validation layer now enforces supported `language` enums plus the `submit_skill.status` enum. | - |
| BETA-12 | Ada | [x] Complete | **Harden auth behavior for beta.** The backup Cognito authorizer now validates `token_use`, auth key-management handlers share a restored auth-context helper, and the unattached `authorizerFn` is explicitly documented in infra as a standalone non-APIGW path while `CognitoUserPoolsAuthorizer` remains primary for beta. | - |
| BETA-13 | Ada | [x] Complete | **Harden canonical promotion before beta.** Promotion no longer blocks on missing token-size telemetry, legacy demoted-skill cache cleanup compatibility is restored via archive utilities, and incumbent score gating now runs only when both skills have comparable metadata. | BETA-07 |
| BETA-14 | Jorven | [x] Complete | **Remove `codevolve-cache` from the beta product story.** The beta-facing contract and launch docs already treat server-managed execution cache as out of scope, and the dormant `codevolve-cache` table is explicitly accepted as inactive residual infrastructure for beta. Any remaining cache references are deferred internal architecture cleanup, not an open beta blocker. | BETA-07 |
| BETA-15 | Ada | [x] Complete | **Do one authoritative docs and discovery pass for beta.** `docs/api.md`, `src/registry/discovery.ts`, MCP descriptions/prompts, `docs/validation-evolve.md`, the beta smoke path, and the task log now tell the same beta story: `intent`, local execution, feedback-style validation, mixed public-read/API-key-write auth, and no public server-managed execution cache. | BETA-07, BETA-10, BETA-11, BETA-12 |

---

## Beta Support Tasks

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| BETA-16 | Ada | [x] Complete | **Clean up `/execute` semantics.** The execution path is now telemetry-only, and the last stray non-`/execute` execute emission was removed from `GET /skills/:id`. | BETA-10 |
| BETA-17 | Amber | [x] Complete | **Frontend beta scope decision.** The scope decision is already made and propagated: the dashboard/mountain frontend is out of public beta scope, and frontend date-range support, type-gate cleanup, and frontend docs polish are not beta blockers. Remaining frontend work belongs to post-beta planning, not the beta backlog. | - |
| BETA-18 | Jorven | [x] Complete | **Write a short go/no-go checklist for public beta.** Completed in `docs/public-beta-go-no-go.md`, and the launch decision was advanced to `GO` on 2026-05-27 after the required checks were evidenced, including a passing end-to-end smoke run and a working public onboarding path. | BETA-08, BETA-09, BETA-15 |

---

## Launch / GTM

These are not product blockers, but they should not go live before the launch gate above is satisfied.

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| BETA-19 | Jorven | [x] Complete | **Offline launch simulation.** Completed in `docs/offline-launch-simulation.md` on 2026-05-13. The rehearsal script covers first-contact launch messaging, operator replies, FAQ pressure-test prompts, and an initial findings set. Main gaps found: bootstrap auth messaging still conflicts between `POST /auth/register` and older out-of-band Moltbook wording, launch copy must avoid implying a hosted UI, and the first success path should be stated in one compact block. | BETA-15, BETA-18 |
| BETA-20 | Jorven -> Ada | [x] Complete | **Mirror simulation of the public beta flow.** Live evidence now exists in two dated records: the initial rehearsal in `docs/public-beta-mirror-record-2026-05-13.md` and the confirming no-rescue rerun in `docs/public-beta-mirror-record-2026-05-13-rerun.md`. The deployed discovery document now exposes MCP bootstrap guidance directly, the documented `packages/mcp-server/dist` path uses `X-Api-Key` correctly for write actions, and the rerun succeeded end to end on May 13, 2026: discovery, self-serve registration, child key issuance, route/read-first workflow, MCP resolve/read path, local execution, and `feedback_skill` all passed against the live AWS API URL without operator rescue. | BETA-09, BETA-15, BETA-19 |
| BETA-04 | Amber | [x] Complete | **Moltbook competitive landscape survey.** Completed in `docs/moltbook-competitive-landscape-2026-05-18.md`. Recommendation: keep Moltbook as a targeted secondary beta-outreach surface, not the launch plan's only distribution channel. | - |
| BETA-05 | Amber | [x] Complete | **Moltbook beta tester identification.** Completed in `docs/moltbook-beta-tester-identification-2026-05-18.md`, with a Wave 1 target of 12-18 outreach candidates to land 5-8 active testers across builder, QA, and workflow-design profiles. | BETA-04 |
| BETA-06 | Amber | [x] Complete | **Beta launch post draft.** Completed in `docs/moltbook-beta-launch-post-2026-05-18.md`, rewritten against the current product model: intent-first routing, local execution, feedback-style validation, API-first use, and optional MCP. | BETA-15, BETA-18, BETA-19, BETA-20 |

---

## Deferred Until After Beta

Do not expand the beta backlog with these unless the launch plan changes:

- Historical architecture and implementation task history.
- Old scaffold sub-task plans and completion gates.
- Superseded server-runner execution and validation plans.
- UI cleanup history and already-completed frontend polish tasks.
- Additional dashboard/frontend polish, including dashboard date-range controls, frontend type-gate cleanup, and embedded frontend docs cleanup.
- Longer-horizon roadmap work from `docs/roadmap-next.md`.

---

## Notes

- This file intentionally omits completed historical work. Use `docs/reviews/` and git history for audit detail.
- If a future task reopens hosted execution or server-side validation, it must explicitly say so and must not silently reuse superseded runner-era language.
- Operator constraint as of May 13, 2026: `api.codevolve.dev` and `codevolve.dev` do not exist and should be treated as intentionally unprovisioned. Do not add vanity-domain purchase, DNS, or hosting work back into the backlog unless explicitly requested.
