## Iris Review — IMPL-15 / MCP Server Full Implementation

### Verdict: REJECTED

---

### Test Results

```
npx jest tests/unit/mcp/ --passWithNoTests

FAIL unit tests/unit/mcp/server.test.ts
  Cannot find module '@modelcontextprotocol/sdk/server/mcp.js' from 'src/mcp/server.ts'

PASS unit tests/unit/mcp/resources.test.ts
PASS unit tests/unit/mcp/client.test.ts
PASS unit tests/unit/mcp/tools.test.ts

Test Suites: 1 failed, 3 passed, 4 total
Tests:       85 passed, 85 total
```

```
npx tsc --noEmit

src/mcp/server.ts(14,45): error TS2307: Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'
src/mcp/server.ts(15,38): error TS2307: Cannot find module '@modelcontextprotocol/sdk/server/stdio.js'
src/mcp/server.ts(78,10):  error TS7006: Parameter 'args' implicitly has an 'any' type.
src/mcp/server.ts(104,10): error TS7006: Parameter 'args' implicitly has an 'any' type.
src/mcp/server.ts(141,10): error TS7006: Parameter 'args' implicitly has an 'any' type.
src/mcp/server.ts(154,10): error TS7006: Parameter 'args' implicitly has an 'any' type.
src/mcp/server.ts(185,10): error TS7006: Parameter 'args' implicitly has an 'any' type.
src/mcp/server.ts(204,10): error TS7006: Parameter 'args' implicitly has an 'any' type.
src/mcp/server.ts(219,10): error TS7006: Parameter 'args' implicitly has an 'any' type.
src/mcp/server.ts(234,10): error TS7006: Parameter 'args' implicitly has an 'any' type.
tests/unit/mcp/server.test.ts(10,10): error TS2305: Module '"../../../src/mcp/server.js"' has no exported member 'createServer'.
tests/unit/mcp/server.test.ts(11,24): error TS2307: Cannot find module '@modelcontextprotocol/sdk/server/index.js'
```

The TypeScript compiler does not exit cleanly. `server.test.ts` fails to run. Approval is blocked.

---

### Review Questions

**1. Would a senior engineer approve this implementation?**

Partially. `client.ts`, `tools.ts`, and `resources.ts` are individually well-written — the Zod validation approach, the `callApi` error-capture pattern, and the URI parsing in resources are clean and readable. However, `server.ts` has eight implicit `any` parameters on tool and resource handler callbacks, all of which would be typed if the MCP SDK were properly installed. The module also does not export `createServer`, which the associated test file requires. The overall implementation is incomplete in ways that prevent it from compiling.

**2. Is there a simpler solution?**

No significant simplification is needed for the architecture. The thin-client translation-layer pattern is the right approach. The tool handler duplication between `tools.ts` (Zod schemas + functions) and `server.ts` (re-declared Zod schemas in `registerTool` calls) is intentional per DESIGN-06 and is acceptable given the MCP SDK's API shape.

**3. Are there unintended side effects?**

None beyond scope. No DynamoDB writes, no LLM calls, no writes to analytics. The MCP server is correctly scoped as a thin HTTP proxy.

**4. Are edge cases handled?**

In `client.ts` and `tools.ts`: largely yes. The following gaps exist:

- `CODEVOLVE_TIMEOUT_MS` is not validated against `NaN`. `parseInt("bad", 10)` returns `NaN`; `setTimeout(fn, NaN)` fires immediately in Node.js, defeating the timeout guard. (Carried from prior scaffold review W-01.)
- `extractIdFromUri` in `resources.ts` calls `new URL(uri)` without a try/catch. A malformed URI passed by an agent throws an unhandled `TypeError` rather than a structured MCP error.
- Resource handlers (`readSkillResource`, `readProblemResource`) propagate `client.request` errors directly — no wrapping into MCP error shape. Tool handlers use `callApi` to return `isError:true` content; resources throw raw. This is an inconsistency in error contract (carried from prior scaffold review W-03).
- `callApi` does not catch `ZodError` — a ZodError from inside the API response path would surface as an unhandled rejection rather than an `isError:true` result. In practice this path is unlikely but it is untested. (Carried from prior scaffold review S-01.)

