---
name: mcp_server_impl
description: MCP server location, structure, and key implementation details for IMPL-15
type: project
---

IMPL-15 has TWO MCP server implementations:

1. **`packages/mcp-server/`** — original ESM package with vitest tests (APPROVED WITH NOTES after REVIEW-IMPL-15)
2. **`src/mcp/`** — main-project implementation using Jest, fixing REVIEW-12-IMPL15 criticals (REVIEW-12 fixes applied 2026-03-25)

The `src/mcp/` implementation is the active one for the main project build:
- Files: `client.ts`, `tools.ts`, `resources.ts`, `prompts.ts`, `server.ts` (exports `createServer` + `main`), `index.ts` (entry point that calls `main()`)
- `@modelcontextprotocol/sdk` v1.27.1 added to root `package.json`
- `createServer(client: CodevolveClient): McpServer` is the factory — does NOT call connect()
- `main()` is exported from `server.ts` but NOT auto-called — `index.ts` calls it
- This keeps `server.ts` safe to import in tests without CODEVOLVE_API_URL set
- `createClientFromEnv()` in `client.ts` reads env vars and guards NaN timeout
- Tool names per DESIGN-06: `resolve_skill`, `execute_skill`, `chain_skills`, `get_skill`, `list_skills`, `validate_skill`, `submit_skill`
- Tool functions take `(client: CodevolveClient, raw: unknown)` — client is injected, not singleton
- Resource handlers take `(client: CodevolveClient, uri: string)` — URI parse wrapped in try/catch
- Tests at `tests/unit/mcp/` — 52 tests across 4 files (server, tools, resources, client)
- `.mcp.json` at repo root, live API: `https://hra190v7x6.execute-api.us-east-2.amazonaws.com/v1`
