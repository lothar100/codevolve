# codeVolve Public Beta Go/No-Go Checklist

> Operational launch gate for public beta. Keep this to one page and evaluate it against the current beta task log only.

**Decision date:** May 13, 2026  
**Default status:** `NO-GO` until every required check below is marked `PASS` with dated evidence.

## Current Evaluation

As of **May 13, 2026**, the default decision is still `NO-GO` until every required check is explicitly marked `PASS`, but the earlier top-of-funnel blockers were cleared by the latest live smoke rerun.

Checks now evidenced as passing in the latest rerun:

- `Auth path`: `POST /auth/register` and child key issuance worked on the deployed environment.
- `End-to-end beta smoke path`: completed successfully from discovery through canonical promotion and public readback.
- `Docs and discovery alignment`: discovery now returns the real shared AWS API URL for both `base_url` and `docs_url`.
- `Public URL target`: the shared onboarding URL used in the live rerun was the reachable AWS API URL rather than an unprovisioned vanity host.

Latest evidence: [docs/beta-smoke-record-2026-05-13-rerun-3.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-record-2026-05-13-rerun-3.md)

## In Scope

Public beta covers the API, discovery surface, MCP, API-key auth, and the local-execution plus feedback workflow:

`exact lookup or intent -> skill summary -> implementation fetch if needed -> local execution -> feedback`

Public beta does **not** promise a hosted runner, server-managed execution cache, or the dashboard/mountain web frontend.

Vanity domains are also out of scope until explicitly revived. As of **May 13, 2026**, `api.codevolve.dev` and `codevolve.dev` are intentionally unprovisioned, so beta launch work must use a different real shared onboarding URL if public sharing is resumed.

## Required Checks

| Check | Pass when | Evidence |
|---|---|---|
| Unit stability | `npm run test:unit -- --runInBand` is green on the launch candidate branch. | Date, branch, and command output summary |
| `/validate` contract | Public docs, discovery, MCP descriptions, and runtime behavior all describe caller-reported local feedback. Archived validation returns `409 SKILL_ARCHIVED`. No beta-facing surface implies server-run validation. | Doc links plus one targeted validation check |
| Auth path | External beta onboarding uses `cvk_...` API keys only. `register`, `create/list/delete key`, and one authenticated write all work without Cognito or IAM. | Dated auth smoke record |
| MCP path | MCP read tools and resources work for an external beta user and return supported enums plus structured errors on invalid inputs. | Dated MCP smoke record |
| Canonical promotion | A validated skill can be promoted successfully, and an incumbent is demoted correctly when present. | Dated promote-canonical smoke record |
| End-to-end beta smoke path | One reproducible run covers: discovery, API key creation/use, skill submission, intent lookup, MCP read, local execution, feedback submission, and canonical promotion. | Linked smoke-path artifact |
| Docs and discovery alignment | Public docs, examples, discovery, and launch copy all match shipped behavior: `intent`, local execution, feedback-style validation, API-key auth. | Dated doc/discovery review note |
| Public URL target | The shared URL lands on public docs or discovery for the API/MCP workflow and does not depend on internal UI, Cognito, or IAM. | Final URL and quick manual open check |

## Acceptable Residual Risks

- The dashboard/mountain frontend remains out of public beta scope.
- `codevolve-cache` may remain provisioned as dormant infrastructure if it is not on the request path and is not described as a beta feature.
- Internal Cognito and IAM flows may remain in place for operator use if external beta users do not need them.
- Post-beta architecture notes may remain in internal docs if public-facing docs and discovery do not contradict the shipped beta behavior.
- Vanity API/docs domains may remain absent if the launch plan uses another reachable shared onboarding URL and no public-facing surface claims the vanity hosts exist.

## Exact Rule For Sharing A Public URL

Share a public URL only when all of the following are true:

1. Every required check above is `PASS` with evidence dated May 13, 2026 or later.
2. The beta task log shows no unresolved launch-gate blocker, or any remaining blocker has an explicit written acceptance note naming the residual risk.
3. The URL points to the real public onboarding surface for this beta: API/discovery/docs for agent use, not the dashboard/mountain UI.
4. A fresh reader can reach that URL and learn the correct beta model without guessing: API key auth, local execution, feedback submission, and optional MCP usage.
5. The shared page and linked docs make no claim that codeVolve runs user code server-side, provides a hosted execution cache, or requires a web UI to use the beta.

If any item above is false, the decision remains `NO-GO`.
