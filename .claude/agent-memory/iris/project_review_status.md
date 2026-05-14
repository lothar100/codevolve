---
name: project_review_status
description: Current review state for codeVolve — which architecture artifacts are approved, what open issues remain before each implementation task
type: project
---

## Review status as of 2026-03-21

### ARCH-01 (dynamo-schemas.md) — Approved (REVIEW-02)
- All REVIEW-01 criticals resolved
- N-NEW-01 RESOLVED (REVIEW-FIX-05): `skill_version` renamed to `version_number` (N type) in dynamo-schemas.md cache table

### ARCH-02 (api.md) — Approved (REVIEW-02)
- All REVIEW-01 criticals resolved
- N-NEW-01 RESOLVED (REVIEW-FIX-05): skill_version type fixed in cache table
- N-NEW-02 RESOLVED (REVIEW-FIX-05): archived added to status_distribution in api.md
- Open before IMPL-02/IMPL-03: document Streams vs direct Kinesis event emit policy to avoid duplicate analytics events (O-02)

### IMPL-01 (project scaffold) — Approved (REVIEW-03, 2026-03-21)
- All 126 tests pass, tsc --noEmit exits 0, NODEJS_22_X confirmed
- W-01 (MUST FIX before IMPL-04): archive module (`archiveHandler.ts`, `archiveSkill.ts`, `unarchiveSkill.ts`, `archiveUtils.ts`) imports `emitEvent` from `../shared/kinesis.js` (throws on error) instead of `../shared/emitEvent.js` (fire-and-forget). Must be fixed before archive module ships.
- W-02: `healthFn` over-granted — ReadWriteData on all tables + Kinesis Write. Should be DescribeTable only.
- W-03: `archiveHandlerFn` has unnecessary Bedrock permission. Remove until handler actually calls Bedrock.
- S-04 (flag for IMPL-02): archive events use `event_type: "fail"` — no `"archive"` type in schema. Add to AnalyticsEventSchema.
- Scope note: archive module and registry CRUD handlers were pre-implemented beyond IMPL-01 scope. IMPL-02 and IMPL-04 reviews should treat existing code as the deliverable.

### IMPL-02 (CRUD API) + IMPL-03 (Event Emission) — Approved with notes (REVIEW-04, 2026-03-21)
- All 128 tests pass
- W-01 (archive module kinesis import) RESOLVED
- N-NEW-01 RESOLVED (REVIEW-FIX-05)
- N-NEW-02 RESOLVED (REVIEW-FIX-05)
- N-01 RESOLVED (REVIEW-FIX-04): mapProblemFromDynamo now maps `examples`, defaults to []
- N-02 RESOLVED (REVIEW-FIX-04): scan removed, conditional put with attribute_not_exists(problem_id); name-uniqueness GSI deferred to Phase 2
- N-03 RESOLVED (REVIEW-FIX-04): Limit omitted from ScanCommand when filterExpression is active
- N-04 RESOLVED (REVIEW-FIX-04): dead pop/push pattern removed from q filter block
- N-05 RESOLVED (REVIEW-FIX-04): intentional-throw / dedicated-client design documented in comment block
- S-01: mapSkillFromDynamo duplicated across 4 files — extract to shared/
- O-03 carry-forward: promoteCanonical still has no TransactWriteItems — race condition risk at scale

