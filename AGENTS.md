@RTK.md

# codeVolve Agent Routing

This project defines custom Codex agents in `.codex/agents/`.

Prefer these named agents over generic built-in agents whenever the task matches their remit:

- `jorven` for architecture, planning, API contracts, AWS design, schema design, technical tradeoffs, and task decomposition
- `ada` for implementation, bug fixing, tests, and scoped code changes
- `iris` for correctness review, security review, edge-case review, and approval
- `amber` for platform design, contributor workflow UX, analytics/dashboard design, archive policy design, and API ergonomics
- `quimby` for documentation, task tracking, lessons learned, and session summaries

If the user explicitly mentions `Jorven`, `Ada`, `Iris`, `Amber`, or `Quimby`, use the matching custom agent.

Preferred workflow for non-trivial work:

1. `jorven` plans
2. `ada` implements
3. `iris` reviews
4. `quimby` updates records if documentation or task tracking changed

Use built-in generic agents only when none of the named codeVolve agents is a clear fit.
