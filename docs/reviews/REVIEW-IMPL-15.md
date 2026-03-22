# Iris Review — IMPL-15: MCP Server (`packages/mcp-server/`)

**Reviewer:** Iris
**Date:** 2026-03-21
**Files reviewed:**
- `packages/mcp-server/package.json`
- `packages/mcp-server/tsconfig.json`
- `packages/mcp-server/src/client.ts`
- `packages/mcp-server/src/tools.ts`
- `packages/mcp-server/src/resources.ts`
- `packages/mcp-server/src/prompts.ts`
- `packages/mcp-server/src/index.ts`
- `.mcp.json`

---

## Verdict: REQUEST CHANGES

One critical bug (optional prompt arguments registered as required causing SDK-level rejection), one missing test suite, and one missing env-var guard on `CODEVOLVE_TIMEOUT_MS`. All must be resolved before approval.

---

## Review Questions

**1. Would a senior engineer approve this implementation?**

Mostly yes. The layering is clean: `client.ts` owns HTTP mechanics, `tools.ts` owns schema validation and routing, `resources.ts` owns URI parsing, `prompts.ts` owns template construction, and `index.ts` wires them together using the SDK's `registerTool` / `registerResource` / `registerPrompt` API. Names are accurate. The `callApi` helper correctly converts thrown errors to `isError: true` text blocks so agents can reason about failures rather than receiving opaque MCP protocol errors. The `StdioServerTransport` + `SIGINT` handler is correct.

The dual-schema pattern in `tools.ts` (both a Zod schema used by the handler function, and a matching `inputSchema` shape registered in `TOOL_DEFINITIONS`) creates maintenance surface: the two definitions must be kept in sync manually. In practice, `index.ts` uses the Zod schemas directly via `server.registerTool`, so `TOOL_DEFINITIONS` in `tools.ts` (including its raw JSON `inputSchema` property) is never imported and is dead code. A senior engineer would flag this immediately.

**2. Is there a simpler solution?**

Yes, for the dead code issue. `TOOL_DEFINITIONS` in `tools.ts` (lines 205–475) is never imported anywhere — `index.ts` re-declares all tool metadata inline using `server.registerTool`. This entire export can be deleted, removing ~270 lines of duplicated schema definitions that must be manually kept in sync with the Zod schemas above them. The `handler` property on each definition further suggests an original design where `index.ts` would iterate `TOOL_DEFINITIONS` — that design was abandoned in favor of explicit `registerTool` calls, but the array was left behind.

**3. Are there unintended side effects?**

None for the MCP server's own operation. The server is a pure translation layer with no writes to DynamoDB or Kinesis — all mutations go through the HTTP API. No scope creep.

One behavioral side effect to note: `client.ts` reads env vars at module load time and calls `process.exit(1)` if `CODEVOLVE_API_URL` is missing. This means the exit fires the instant any test or integration harness imports `client.ts`, before any test setup can run. This is intentional for a server binary but makes the module difficult to test in isolation.

**4. Are edge cases handled?**

Partially. Specific gaps:

- **CRITICAL: Optional prompt arguments treated as required.** `index.ts` lines 248–251 iterate `promptDef.arguments` and register every arg as `z.string()` regardless of its `required` field. The MCP SDK (v1.27.1, confirmed) calls `safeParseAsync(argsObj, request.params.arguments)` on the registered schema and throws `McpError(InvalidParams)` on failure. Calling `generate_skill` without `domain` or `improve_skill` without `confidence` will be rejected by the SDK before `buildMessages` is ever reached, even though `buildMessages` handles missing args gracefully via `?? default`. The fix is to use `z.string().optional()` for args where `arg.required === false`.

- **WARNING: `CODEVOLVE_TIMEOUT_MS` not validated.** `parseInt("not-a-number", 10)` returns `NaN`. `setTimeout(fn, NaN)` is treated as `setTimeout(fn, 0)` by the browser spec and Node.js, meaning every request would be aborted immediately if the env var is malformed. A `isNaN(TIMEOUT_MS)` guard with a fallback or a `process.exit(1)` is needed alongside the existing `CODEVOLVE_API_URL` check.