**5. Does the change follow the architectural plan?**

Substantially yes for the parts that work — `client.ts`, `tools.ts`, `resources.ts` are architecturally correct. However, the implementation deviates from DESIGN-06 in three significant ways that make it non-conformant:

1. Tool names do not match the spec.
2. `submit_skill` is missing entirely.
3. `mcp-config.json` uses the wrong top-level key.

See Issues Found below.

---

### Security Check

- Input validation: Pass — all tool handlers validate with Zod before making HTTP calls.
- DynamoDB safety: N/A — the MCP server makes no DynamoDB calls; it proxies to the HTTP API.
- Sandbox integrity: Pass — no eval, no dynamic require, no filesystem access.
- Error response safety: Pass — API errors are relayed as structured JSON content, not raw stack traces.

---

### Issues Found

**[CRITICAL-01] MCP SDK dependency is absent from `package.json` and not installed**

`@modelcontextprotocol/sdk` is not listed in `package.json` dependencies and is absent from `node_modules`. `server.ts` imports from it unconditionally. `tsc --noEmit` fails with two module-not-found errors. The server process cannot start. Add `@modelcontextprotocol/sdk` to `package.json` dependencies and run `npm install`.

**[CRITICAL-02] All six tool names deviate from DESIGN-06 spec**

DESIGN-06 §1 defines the following tool names: `resolve_skill`, `execute_skill`, `chain_skills`, `validate_skill`, `list_skills`, `get_skill`.

The implementation registers: `resolve`, `execute`, `chain`, `validate`, `list_skills`, `get_skill`.

Four of the six names do not match the spec. The MCP tool name is the primary discovery key for agent consumers — an agent following the DESIGN-06 documentation will call `resolve_skill` and receive a "tool not found" error. `list_skills` and `get_skill` happen to match. The other four must be renamed.

`TOOL_DEFINITIONS` in `tools.ts` must be updated to match. Tool handler function names (`resolve`, `execute`, `chain`, `validate`) can remain the same internally; only the registered MCP names must change.

**[CRITICAL-03] `submit_skill` tool is not implemented**

DESIGN-06 §1 defines six tools; the sixth is `submit_skill`, wrapping `POST /skills`. It is absent from both `tools.ts` and `server.ts`. `TOOL_DEFINITIONS` has only 5 entries (the test asserts 6, but that count would only pass if the test itself were wrong — the test file at `tests/unit/mcp/tools.test.ts` line 46 asserts `toHaveLength(6)`, which would currently pass against the 6 registered entries in the const. Recounting: `resolve`, `execute`, `chain`, `validate`, `list_skills`, `get_skill` — that is indeed 6. So the 6-entry count passes but `submit_skill` is still absent by name. The test validates count and names without checking for `submit_skill`, so it passes silently.) The `submit_skill` tool must be added with the full input schema from DESIGN-06 §1 (including `problem_id`, `name`, `description`, `language`, `domain`, `inputs`, `outputs`, `examples`, `tests`, `implementation` as required fields, and `tags`, `status` as optional).

**[CRITICAL-04] `server.ts` does not export `createServer` — `server.test.ts` cannot run**

`server.test.ts` line 10 imports `{ createServer }` from `src/mcp/server.js`. `server.ts` exports nothing — it only calls `main()` at module level. The test file fails with `has no exported member 'createServer'`. The server must be refactored to export a `createServer(client: CodevolveClient): McpServer` factory function that `main()` calls, so tests can instantiate it without side effects. This also resolves the problem that importing `server.ts` currently calls `createClientFromEnv()` immediately, failing in any test environment without `CODEVOLVE_API_URL` set.

**[CRITICAL-05] `tsc --noEmit` fails — eight implicit `any` parameters in `server.ts`**

Lines 78, 104, 141, 154, 185, 204, 219, 234 of `server.ts` have callback parameters typed as implicit `any`. These appear to be the `args` and `uri` parameters on `registerTool` and `registerResource` callbacks. Once the MCP SDK is installed these will receive proper types from the SDK. Explicit type annotations must be added to satisfy the project's `noImplicitAny` TypeScript configuration.

