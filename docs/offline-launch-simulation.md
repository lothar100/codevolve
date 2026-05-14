# codeVolve Offline Launch Simulation

> `BETA-19` artifact for a non-public rehearsal of the current public-beta launch flow.

**Date:** May 13, 2026  
**Status:** Rehearsal script ready; findings below are from an offline pressure-test against the current repo docs and discovery surface.

## Goal

Rehearse the first-contact path without posting anywhere public:

`agent sees launch copy -> opens docs/discovery -> decides whether codeVolve is relevant -> understands auth -> sees first success path -> chooses to try or skip`

This is a messaging and onboarding simulation, not a live API test. Use `docs/beta-smoke-path.md` for the real happy-path execution run.

## Rehearsal Setup

- One operator plays `codeVolve`
- One reviewer plays a skeptical external agent builder
- One reviewer plays a time-constrained evaluator deciding in under 3 minutes
- Source surfaces allowed in the rehearsal:
  - launch copy draft or stub
  - `GET /` discovery output
  - [docs/api.md](/C:/Users/pgl49/source/repos/codevolve/docs/api.md)
  - [docs/public-beta-go-no-go.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-go-no-go.md)
  - [docs/beta-smoke-path.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-path.md)

## Offline Rehearsal Script

1. Show the reviewer one short launch blurb:
   `codeVolve is a public beta for intent-first skill routing: discover skills, fetch implementations, run locally, and send feedback.`
2. Ask the reviewer to answer, in one sentence, what the product does.
3. Give the reviewer only the discovery URL or API docs link.
4. Ask the reviewer to find:
   - how to authenticate
   - whether code runs locally or on codeVolve servers
   - the first endpoint to try without credentials
   - the first endpoint to try with credentials
5. Ask the reviewer to describe the shortest path from zero context to first successful authenticated call.
6. Ask whether they would try the beta now, later, or not at all.
7. Record where they hesitated, guessed, or opened the wrong surface.

## Likely Operator Prompts And Good Replies

Use these during the rehearsal.

| Reviewer prompt | Good operator reply |
|---|---|
| "What is codeVolve in one line?" | "An agent-first registry that routes natural-language intents to reusable coding skills, which you execute locally." |
| "Do you run my code?" | "No. Public beta does not run user code server-side; `/execute` only records local execution telemetry." |
| "What do I do first?" | "Start with `GET /` for discovery, then `POST /auth/register` to get your first API key, then follow the smoke-path flow." |
| "Do I need a web UI?" | "No. Public beta is API, discovery, MCP, and docs first. The dashboard frontend is out of scope." |
| "How do I validate a skill?" | "Run tests locally and send pass/fail counts to `POST /validate/{skill_id}`." |
| "Is there hosted caching?" | "No public server-managed execution cache is part of beta. Any cache behavior is caller-side only." |

## FAQ Pressure-Test Prompts

These questions should be asked cold, with no extra explanation:

- "Is this a hosted code runner or just a registry?"
- "Why would I use this instead of exact lookup by ID?"
- "Can I try anything before creating an API key?"
- "How do I get my first API key?"
- "Do I need Cognito, IAM, or a browser login?"
- "What does MCP add beyond raw REST calls?"
- "What is the shortest success path that proves the beta is real?"
- "What happens after I submit feedback?"
- "Where do I go if I only care about docs and not a dashboard?"
- "What should make me trust this with an external agent integration?"

## Findings From This Offline Pressure-Test

1. Auth onboarding still has contradictory repo language.
   [docs/agent-auth-architecture.md](/C:/Users/pgl49/source/repos/codevolve/docs/agent-auth-architecture.md) still says initial beta keys are issued out-of-band through Moltbook, while the current public-beta discovery and smoke path say external users bootstrap through `POST /auth/register`. Launch copy must choose one story. For the current beta, it should be self-serve registration first.

2. Moltbook wording can still send reviewers to the wrong surface.
   Older docs talk about Moltbook and future human product flows, but current beta scope is API/discovery/MCP, not a hosted UI. A launch post must avoid leading with the dashboard or any human-web-product framing.

3. The first success path needs to be stated in one compact block.
   The repo has the pieces, but a new reader still has to synthesize them across discovery, API docs, and the smoke-path runbook. Launch copy should explicitly say: `GET / -> POST /auth/register -> POST /skills or POST /intent -> local execution -> POST /validate/{skill_id}`.

4. "Intent-first" still needs a clearer why-now payoff.
   The API contract is clear, but launch messaging should explain why an agent uses `POST /intent` instead of direct lookup: discovery of reusable implementations when the caller knows the task but not the exact skill ID.

5. MCP should be presented as optional, not as the only serious path.
   The current product is credible through plain REST alone. Launch messaging should frame MCP as a convenience layer for tool-integrated agents, with REST remaining the baseline onboarding path.

## Pass Criteria

The offline simulation passes when both reviewers can answer all of the following without operator rescue:

- codeVolve does not run user code server-side
- `POST /intent` is the canonical routing entry point
- the first credential bootstrap is `POST /auth/register`
- API keys, not Cognito or IAM, are the external beta auth path
- the dashboard frontend is not required for beta use

If either reviewer guesses wrong on any item above, the launch copy is not ready.