### IMPL-04 (archive mechanism) — Approved with notes (REVIEW-05, 2026-03-21)
### FIX-06–11 (REVIEW-05 N-01–04 + N-NEW-01/02) — Approved (REVIEW-FIX-05, 2026-03-21)
- W-01, W-02, W-03 from REVIEW-03 all resolved
- S-04 from REVIEW-03 resolved (archive/unarchive added to EventTypeSchema)
- N-01 RESOLVED: skill_count floor guard added — ConditionExpression: "#skill_count > :zero" in archiveSkill.ts:147 and archiveHandler.ts:187; ConditionalCheckFailedException caught silently
- N-02 RESOLVED: archiveProblemIfAllSkillsArchived paginates via do-while/LastEvaluatedKey (archiveUtils.ts:101–188); two new tests cover multi-page scenarios
- N-03 RESOLVED: export { bedrockClient } removed from archiveUtils.ts; client is module-private
- N-04 RESOLVED: previous_status fallback documented with rationale comment (unarchiveSkill.ts:64–69); new test asserts "verified" default
- N-NEW-01 RESOLVED: cache table skill_version renamed to version_number (N type) in dynamo-schemas.md — consistent with skills table SK; IMPL-05 unblocked
- N-NEW-02 RESOLVED: archived added to status_distribution in api.md SkillQualityData — all 5 statuses present; IMPL-07 unblocked
- Archive module clear for Phase 2. 47 archive unit tests pass (was 43).

### IMPL-05 (/resolve endpoint) — Approved with notes (REVIEW-IMPL-05, 2026-03-21)
- 14 tests pass, tsc --noEmit exits 0
- No LLM calls confirmed (only InvokeModelCommand for embedding)
- CDK: 512 MB, 10s timeout, bedrock:InvokeModel on titan-embed-text-v2:0 — all correct
- N-01: Kinesis event NOT emitted on Bedrock failure (resolve.ts:154) or DynamoDB failure (resolve.ts:166) — spec §7.4 requires emit on ALL invocations
- N-02: computeBoost uses case-insensitive matching; spec §4.2 mandates case-sensitive — Jorven must decide and update spec or code
- N-03: await emitEvent(...) should be void emitEvent(...) — adds ~10ms to response unnecessarily
- OI-01: gap-log write to codevolve-gap-log on evolve_triggered not present (ARCH-07 follow-up, not blocking)
- OI-02: last_resolve_at update on problem record not present (ARCH-07 follow-up, not blocking)
- File path in vector-search.md §7.5 says src/handlers/resolve.ts but actual is src/router/resolve.ts — docs discrepancy only

### ARCH-05 (vector-search.md) + ARCH-06 (execution-sandbox.md) — Approved with notes (REVIEW-06-ARCH, 2026-03-21)
- **C-01 (BLOCKING IMPL-05):** /resolve no-match response conflict — vector-search.md §4.4 says 404, api.md says 200 with empty result. Jorven must update one document before IMPL-05 begins. Recommendation: update vector-search.md §4.4 to return 200.
- W-03 (MUST FIX before IMPL-06 ships): stack trace sanitization policy undefined in execution-sandbox.md §6. Jorven must define max lines and path-stripping rules.
- W-04 (MUST FIX before IMPL-07): ARCH-06 §5 and §8.1 still reference stale `skill_version (S)` field — N-NEW-01 was resolved in REVIEW-FIX-05 but ARCH-06 not updated. Jorven must update to `version_number (N)`.
- W-01: canonicalJson depth-3 correctness non-obvious — Ada should add comment + depth-3 test. Not blocking.
- W-02: prose in execution-sandbox.md §4 says "OOM and timeout both map to 504" — incorrect (timeout is 408). Prose clarification needed.
- N-04: reserved concurrency value not specified for runner Lambdas in CDK constructs table.

