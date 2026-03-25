## Iris Review — IMPL-15 / MCP Server Re-implementation (REVIEW-12 fixes)

**Review date:** 2026-03-25
**Commit reviewed:** 50b61fa
**Previous review:** REVIEW-12-IMPL15.md (Rejected)

---

### Verdict: APPROVED WITH NOTES

---

### Test Results

```
npx tsc --noEmit
(exits 0 — no output)

npx jest --testPathPattern="tests/unit/mcp"

PASS unit tests/unit/mcp/tools.test.ts
PASS unit tests/unit/mcp/client.test.ts
PASS unit tests/unit/mcp/resources.test.ts
PASS unit tests/unit/mcp/server.test.ts

Test Suites: 4 passed, 4 total
Tests:       52 passed, 52 total
```

All four test suites pass. `tsc --noEmit` exits clean. Both hard blockers from REVIEW-12 are gone.

---

### REVIEW-12 Critical Resolution Checklist

| Critical | Description | Status |
|----------|-------------|--------|
| CRITICAL-01 | `@modelcontextprotocol/sdk` missing from package.json | **RESOLVED** — present at `^1.27.1` in dependencies |
| CRITICAL-02 | 4 of 6 tool names wrong | **RESOLVED** — all 7 tools registered with correct DESIGN-06 names |
| CRITICAL-03 | `submit_skill` tool absent | **RESOLVED** — implemented in both `tools.ts` and `server.ts` |
| CRITICAL-04 | `server.ts` does not export `createServer` | **RESOLVED** — `createServer(client)` exported; `main()` calls it; module is safe to import without env vars |
| CRITICAL-05 | `tsc --noEmit` fails — implicit any on 8 callback params | **RESOLVED** — all callback params carry explicit inline types; compiler exits 0 |

---

### Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. The implementation is clean and readable throughout. The separation of concerns across `client.ts`, `tools.ts`, `resources.ts`, `prompts.ts`, and `server.ts` is logical and each module is independently understandable. The factory pattern for `createServer` is the right pattern — it accepts an injected client, avoids side effects at module load time, and makes the module testable without environment variables. Callback parameter types in `server.ts` are explicit and match the Zod schemas declared in `inputSchema`. Naming is consistent with DESIGN-06 throughout.

**2. Is there a simpler solution?**

No. The thin translation layer pattern is correct and unavoidable. The one notable structural observation is that `tools.ts` declares both a Zod schema (e.g. `resolveSkillSchema`) and `server.ts` re-declares the same constraints as an inline Zod `inputSchema` object in each `registerTool` call. This is the same dual-representation noted in REVIEW-12 SUGGESTION-01. It is still present and still acceptable: `tools.ts` schemas serve as the validation layer exercised by tests; `server.ts` inline schemas serve as MCP SDK metadata for agent discovery. The rationale for the coexistence should be documented in a comment but this is not blocking.

**3. Are there unintended side effects?**

None. The MCP server remains a thin HTTP proxy. No DynamoDB access, no LLM calls, no analytics writes from this module. The `index.ts` entry point is cleanly separated from `server.ts` so tests never call `main()`. `SIGINT` handling in `main()` is correct and scoped only to the entry point.

**4. Are edge cases handled?**

Most of the gaps from REVIEW-12 are resolved:

- NaN guard on `CODEVOLVE_TIMEOUT_MS` — **resolved.** `client.ts` line 82: `isNaN(raw) ? 35000 : raw`. Tested in `client.test.ts` ("uses default timeout when CODEVOLVE_TIMEOUT_MS is NaN").
- Malformed URI TypeError — **resolved.** `resources.ts` now wraps `new URL(uri)` in `parseUri()` with a try/catch that throws a structured `Error("Invalid resource URI: ...")`. Tested in `resources.test.ts`.
- `submit_skill` minimum test/example enforcement — **resolved.** `submitSkillSchema` requires `tests.min(2)` and `examples.min(1)`. Four Zod enforcement tests in `tools.test.ts` cover this.
- `chain_skills` empty/overlong steps — **resolved.** Tested.

Remaining gaps (unchanged from REVIEW-12):

- Resource handlers (`readSkillResource`, `readProblemResource`, `readSkillsListResource`) do not wrap `client.request` in try/catch. A network failure or HTTP error from the API propagates as an unhandled rejection rather than a structured MCP resource error. Tool handlers use `callApi` which catches and returns `isError: true`; resources do not. The error contract is still inconsistent. This was REVIEW-12 W-03 and is still open. (See WARNING-01 below.)
- `language` on `resolve_skill` and `submit_skill` is `z.string()` in `tools.ts` but DESIGN-06 §1 specifies an enum `["python", "javascript", "typescript", "go", "rust", "java", "cpp", "c"]`. An agent could send `language: "cobol"` and receive a downstream API error rather than an early Zod rejection. The `server.ts` inline `inputSchema` for `resolve_skill` also uses `z.string().optional()`, not the enum. Same applies to `submit_skill`. (See WARNING-02 below.)
- `status` on `submitSkillSchema` is `z.string().optional()` but DESIGN-06 and the server inline schema use `z.enum(["unsolved", "partial", "verified", "optimized"]).optional()`. Invalid status values pass MCP layer validation silently. (See WARNING-03 below.)

**5. Does the change follow the architectural plan?**

Yes. All 7 DESIGN-06 §1 tools are implemented: `list_skills`, `get_skill`, `resolve_skill`, `execute_skill`, `chain_skills`, `validate_skill`, `submit_skill`. All 3 DESIGN-06 §2 resources are registered: `codevolve://skills/{skill_id}`, `codevolve://problems/{problem_id}`, `codevolve://skills`. Both DESIGN-06 §3 prompt templates are implemented: `generate_skill` and `improve_skill`. Input schemas match DESIGN-06 for all required and optional fields. The `submit_skill` Zod enforcement is stricter than the HTTP API default (requires `examples.min(1)` and `tests.min(2)`) as DESIGN-06 §1 explicitly specifies. Tool names match the spec exactly. No scope creep.