- **NOTE: Zod parse errors in tools surface as MCP protocol errors, not `isError` text.** If an agent calls a tool with invalid arguments (e.g., a non-UUID `skill_id`), `resolveSkillSchema.parse(raw)` throws a `ZodError`, which is not caught by `callApi` (the Zod throw happens before `fn()` is called). The MCP SDK catches this uncaught throw and converts it to an `InvalidParams` protocol error — which is arguably correct behavior for malformed tool calls. This is not a bug, but it means the error path is inconsistent: API errors return `isError: true` text, but validation errors return protocol errors. This distinction is documented nowhere and may surprise agent authors.

- **NOTE: Resource handlers throw on HTTP error instead of returning `isError`.** `readSkillResource`, `readProblemResource`, and `readSkillsListResource` call `client.request(...)` directly without a try/catch. If the API returns a non-2xx response, the error propagates to the MCP SDK which returns a protocol-level error. This is inconsistent with the tool handlers which wrap all API calls in `callApi`. For resources, protocol-level errors are arguably acceptable (resources are read operations, not agent decision points), but it is an inconsistency worth noting.

- **NOTE: Resource URI has no validation.** `readSkillResource` extracts `url.pathname.replace(/^\//, "")` and passes it directly to `/skills/${skillId}`. If the URI is `codevolve://skills/` (empty path), `skillId` will be an empty string and the request goes to `/skills/` — which will return a 404 from the API, not a validation error. The HTTP error will propagate as a protocol error (see above). Not exploitable here since the API is the trust boundary, but worth documenting.

- **Empty `steps` array:** `chainSkillsSchema` uses `.min(1)`, so an empty steps array is rejected at Zod parse time. Correct.

**5. Does the change follow the architectural plan?**

Yes. The MCP server is a pure HTTP translation layer with no business logic. No LLM calls, no DynamoDB access, no Kinesis writes. The spec's requirement that LLM calls only exist in `src/evolve/` is respected — the prompts module generates text *for* an LLM to execute, it does not itself call one. The prompts correctly instruct the agent to use `submit_skill` and `validate_skill` to close the loop.

The `.mcp.json` at repo root contains the correct API URL (`https://hra190v7x6.execute-api.us-east-2.amazonaws.com/v1`) and uses `CODEVOLVE_AGENT_ID: "claude-code-local"` which is appropriate for a local development config. `CODEVOLVE_API_KEY` is intentionally absent (optional per spec).

---

## Security Check

- **Input validation:** Pass for tools (Zod schema before HTTP call on all 7 tools, `submit_skill` enforces min 2 tests and min 1 example). Fail for resources (no validation of URI-extracted path components before use in HTTP path). The resource failure is low-severity because the API is the real trust boundary.
- **DynamoDB safety:** N/A — no direct DynamoDB access. All writes go through the HTTP API.
- **Sandbox integrity:** N/A — the MCP server executes no skill code.
- **Error response safety:** Pass. API error bodies are serialized as JSON text and returned as `isError: true` content. Internal stack traces from `client.ts` are not included — the error body is `apiErr.body ?? { error: apiErr.message }` which contains the API's response body or a generic message string, not a Node.js stack trace.
- **Credential safety:** Pass. `CODEVOLVE_API_KEY` is read from env and sent as `Authorization: Bearer` — not committed to code. `.mcp.json` does not include `CODEVOLVE_API_KEY`.

---

## Build Verification

`npm run build` (tsc): exits 0. `packages/mcp-server/dist/index.js` exists. Build is clean.

---

## Issues Found

- **[CRITICAL] Optional prompt arguments registered as required in `index.ts` lines 248–251.** The loop `argsSchema[arg.name] = z.string().describe(...)` ignores `arg.required`. The MCP SDK validates prompt args against this schema at request time using `safeParseAsync` and throws `McpError(InvalidParams)` on failure. Calls to `generate_skill` that omit `domain` and calls to `improve_skill` that omit `confidence` will be rejected. Fix: use `z.string().optional().describe(...)` when `arg.required === false`.

- **[CRITICAL] No test file exists for any module in `packages/mcp-server/`.** The hard rule is: any new Lambda handler without a corresponding test file is an auto-reject. The MCP server is not a Lambda, but the spirit of the rule applies — there are zero tests covering the tool handlers, resource URI parsing, error handling, or prompt message construction. At minimum, `tools.ts` (Zod schema enforcement, `callApi` error wrapping, `submit_skill` min-2 tests enforcement), `resources.ts` (URI parsing for all three resource patterns), and `prompts.ts` (`buildMessages` output for required and optional args) must have unit tests. The handlers can be tested by calling the exported functions with a mocked `client`.