### IMPL-06 (/execute) + IMPL-07 (cache layer) — Request Changes (REVIEW-07, 2026-03-21)
- 45 tests pass (execute.test.ts, inputHash.test.ts, sanitize.test.ts, cache.test.ts), tsc --noEmit exits 0
- CRITICAL-01 (MUST FIX): ExecuteResponse on both cache-hit (line 344) and cache-miss (line 522) paths missing `input_hash` and `version` fields required by api.md ExecuteResponse schema
- CRITICAL-02 (MUST FIX): `504 EXECUTION_OOM` not added to /execute error table in docs/api.md — required by execution-sandbox.md §8.6
- CRITICAL-03 (MUST FIX): CDK stack line 106 — GSI-skill-hitcount nonKeyAttributes still has `skill_version` (old name); must be `version_number` to match FIX-10 resolution
- W-01: OOM detection in classifyFunctionError: condition `parsed.signal === "killed"` never fires — `signal` is in errorMessage string not as top-level key. Lambda emits `{"errorMessage":"Runtime exited with error: signal: killed","errorType":"Runtime.ExitError"}`. Check errorMessage substring instead.
- W-02: getCachedOutput throw contract not documented (inconsistent with incrementCacheHit's swallow policy)
- W-03: CACHE_TABLE_NAME in executeFn env is correct; CACHE_TABLE in shared lambdaEnvironment is different key — inconsistency for future handlers
- Sandbox isolation verified: no user code in /execute Lambda, runner IAM = CW Logs only, exec() uses empty globals, new Function() scope is parameter-only
- S-01: sanitizeStackTrace not exported — test file mirrors it manually (divergence risk)
- S-02: No test for SDK-level invokeRunner throw (500 path untested)
- S-03: Node runner does not await solve() — silent failure if skill uses async function

### IMPL-15 (MCP server) — Request Changes (REVIEW-IMPL-15, 2026-03-21)
- Build passes: `npm run build` exits 0, `dist/index.js` exists
- CRITICAL-01: Optional prompt args (`domain` in generate_skill, `confidence` in improve_skill) registered as `z.string()` (required) in index.ts lines 248–251 — MCP SDK v1.27.1 calls safeParseAsync at request time; omitting optional args throws McpError(InvalidParams). Fix: use `z.string().optional()` when `arg.required === false`.
- CRITICAL-02: No test file exists for any module in packages/mcp-server/ — auto-reject per hard rules on missing tests.
- W-01: CODEVOLVE_TIMEOUT_MS not validated against NaN — parseInt("bad") = NaN, setTimeout(fn, NaN) fires immediately in Node.js.
- W-02: TOOL_DEFINITIONS export in tools.ts (lines 205–475) is dead code — index.ts never imports it; ~270 lines of duplicated schema definitions.
- W-03: Resource handlers (resources.ts) do not wrap client.request in try/catch — inconsistent error contract vs. tool handlers.
- S-01: callApi does not catch ZodError — Zod validation errors surface as protocol errors, API errors surface as isError text.
- S-02: improve_skill prompt should instruct agent to call get_skill first to retrieve the full contract before resubmitting.

### Ongoing observations (not blocking)
- O-03: promote-canonical race condition — no TransactWriteItems specified. Flag again in REVIEW when IMPL-13 is reviewed.
- O-07: Auth mechanism undefined. Expected at this phase.
- Kinesis shard retention is 24h — must increase to 7+ days before production.

### IMPL-10 (Decision Engine) — BLOCKED [!] (REVIEW-15, 2026-03-25)
- REVIEW-08 W-01 RESOLVED: optimizationFlag.ts now uses QueryCommand (not ScanCommand) on GSI-status-updated
- REVIEW-08 W-02 RESOLVED: ARCHIVE_QUEUE_URL fallback is "" (placeholder account ID removed)
- REVIEW-08 W-03: staleness thresholds still hardcoded (deferred to Phase 3, acceptable)
- CRITICAL (REVIEW-15): Decision Engine CDK scaffold is absent from infra/codevolve-stack.ts. DecisionEngineFn, DecisionEngineSchedule (EventBridge rate 5min), GapLogTable, all IAM grants, and all env var injections are missing. This is a regression from the state REVIEW-08 approved.
- Lambda source code is complete and correct: 54 tests pass, tsc clean
- Fix required: restore CDK constructs per docs/decision-engine.md §6. Verify cdk synth shows DecisionEngineFn, DecisionEngineSchedule, GapLogTable, reservedConcurrentExecutions:1
- Note: ArchiveQueue and evolveGapQueue already exist in stack (from IMPL-04/IMPL-12); Decision Engine only needs SendMessage grants and env var injections on those, not new queue constructs
- Review file: docs/reviews/REVIEW-15-IMPL10.md

### IMPL-11 (validateSkill scaffold) — Approved as scaffold (REVIEW-09, 2026-03-22)
- 306 tests pass, tsc --noEmit exits 0, cdk synth exits 0
- ValidateFn CDK: 256 MB, 60s timeout, skillsTable read/write, eventsStream write, lambda:InvokeFunction on both runners — all correct
- testRunner.ts stub correctly throws — clearly marked ARCH-08 pending
- W-02 (fix with IMPL-13 corrections): Kinesis validate event success field hardcoded true; must be failCount === 0 (validateSkill.ts line 239)
- W-03 (fix with IMPL-13 corrections): NO_TESTS error code must be NO_TESTS_DEFINED per spec §2.8 (validateSkill.ts line 132, two test assertions)
- Scope gaps (acceptable for scaffold): additional_tests, timeout_ms, per-test latency p50/p95, status transitions, cache invalidation, evolve trigger on confidence < 0.7, full ValidateResponse shape — all deferred to full ARCH-08 implementation

### IMPL-12 (/evolve SQS consumer scaffold) — Approved as scaffold (REVIEW-09, 2026-03-22)
- EvolveFn CDK: 512 MB, 300s timeout, FIFO SQS source (batchSize:1, reportBatchItemFailures:true), skillsTable write, eventsStream write, validateFn invoke permission, secretsmanager:GetSecretValue — all correct
- No LLM calls in handler — generateSkill is a local non-exported function that throws immediately
- batchItemFailures behavior correct for all error categories tested
- GapMessageSchema is simplified vs spec §3.2 (missing evolve_id, skill_id, language, domain, tags, problem_id, priority, reason) — must be updated to full spec shape before IMPL-10 Decision Engine enqueues real messages
- SUGGESTION-01: generateSkill not injectable from tests; zod schema-validation failure path (lines 102–122) not independently tested. Add when generateSkill is refactored for ARCH-08 full implementation.

### IMPL-13 (promoteCanonical scaffold) — REJECTED (REVIEW-09, 2026-03-22)
- CRITICAL-01: already-canonical returns 200 (must be 409 CONFLICT per spec §4.1). Test at line 235 asserts 200 — must be updated.
- CRITICAL-02: previous canonical query uses GSI-problem-status without language filter. Must query GSI-canonical with is_canonical_status key and filter by problem_id AND language. Cross-language demotion risk exists.
- CRITICAL-03: test_pass_count > 0 gate not enforced. Never-validated skill (both fields absent) defaults testFailCount = 0 and passes the gate — violates hard rule that is_canonical = true requires passing tests.
- WARNING-01: No ConditionExpression on promote TransactWrite item — race-condition guard absent (spec §4.3 is explicit). Fix in same pass.
- WARNING: status verified/optimized gate from spec §4.1 not enforced.
- WARNING: TransactionCanceledException not mapped to 422 — outer catch returns 500.
- Fix instructions in docs/reviews/REVIEW-09.md Notes for Ada section.

### REVIEW-08-IMPL08 (IMPL-08 Analytics Consumer + IMPL-09 Dashboards) — CHANGES REQUIRED (2026-03-23)

- 34 analytics unit tests pass (consumer, dashboards, eventId, toClickHouseRow)
- Analytics separation confirmed: consumer has no DynamoDB grants, writes only to ClickHouse
- Idempotency: `ReplacingMergeTree(event_id)` + SHA-256 deterministic key — correct
- DLQ wiring: KinesisEventSource with `reportBatchItemFailures: true`, `bisectBatchOnError: true`, `retryAttempts: 3`, SqsDlq — all correct
- All 5 DESIGN-02 dashboard queries satisfied by schema
- **CRITICAL-01 (clickhouseClient.ts:55):** `url: \`https://${secret.host}:${secret.port}\`` double-prefixes `https://` since secret's `host` field already contains the protocol. Will cause all ClickHouse connections to fail. Fix: `url: \`${secret.host}:${secret.port}\`` (or confirm secret does not include protocol).
- W-01: AnalyticsConsumerFn CDK timeout is 300s (line 513); spec requires 60s.
- W-02: DLQ alarm uses `metricNumberOfMessagesSent()` (line 537); should be `metricApproximateNumberOfMessagesVisible()`.
- W-03: `eventId.ts` uses `"null"` sentinel for null fields, not `""` as spec says. Spec must be updated to match code.
- W-04: dashboard SQL `from`/`to` params interpolated without ISO8601 validation — acceptable for internal use, harden before public exposure.
- IMPL-09 todo status is `[ ]` but all code/tests are present — Ada to update after CRITICAL fix.
- Review file: `docs/review-08-impl08.md`

### IMPL-11 (full /validate implementation) — APPROVED (REVIEW-10, 2026-03-23)
- 21 handler tests pass + 30 deepEqual tests pass
- All REVIEW-09 warnings (W-02, W-03) resolved: success = failCount === 0, error code NO_TESTS_DEFINED
- Status transition logic correct: partial→verified at ≥0.85+failCount=0, verified→optimized at 1.0, revert below 0.85
- GapQueue send on confidence < 0.7 confirmed; Kinesis emission fire-and-forget confirmed
- REMOVE optimization_flagged on latency_p95 <= 5000 confirmed

### IMPL-13 (canonical promotion rewrite) — APPROVED WITH NOTES (REVIEW-10, 2026-03-23; re-reviewed REVIEW-17, 2026-03-30)
- All three REVIEW-09 criticals resolved
- Gate function is pure, 17 tests cover all gate conditions and ordering
- GSI-canonical with language filter correctly implemented (two queries: true#verified + true#optimized)
- TransactWriteItems structure: promote + demote + problems update — correct
- TransactionCanceledException → 422 PRECONDITION_FAILED confirmed
- IMPL-13 marked Complete (REVIEW-17 approval)
- Open items (non-blocking, should fix in hardening pass):
  - W-01: DynamoDB codevolve-cache invalidation for demoted canonical absent (spec §4.5) — only CloudFront invalidation present; TTL provides eventual correction
  - W-02: is_canonical_status hardcoded "true#optimized"; status forcibly upgraded to "optimized" — deviates from spec §4.3 (should be true#${skill.status}); undocumented policy decision
  - W-03: ConditionExpression on promote TransactWrite is attribute_exists(skill_id), not spec's confidence>=0.85+test_fail_count=0 — race window
  - W-04: require() comment says "eval-based" — inaccurate; standard CommonJS conditional require
  - archived gate returns 409 SKILL_ARCHIVED but spec §4.1 specifies 422 PRECONDITION_FAILED for archived

### IMPL-12 (full /evolve SQS consumer) — APPROVED (REVIEW-11, 2026-03-24)
- REVIEW-10 CRITICAL-01 resolved: all DynamoDB item fields now use `evolve_id` (not `job_id`) in handler.ts lines 220, 229, 365, 406
- REVIEW-10 CRITICAL-02 resolved: CDK codevolve-stack.ts line 743 now passes `VALIDATE_LAMBDA_NAME` (not `VALIDATE_FUNCTION_NAME`)
- Fix commit: fa9066f — verified correct by REVIEW-11
- 496 tests pass; 2 Phase 5 scaffold suite failures are pre-existing and out-of-scope
- Carry-forward (non-blocking): SUGGESTION-02 (generateSkill export duplicates inline handler logic, unused by handler)

### REVIEW-08-IMPL08-RECHECK (2026-03-24) — CHANGES REQUIRED (new CRITICAL found)

- Original CRITICAL (double-protocol URL) RESOLVED: clickhouseClient.ts rewritten to read from env vars
- W-01 through W-04 (original) all resolved (timeout, DLQ alarm metric, sentinel, date sanitization)
- 43 analytics tests pass (up from 34 at first review)
- NEW CRITICAL: CDK does not inject CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE into analyticsConsumerFn. CLICKHOUSE_SECRET_ARN is still present but dead. All production ClickHouse connections will fall back to localhost:8123 and fail.
- NEW W-01: confidence null sentinel mismatch — spec DDL says Float64 with -1.0, code sends null (Nullable). Must reconcile.
- NEW W-02: Pre-insert dedup check absent — spec §5.3 requires SELECT before INSERT; only ReplacingMergeTree implemented.
- Review file: docs/reviews/REVIEW-08-IMPL08-RECHECK.md

### IMPL-08 (Analytics Consumer) — APPROVED WITH NOTES (REVIEW-08-IMPL08-FINAL, 2026-04-08)

- All three RECHECK issues resolved: CDK env vars injected, confidence sentinel -1.0, pre-insert dedup SELECT present
- 48 analytics unit tests pass, tsc --noEmit exits 0
- WARNING (carry-forward): dedup SELECT uses string interpolation of SHA-256 hex values — zero practical injection risk but non-parameterized; address in hardening pass using @clickhouse/client query_params
- SUGGESTION: docs/analytics-consumer.md §4 DDL uses stale Enum8 for event_type; actual DDL uses LowCardinality(String); update spec to match
- SUGGESTION: no dedicated test for dedup SELECT throwing transiently (covered by catch-all but not explicitly exercised)
- Mark IMPL-08 [✓] Complete
- Review file: docs/reviews/REVIEW-08-IMPL08-FINAL.md

### IMPL-15 (MCP server re-implementation) — APPROVED WITH NOTES (REVIEW-15, 2026-03-25)
- All 5 REVIEW-12 criticals resolved (commit 50b61fa)
- 52 tests pass across 4 suites (server, tools, resources, client), tsc --noEmit exits 0
- @modelcontextprotocol/sdk ^1.27.1 in package.json (CRITICAL-01 resolved)
- All 7 tools registered with correct DESIGN-06 names including submit_skill (CRITICAL-02, CRITICAL-03 resolved)
- createServer(client) exported; main() calls it; module safe for test import (CRITICAL-04 resolved)
- All callback params explicitly typed (CRITICAL-05 resolved)
- NaN guard on CODEVOLVE_TIMEOUT_MS resolved; parseUri try/catch for malformed URIs resolved
- W-01 (open): resource handlers do not catch client.request errors — inconsistent error contract vs tool handlers; fix before connecting agent consumers
- W-02 (open): language field accepts arbitrary strings in tools.ts schemas — DESIGN-06 enum not enforced
- W-03 (open): submitSkillSchema.status is z.string() not z.enum([...]) — server.ts inline schema stricter than runtime Zod gate
- mcp-config.json still not renamed to .mcp.json

### IMPL-16 (Community Auth + Trusted Mountain) — APPROVED WITH NOTES (REVIEW-14, 2026-03-25)
- 31 tests pass (17 authorizer + 14 trustedMountain), tsc clean (MCP SDK error is pre-existing IMPL-15), cdk synth exits 0
- JWT flow correct: Bearer extraction → JWKS fetch (cached) → RS256 verify → IAM policy
- User isolation confirmed: userId always from JWT context (requestContext.authorizer.userId), never from body — verified by dedicated isolation tests
- withAuth applied to POST /skills, POST /problems, POST /skills/:id/promote-canonical (write endpoints only)
- GET /users/me/trusted-mountain + POST + DELETE all have withAuth — correct for per-user resource
- TrustedMountainTable grantReadWriteData(trustedMountainFn) only — no over-granting
- W-01 (fix before activating custom authorizer): verifyToken does not validate token_use claim — must check token_use === "access" to reject Cognito ID tokens
- W-02: authorizerFn is deployed but not wired to any API Gateway route ("backup for non-APIGW contexts") — document activation conditions or hold deployment
- SUGGESTION: COGNITO_REGION and COGNITO_USER_POOL_ID passed to trustedMountainFn but not read by it — cleanup pass
- Review file: docs/reviews/REVIEW-14-IMPL16.md

### Review file locations
- REVIEW-17: docs/reviews/REVIEW-17-IMPL13.md (IMPL-13 canonical promotion fresh review — APPROVED WITH NOTES)
- REVIEW-01: docs/reviews/REVIEW-01.md
- REVIEW-02: docs/reviews/REVIEW-02.md
- REVIEW-03: docs/reviews/REVIEW-03-IMPL-01.md
- REVIEW-04: docs/reviews/REVIEW-04.md
- REVIEW-05: docs/reviews/REVIEW-05.md
- REVIEW-06-ARCH: docs/reviews/REVIEW-06-ARCH.md (ARCH-05 + ARCH-06, Phase 2 architecture)
- REVIEW-FIX-04: docs/reviews/REVIEW-FIX-04.md (FIX-01–05 from REVIEW-04, all approved)
- REVIEW-FIX-05: docs/reviews/REVIEW-FIX-05.md (FIX-06–11 from REVIEW-05 + N-NEW-01/02, all approved)
- REVIEW-07: docs/reviews/REVIEW-07.md (IMPL-06 /execute + IMPL-07 cache, approved after re-review)
- REVIEW-08: docs/reviews/REVIEW-08.md (IMPL-10 Decision Engine, approved with notes)
- REVIEW-09: docs/reviews/REVIEW-09.md (IMPL-11/12/13 Phase 4 scaffolds; IMPL-13 rejected)
- REVIEW-10: docs/reviews/REVIEW-10.md (IMPL-11 full approved, IMPL-12 changes required, IMPL-13 approved, IMPL-09 fixes verified)
- REVIEW-11: docs/reviews/REVIEW-11.md (IMPL-12 fix verification — all REVIEW-10 fixes confirmed, IMPL-12 approved)
- REVIEW-12: docs/reviews/REVIEW-12-IMPL15.md (IMPL-15 MCP server full implementation — REJECTED)
- REVIEW-13: docs/reviews/REVIEW-13-IMPL18.md (IMPL-18 analytics dashboard frontend — APPROVED WITH NOTES)
- REVIEW-14: docs/reviews/REVIEW-14-IMPL16.md (IMPL-16 community auth + trusted mountain — APPROVED WITH NOTES)
- REVIEW-15 (IMPL-18 fix): docs/reviews/REVIEW-15-IMPL18.md (IMPL-18 warning fix verification — APPROVED WITH NOTES)
- REVIEW-15 (IMPL-15 re-review): docs/reviews/REVIEW-15-IMPL15.md (IMPL-15 MCP server re-implementation — APPROVED WITH NOTES)

### IMPL-18 (analytics dashboard frontend) — APPROVED, marked Complete (REVIEW-15, 2026-03-25)
- 75 tests pass (3 new for W-01/W-02/W-04 fixes)
- W-01 RESOLVED: VITE_API_BASE_URL now used in useDashboardData.ts (matches mountain.ts and DESIGN-07)
- W-02 RESOLVED: intervalMs param added to useDashboardData; Resolve/Caching = 300_000ms, Quality/Gap/Agents = 3_600_000ms — all five components pass correct value
- W-04 RESOLVED: document.hidden guard in fetchData; visibilitychange listener re-fetches on tab restore; removeEventListener cleanup present
- W-03 DEFERRED (open item): from/to date range params and DateRangePicker still not implemented; carried forward for next DESIGN-07 acceptance pass
- Pre-existing tsc error in mountain.ts (IMPL-14 carry-forward) — unchanged, not in IMPL-18 scope
- S-01/S-02/S-03/S-04 carry forward from REVIEW-13 unchanged (suggestions only, not blocking)