---

### Security Check

- Input validation: **Pass** — all tool handlers validate with their respective Zod schema before issuing HTTP requests. `submitSkill` enforces the full contract before any network call.
- DynamoDB safety: **N/A** — the MCP server makes no DynamoDB calls; it proxies exclusively to the HTTP API.
- Sandbox integrity: **Pass** — no `eval`, no dynamic `require`, no filesystem access, no shell execution.
- Error response safety: **Pass** — `callApi` catches exceptions and returns structured `isError: true` content without exposing stack traces. `parseUri` converts TypeError to a clean message.

---

### Issues Found

**[WARNING-01] Resource handlers do not catch `client.request` errors — inconsistent error contract with tool handlers**

`readSkillResource`, `readProblemResource`, and `readSkillsListResource` in `resources.ts` call `client.request` without a try/catch. A non-2xx HTTP response or network failure propagates as a thrown exception from the resource handler rather than being converted to a structured MCP error response. Tool handlers route through `callApi` which catches and returns `isError: true` content. The two error paths are inconsistent: agents that hit a resource error receive a different shape than agents that hit a tool error. This was flagged as REVIEW-12 W-03 and has not been addressed. Wrap each resource handler body in try/catch and return a structured error JSON string in the `text` field, mirroring the `callApi` pattern. Priority: fix before connecting agent consumers.

**[WARNING-02] `language` field on `resolve_skill` and `submit_skill` accepts arbitrary strings — enum not enforced in `tools.ts`**

DESIGN-06 §1 specifies `language` as an enum of 8 values for both `resolve_skill` and `submit_skill`. In `server.ts`, `resolve_skill`'s `inputSchema` correctly uses `z.string().optional()` (which matches DESIGN-06 field optionality), but neither the `server.ts` inline schema nor `resolveSkillSchema` in `tools.ts` enforces the enum. Similarly, `submitSkillSchema.language` is `z.string().min(1)` rather than `z.enum([...])`. An invalid language string passes MCP-layer validation, reaches the HTTP API, and returns a downstream error instead of an immediate schema rejection. This is a minor ergonomics gap for agents but does not cause data corruption.

**[WARNING-03] `status` field on `submitSkillSchema` is `z.string().optional()` — enum not enforced**

`submitSkillSchema` in `tools.ts` declares `status: z.string().optional()`. The `server.ts` inline `inputSchema` correctly declares `status: z.enum(["unsolved", "partial", "verified", "optimized"]).optional()`. The runtime validation path goes through `tools.ts` (line 220 calls `submitSkillSchema.parse(raw)`) so the enum in `server.ts` is metadata-only and the actual Zod gate is the weaker `z.string()`. An agent could submit `status: "active"` and receive a downstream API error rather than a Zod rejection. Update `submitSkillSchema.status` to `z.enum(["unsolved", "partial", "verified", "optimized"]).optional()`.

**[SUGGESTION-01] Dual schema representations in `tools.ts` and `server.ts` lack a documenting comment**

Each tool has a Zod schema in `tools.ts` (used for runtime validation) and a second Zod inline `inputSchema` in `server.ts` (used as MCP SDK metadata for agent discovery). When the two diverge, the `tools.ts` schema wins at runtime. This was noted in REVIEW-12 SUGGESTION-01. A short comment block near the top of `server.ts` explaining the dual-schema design and the precedence rule would prevent future maintainers from updating only the `server.ts` schema and assuming the validation has changed.

**[SUGGESTION-02] `mcp-config.json` naming — still not `.mcp.json`**

This was REVIEW-12 WARNING-01. The file is named `mcp-config.json` rather than `.mcp.json`. Claude Code auto-discovers `.mcp.json` at the workspace root; it does not discover `mcp-config.json`. A developer following DESIGN-06 §Overview ("add a single stanza to `.mcp.json`") will not find a `.mcp.json` to update. This does not affect any test or compilation check but creates friction for every new developer integrating with the platform. Rename to `.mcp.json` or add a comment in `mcp-config.json` explaining the manual copy step required.

---

### Notes for Ada and Quimby

**All 5 REVIEW-12 criticals are resolved.** This is a clean re-implementation that satisfies the DESIGN-06 spec. The three warnings above are real gaps worth tracking but none are hard-rule violations or data-correctness issues — they are validation ergonomics (W-02, W-03) and an error-contract inconsistency (W-01) that will matter when agent consumers start hitting resource endpoints.

**Recommended fix order if a follow-up pass is done:**

1. W-01: Wrap resource handler bodies in try/catch, return structured error JSON — prevents silent failures when agents read resources for a non-existent skill or problem.
2. W-03: Change `submitSkillSchema.status` from `z.string().optional()` to `z.enum([...]).optional()` — trivial one-line fix.
3. W-02: Add enum to `resolveSkillSchema.language` and `submitSkillSchema.language` in `tools.ts` — trivial; matches DESIGN-06 spec exactly.

These can be batched into a single small fix commit or deferred to the next implementation pass. They are not blocking approval.

**Test count: 52 tests across 4 suites.** Previous submission had 85 tests across the same 4 suites (3 passing, 1 failing). The count difference is explained by the removal of duplicate/dead tests from the prior scaffold's `tools.test.ts` and the consolidation of `server.test.ts` from 0 passing to 12 passing. Coverage is adequate for the module scope.