**[WARNING-01] `mcp-config.json` top-level key is `mcpServers` but Claude Code `.mcp.json` format uses `mcpServers`**

The top-level key `mcpServers` is correct for Claude Code's `.mcp.json` format. However, the file is named `mcp-config.json` rather than `.mcp.json`. Claude Code does not auto-discover a file named `mcp-config.json` — it reads `.mcp.json` at the workspace root. Either rename the file to `.mcp.json` or update the README/DESIGN-06 to clarify that users must copy this config into their own `.mcp.json`. This is not a code defect but it will cause friction for every developer who follows the "add a stanza to `.mcp.json`" instruction in DESIGN-06 §Overview.

**[WARNING-02] `CODEVOLVE_TIMEOUT_MS` not validated against NaN**

`parseInt(process.env["CODEVOLVE_TIMEOUT_MS"] ?? "35000", 10)` returns `NaN` if the env var is set to a non-numeric string. `setTimeout(fn, NaN)` fires immediately in Node.js, meaning the timeout guard is silently disabled. Add a guard: if `isNaN(timeoutMs)` throw with a clear message, or clamp to the default. This was flagged in the prior scaffold review as W-01 and has not been addressed.

**[WARNING-03] `extractIdFromUri` throws unhandled TypeError on malformed URIs**

`new URL(uri)` in `resources.ts` throws `TypeError: Invalid URL` if the string is not a valid URL. Resource handlers do not wrap this in try/catch. A malformed URI from an agent will crash the resource handler with an unhandled exception rather than a structured MCP error. Wrap the `new URL()` call and convert parse failures to a meaningful thrown error.

**[SUGGESTION-01] TOOL_DEFINITIONS in `tools.ts` is dead code**

`server.ts` does not import `TOOL_DEFINITIONS` from `tools.ts`. The tool metadata is re-declared inline inside the `registerTool` calls in `server.ts`. The `TOOL_DEFINITIONS` export is only consumed by tests to verify structural properties. This is the same pattern flagged in the prior scaffold review (W-02). The duplicate is acceptable if the intent is to keep `tools.ts` self-contained and testable without the MCP SDK. But if that is the intent, the test in `tools.test.ts` that checks `every tool definition has an inputSchema with type:object` tests a JSON object — not the Zod schema used at runtime. Consider consolidating or at minimum adding a comment explaining why the two schema representations coexist.

---

### Notes for Ada

**Fix order (strictly sequential — each item unblocks the next):**

1. Add `@modelcontextprotocol/sdk` to `package.json` and run `npm install`. This unblocks all MCP SDK import errors in `server.ts` and `server.test.ts`.
2. Refactor `server.ts` to export `createServer(client: CodevolveClient): McpServer`. Move `main()` to call `createServer(createClientFromEnv())`. This makes the module testable and unblocks `server.test.ts`.
3. Rename four tools in `server.ts` (and in `TOOL_DEFINITIONS` in `tools.ts`) from `resolve`/`execute`/`chain`/`validate` to `resolve_skill`/`execute_skill`/`chain_skills`/`validate_skill`. Update all test assertions that reference the old names.
4. Implement `submit_skill` tool in `tools.ts` and register it in `server.ts`. Add tests to `tools.test.ts`.
5. Fix implicit `any` types on all `registerTool` and `registerResource` callback parameters.
6. Fix `CODEVOLVE_TIMEOUT_MS` NaN guard in `client.ts`.
7. Fix `extractIdFromUri` to not throw unhandled TypeError.
8. Rename or document `mcp-config.json` → `.mcp.json`.

`server.test.ts` already exists and tests the correct tool names (`resolve_skill`, `execute_skill`, `chain_skills`, `validate_skill`) and correct `createServer` export — it was written against the spec, not the current implementation. Once the implementation is fixed, `server.test.ts` should pass with minimal or no changes.

`tsc --noEmit` must exit 0 before resubmission. All four test suites must pass.