- **[WARNING] `CODEVOLVE_TIMEOUT_MS` not validated against NaN in `client.ts` line 7.** `parseInt` returns `NaN` for non-numeric values. `setTimeout(fn, NaN)` fires immediately in Node.js, meaning every request is aborted before it starts. Add `isNaN(TIMEOUT_MS) ? 35000 : TIMEOUT_MS` or reject on startup with a clear error message.

- **[WARNING] `TOOL_DEFINITIONS` export in `tools.ts` (lines 205–475) is dead code.** `index.ts` never imports it. The array duplicates all schema information already expressed in the Zod schemas above it. This ~270-line block creates a sync burden with no current consumer. It should be deleted or, if kept for documentation purposes, that intent must be made explicit with a comment.

- **[WARNING] Resource handlers do not wrap `client.request` in try/catch.** Tools return `isError: true` content on API failure; resources propagate an uncaught error to the MCP SDK which returns a protocol error. This inconsistency will confuse agent authors who read the tools source and assume the same error contract applies to resources.

- **[SUGGESTION] `callApi` in `tools.ts` does not distinguish Zod validation errors from API errors.** Currently, a `ZodError` thrown by `.parse(raw)` before `fn()` is called would propagate uncaught and surface as a protocol error, while an API error inside `fn()` is caught and returned as `isError: true`. Moving the schema parse inside `callApi`'s try/catch would make all error paths return `isError: true` text, which is more agent-friendly and consistent.

- **[SUGGESTION] `improve_skill` prompt instructs the agent to "call `submit_skill` with the updated implementation" and "use the same ... inputs, outputs, examples, and tests." This implies the agent must fetch the full skill first (to copy those fields), but no corresponding `get_skill` call is suggested in the prompt template. Adding a line such as "First call `get_skill` with the skill_id to retrieve the full contract" would make the agent workflow self-contained.** (Optional — does not block approval.)

---

## Notes for Ada and Jorven

1. **Blocking for approval:** Two items must be fixed before this can be approved — the optional-arg bug and the missing test suite. The optional-arg bug is a functional correctness issue that makes `generate_skill` and `improve_skill` partially unusable as written today.

2. **Test strategy for the MCP server:** Because `client.ts` calls `process.exit(1)` at module load if `CODEVOLVE_API_URL` is missing, tests will need to set `process.env.CODEVOLVE_API_URL` before importing `client.ts`, or mock the `client` module. The latter is cleaner. `tools.ts` exports all handler functions and Zod schemas directly, making them straightforward to unit test without standing up a full MCP server.

3. **Dead `TOOL_DEFINITIONS` block:** If Jorven intends this array to serve as machine-readable OpenAPI-style metadata for tooling or documentation generation, that purpose should be documented and a consumer should be added. If it has no planned use, delete it.

4. **`.mcp.json` is correct** for local development. Before shipping to any CI or shared environment, `CODEVOLVE_API_KEY` should be injected via a secrets manager reference (e.g., AWS Secrets Manager ARN), not a plain env var entry in the JSON file.

5. **IMPL-06/IMPL-07 (REVIEW-07) are still in Request Changes state.** The MCP server's `execute_skill` and `chain_skills` tools call the `/execute` and `/execute/chain` endpoints respectively, which are not yet approved. Agents using this MCP server against the live API may encounter the `input_hash` / `version` missing-field bugs flagged in REVIEW-07 (CRITICAL-01) until that fix batch lands.

---

*Reviewed by Iris — REVIEW-IMPL-15 complete.*

---

## Iris Re-Review — IMPL-15: MCP Server (fix batch)

**Reviewer:** Iris
**Date:** 2026-03-21
**Re-review basis:** Two criticals from original REVIEW-IMPL-15 were reported fixed. This pass verifies C-01 and C-02, re-examines W-01 through W-03, and issues a final verdict.

---

### Verdict: APPROVED WITH NOTES

