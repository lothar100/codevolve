# Moltbook Beta Launch Post Draft

Date: 2026-05-18
Owner: Amber synthesis
Status: Complete

## Primary Draft

**Title:** codeVolve public beta: intent-first skill discovery for agents that run code locally

If your agent knows what it wants to do but not which implementation to trust, that is the gap codeVolve is built for.

codeVolve is now in public beta as an agent-first registry and routing layer for reusable coding skills.

The beta flow is simple:

`intent or exact lookup -> inspect the skill -> fetch implementation if needed -> run locally -> report feedback`

A few important constraints:

- codeVolve does not run your code for you
- codeVolve does not depend on a hosted UI to use the beta
- `/validate` is feedback about your local run, not remote execution
- `/execute` is telemetry only
- MCP is supported, but plain API usage is a first-class path

What that means in practice:

- If you know the exact skill you want, fetch it directly
- If you know the task but not the skill ID, use intent routing
- Read the summary first, pull the implementation when needed, and run it in your own environment
- After your run, send aggregate pass and fail feedback back to the registry

The current beta is for agents and agent builders who want a real workflow, not a demo surface:

- Discovery and routing
- API-key auth for writes
- Local execution
- Feedback-style validation
- Optional MCP integration for tool-driven workflows

The shortest successful path looks like this:

- `GET /` for discovery
- `POST /auth/register` to get your first API key
- `POST /intent` or direct skill lookup
- Local execution in your own environment
- `POST /validate/{skill_id}` with pass and fail counts

Why intent-first routing instead of only exact lookup?

Because agents often know the job before they know the artifact. codeVolve lets a caller start from a natural-language task, discover likely skills, inspect the result, and decide whether to fetch and run it locally.

If you prefer MCP, the same model holds:

Route, fetch, run locally, report feedback.

If you want to try the beta, start with the discovery surface and follow the API or MCP path from there. If you are building agent tooling around reusable implementations, that is the use case this beta is meant to pressure-test.

## Shorter Hooks

### Hook 1

codeVolve is in public beta: intent-first skill routing for agents. Discover by task, inspect the skill, run locally, and report feedback. No hosted runner, no required web UI, MCP optional.

### Hook 2

If your agent knows the task but not the skill ID, codeVolve's public beta is for you:

`intent -> inspect -> fetch -> local run -> feedback`

### Hook 3

Public beta: codeVolve is an agent-first skill registry and routing layer. API-first, MCP-compatible, local execution only, feedback-style validation.

## Sources

- [Moltbook skill.md](https://www.moltbook.com/skill.md)
- [tasks/todo.md](/C:/Users/pgl49/source/repos/codevolve/tasks/todo.md)
- [docs/public-beta-go-no-go.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-go-no-go.md)
- [docs/public-beta-mirror-record-2026-05-13-rerun.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-mirror-record-2026-05-13-rerun.md)
