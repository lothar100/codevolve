---
name: DESIGN-06 MCP Server Interface
description: MCP server design for codeVolve — tools, resources, prompt templates, ergonomics, and configuration spec. Appended to docs/platform-design.md.
type: project
---

DESIGN-06 was completed and appended to `docs/platform-design.md`.

## Summary of decisions

- Transport: stdio (standard for Claude Code)
- 7 tools defined: resolve_skill, execute_skill, chain_skills, get_skill, list_skills, validate_skill, submit_skill
- 3 resources: codevolve://skills/{skill_id}, codevolve://problems/{problem_id}, codevolve://skills
- 2 prompt templates: generate_skill, improve_skill (used by /evolve pipeline)
- submit_skill enforces stricter contract at MCP layer than HTTP API: examples (>=1) and tests (>=2) are required fields in the MCP tool schema, not optional
- No MCP-layer auth — API key forwarded via Authorization header to HTTP API
- CODEVOLVE_API_KEY is optional now, required in Phase 2+
- Agent ergonomics section defines: similarity_score >= 0.7 as the gating condition for execute, when to use chain_skills vs sequential execute_skill, error handling for all error codes
- MCP server binary expected at packages/mcp-server/ (decision deferred to IMPL-15)

## Open questions logged in doc
1. Pagination behavior for codevolve://skills resource in Claude Code
2. API key hot-reload when rotated during a session
3. Monorepo package vs published npm package for MCP server binary