Both criticals are resolved. The remaining warnings are carry-overs from the original review. W-01 (NaN timeout) is the only one with operational consequence and must be fixed before the server is exposed to any environment where `CODEVOLVE_TIMEOUT_MS` is set from external configuration. W-02 (dead `TOOL_DEFINITIONS` block) and W-03 (inconsistent resource error handling) are unchanged and remain open as warnings.

---

### C-01 Resolution: RESOLVED

`index.ts` lines 248–251 now read:

```typescript
const argsSchema: Record<string, z.ZodTypeAny> = {};
for (const arg of promptDef.arguments) {
  const base = z.string().describe(arg.description);
  argsSchema[arg.name] = arg.required ? base : base.optional();
}
```

This is correct. `arg.required` is the source of truth in `PromptDefinition.arguments`. Confirmed from `prompts.ts`:

- `generate_skill.domain` — `required: false` — will produce `z.string().optional()`
- `improve_skill.confidence` — `required: false` — will produce `z.string().optional()`

The three required arguments in each prompt (`problem_description`, `language`, `examples` for `generate_skill`; `skill_id`, `current_implementation`, `failure_cases` for `improve_skill`) will produce `z.string()` without `.optional()`, which is correct.

The `prompts.test.ts` suite independently confirms the behavioral expectation: `"marks domain argument as optional"` (line 50) and `"marks confidence argument as optional"` (line 96) inspect `arg.required` directly on the definition objects. While these tests do not invoke the SDK schema construction path in `index.ts`, they verify the data contract that drives it.

**C-01 is fully resolved.**

---

### C-02 Resolution: RESOLVED

Three test files are present and all 36 tests pass (verified by running `npm test`):

**`tests/tools.test.ts` — 20 tests**

- `callApi` error wrapping: 3 tests covering HTTP error with parsed body, fallback when body is undefined, and success path. All three behaviors Iris required are present.
- All 7 tool HTTP paths covered: `resolveSkill` (3 tests including optional-field omission), `executeSkill` (2), `chainSkills` (3 including Zod enforcement on empty and over-length steps), `getSkill` (2), `listSkills` (2), `validateSkill` (1), `submitSkill` (4 including min-2 tests enforcement and min-1 examples enforcement).
- `submitSkill` Zod enforcement: 4 tests. Minimum 2 tests case is present (`rejects when tests has fewer than 2 items`). Minimum 1 examples case is present (`rejects when examples is empty`). Required field missing case is present. Valid full contract accepted is present.
- The mock strategy (`vi.mock("../src/client.js", ...)` before import) correctly prevents `process.exit(1)` in `client.ts` from running during test collection.

**`tests/resources.test.ts` — 8 tests**

- `readSkillResource`: URI-to-path extraction, MIME type, JSON serialization (3 tests).
- `readProblemResource`: URI-to-path extraction, MIME type (2 tests).
- `readSkillsListResource`: no-param path, query string forwarding, MIME type (3 tests).
- All three resource handlers are covered.

**`tests/prompts.test.ts` — 8 tests**

- `generate_skill`: required arg interpolation, `domain` default to `"general"`, `submit_skill`/`validate_skill` instructions present, `domain` marked optional (4 tests).
- `improve_skill`: required arg interpolation, `confidence` default to `"unknown"`, `submit_skill`/`validate_skill` instructions present, `confidence` marked optional (4 tests).

**Test output (exact):**

```
Test Files  3 passed (3)
      Tests  36 passed (36)
   Duration  738ms
```

**C-02 is fully resolved.**

---

### Warnings — Status

**W-01: `CODEVOLVE_TIMEOUT_MS` NaN not guarded — STILL OPEN, NOT FIXED**

`client.ts` line 7 reads:

```typescript
const TIMEOUT_MS = parseInt(process.env["CODEVOLVE_TIMEOUT_MS"] ?? "35000", 10);
```

`parseInt("abc", 10)` returns `NaN`. `NaN` is then stored in `TIMEOUT_MS` and passed directly to `setTimeout(() => controller.abort(), this.timeoutMs)` on every request. Per the ECMAScript spec and Node.js behavior, `setTimeout(fn, NaN)` is treated as `setTimeout(fn, 0)`, firing the abort immediately before the `fetch` has any chance to receive a response. Every outbound request would be aborted with a `DOMException: The operation was aborted` signal error the instant the call is made.

This is not a startup failure — there is no guard like the `if (!API_URL)` check applied to the URL. A misconfigured `CODEVOLVE_TIMEOUT_MS` in `.mcp.json` or an injected environment silently breaks all tool calls at runtime with no log message pointing to the cause.

This remains a warning. It does not block approval because the default value `"35000"` is numeric and the env var is optional, meaning most deployments are safe. But it must be fixed before the server is deployed to any environment where env var values are injected from external sources (CI secrets, AWS parameter store, etc.).

**W-02: Dead `TOOL_DEFINITIONS` export in `tools.ts` — STILL OPEN, NOT FIXED**

Lines 205–475 of `tools.ts` export `TOOL_DEFINITIONS`, a 270-line array of raw JSON schema objects with embedded `handler` references. `index.ts` does not import this array. No other file in the package imports it. The array duplicates all information already present in the Zod schemas above it and in the `server.registerTool` calls in `index.ts`.

This is unchanged from the original review. It remains a warning, not a blocker.

**W-03: Resource handlers do not wrap `client.request` in try/catch — STILL OPEN, NOT FIXED**

`readSkillResource`, `readProblemResource`, and `readSkillsListResource` all call `client.request(...)` without a try/catch. On non-2xx responses, the error propagates to the MCP SDK which converts it to a protocol-level `InternalError` response. Tool handlers use `callApi` and return `isError: true` text content instead. The inconsistency is unchanged.

---

### Review Questions

**1. Would a senior engineer approve this implementation?**

Yes, with the noted warnings. The code is readable, the layering is clean, and all handler functions are individually testable. The fix for C-01 is minimal and correct — a single conditional per argument rather than a type-switch or separate arrays. The test suite follows the right strategy (mock `client.js` at the module level) and covers the behaviors that matter.

**2. Is there a simpler solution?**

No change from original review. `TOOL_DEFINITIONS` is still the obvious dead-code candidate.

**3. Are there unintended side effects?**

None introduced by the fix batch. The change to `index.ts` is limited to the prompt argument schema construction loop. No other registration path was modified.

**4. Are edge cases handled?**

C-01 closed the primary gap. The remaining open edge cases are:

- NaN timeout (W-01) — operational risk, not yet guarded.
- Empty skill ID in resource URI — still produces a `/skills/` API call, gets a 404, propagates as a protocol error. Acceptable given the API is the trust boundary.

**5. Does the change follow the architectural plan?**

Yes. No scope creep was introduced. The MCP server remains a pure translation layer.

---

### Security Check

- **Input validation:** Pass — no change to validation path.
- **DynamoDB safety:** N/A.
- **Sandbox integrity:** N/A.
- **Error response safety:** Pass — no change to error serialization.

---

### Issues Found (this pass)

- **[WARNING] W-01 — `CODEVOLVE_TIMEOUT_MS` NaN guard still absent.** `parseInt` can return `NaN` for non-numeric env var values. `setTimeout(fn, NaN)` fires at delay 0, aborting every request immediately. Fix: add `isNaN(TIMEOUT_MS) ? 35000 : TIMEOUT_MS` assignment after the `parseInt` call, or add a startup check alongside the `API_URL` guard.
- **[WARNING] W-02 — `TOOL_DEFINITIONS` export in `tools.ts` is dead code.** No import found anywhere in the package. Remove or document the intended consumer.
- **[WARNING] W-03 — Resource handlers propagate API errors as protocol errors.** Tool handlers use `callApi` and return `isError: true` text; resource handlers do not. The inconsistency is undocumented.

---

### Notes

1. **W-01 must be addressed before any deployment where env vars are injected externally.** For local development with `.mcp.json` as written, the risk is low because `CODEVOLVE_TIMEOUT_MS` is not set in that file and the default `"35000"` parses correctly.

2. **Approval is conditional on W-02 being cleaned up before the next implementation phase.** If `TOOL_DEFINITIONS` is intended as machine-readable metadata for a future documentation generator or SDK, that consumer should be scaffolded now so the array has an auditable purpose.

3. **The test suite is well-structured for this package's constraints.** Mocking `client.js` at the module boundary is the right approach and is correctly implemented using `vi.mock` before the import statement.

---

*Re-reviewed by Iris — REVIEW-IMPL-15 re-review complete. Final verdict: APPROVED WITH NOTES.*
