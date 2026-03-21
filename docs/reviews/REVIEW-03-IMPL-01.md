# REVIEW-03: IMPL-01 — Project Scaffold

> Reviewer: Iris
> Date: 2026-03-21
> Task reviewed: IMPL-01 — TypeScript Lambda project scaffold
> Files reviewed: `tsconfig.json`, `tsconfig.test.json`, `jest.config.ts`, `cdk.json`, `package.json`, `infra/app.ts`, `infra/codevolve-stack.ts`, `src/shared/kinesis.ts`, `src/shared/emitEvent.ts`, `src/archive/archiveHandler.ts`, `src/archive/archiveSkill.ts`, `src/archive/unarchiveSkill.ts`, `src/archive/archiveUtils.ts`
> Test run: `npm test` — 126 passed, 0 failed
> Type check: `npx tsc --noEmit` — exits 0

---

## Verdict: APPROVED WITH NOTES

The scaffold is complete and functional. All required folders exist, all configuration files are correct, tests pass, TypeScript compiles clean. One warning-level issue (Kinesis utility confusion) requires a fix before IMPL-02 lands. No hard-reject violations found.

---

## Review Questions

### 1. Would a senior engineer approve this implementation?

**Yes.**

Configuration files are clean and minimal. `tsconfig.json` correctly uses `NodeNext` for esbuild-bundled Lambda code and includes the `ts-node` CommonJS override block required for CDK synthesis. `tsconfig.test.json` correctly extends the main config and overrides to CommonJS for Jest. `jest.config.ts` uses two named projects (`unit`, `integration`) with the correct transform references — this is the right structure for a project that will grow test volume over time.

`infra/codevolve-stack.ts` is well-organized: tables first, stream, environment variables, Lambdas, API Gateway resources, then permissions. The `defaultLambdaProps` spread pattern avoids repetition without obscuring per-function overrides. Names are accurate and descriptive. Bundling commands are explicit and consistent.

One readability concern: `infra/app.ts` hardcodes account ID `178778217786` and region `us-east-2` as literals rather than reading from environment variables or CDK context. This is not a secret (it is the CDK environment, not a credential), but it makes the stack less portable and is contrary to the CDK guidance of using `process.env.CDK_DEFAULT_ACCOUNT`. Not blocking at scaffold phase, but should be addressed before any other environment (staging, prod) is needed.

### 2. Is there a simpler solution?

**No** — for the scaffold artifacts. The configuration is already minimal. `jest.config.ts` with two projects and `moduleNameMapper` for `.js` extension rewriting is the standard pattern for this TypeScript + Jest + NodeNext combination.

One structural observation: `src/shared/kinesis.ts` and `src/shared/emitEvent.ts` both export a function named `emitEvent` and both instantiate a `KinesisClient` singleton. These two files serve different contracts: `kinesis.ts` throws on error, `emitEvent.ts` is fire-and-forget with Zod validation. The presence of both creates a footgun — callers must remember which one to import, and the names are not self-documenting. This is addressed further in Issues Found below.

### 3. Are there unintended side effects?

**One found** — scoped to the archive module, not cross-module.

All four archive source files (`archiveHandler.ts`, `archiveSkill.ts`, `unarchiveSkill.ts`, `archiveUtils.ts`) import `emitEvent` from `../shared/kinesis.js` — the version that **throws on Kinesis failure** — rather than from `../shared/emitEvent.js` — the version that is fire-and-forget with Zod validation.

Each call site manually appends `.catch(() => { /* fire-and-forget */ })` to work around this, which restores the correct runtime behavior. However:

1. The workaround is invisible to future maintainers who read the import. Importing the throwing version and suppressing the throw at every call site is the wrong layer of abstraction.
2. `emitEvent` in `kinesis.ts` does not validate the event against the Zod schema before sending, so invalid events can reach Kinesis from archive paths.
3. If a new call site is added to the archive module that forgets the `.catch()`, the handler will throw and the SQS message will be retried indefinitely due to a Kinesis emission failure — violating the stated contract of archive operations.

This is not an IMPL-01 scaffold defect per se (IMPL-01 scope was configuration files, folder structure, and stubs), but the archive module code is present in the scaffold and the import is incorrect. It must be fixed before the archive module is considered production-ready.

No other cross-module side effects found. The analytics Lambda (`src/analytics/emitEvents.ts`) correctly uses `emitEvent.ts` directly. Registry handlers do not yet emit events, which is expected — that belongs to IMPL-02.

### 4. Are edge cases handled?

For the scaffold artifacts (config files, CDK stack), edge cases are not applicable in the usual sense. Observations:

**tsconfig.test.json:** The IMPL-01 plan specified `"isolatedModules": false` in `tsconfig.test.json`. The delivered file omits this field, meaning `isolatedModules: true` is inherited from the base `tsconfig.json`. In practice this has not caused a test failure (all 126 pass), because ts-jest's CommonJS transform handles `isolatedModules: true` correctly in current versions. However, the plan's rationale was sound — `const enum` patterns break under `isolatedModules: true` and future tests may hit this. This is a minor deviation from the plan, not a functional defect.

**CDK stack — `removalPolicy` on cache table:** `codevolve-cache` uses `RemovalPolicy.DESTROY`. This is correct for a TTL-based cache. All other tables use `RemovalPolicy.RETAIN`, which is correct for primary data. No issues.

**CDK stack — Kinesis shard count:** `shardCount: 1` with a note to enable on-demand mode later. Acceptable for Phase 1 bootstrap scale. The 24-hour retention period is appropriate for a development environment but will need to increase (to 7 days minimum) before production.

**CDK stack — `healthFn` over-granted permissions:** The health check Lambda is granted `ReadWriteData` on all four DynamoDB tables and `grantWrite` on the Kinesis stream. A health check should at most need `DescribeTable` or a read-only ping. This is an IAM over-permission that violates least-privilege. See Issues Found.

**CDK stack — `archiveHandlerFn` gets Bedrock permission:** The comment says "future-proofing, though it only nullifies." The archive handler (`archiveHandler.ts`) does not call Bedrock. Granting unnecessary Bedrock permissions to a Lambda that processes untrusted SQS messages (which could trigger arbitrary archive operations) is a security surface that should not be speculative. Remove until the handler actually needs it.

### 5. Does the change follow the architectural plan?

**Yes, with one minor note.**

- All required folders exist: `src/registry/`, `src/router/`, `src/execution/`, `src/validation/`, `src/analytics/`, `src/evolve/`, `src/archive/`, `src/shared/`, `infra/`, `tests/`.
- `package.json` has the `engines: { node: ">=22" }` field.
- `tsconfig.json` uses `strict: true`, `module: NodeNext`, and includes the ts-node CommonJS override.
- `jest.config.ts` correctly references `tsconfig.test.json` in both project transforms.
- `cdk.json` contains the full CDK v2 feature flag set.
- All Lambda functions use `lambda.Runtime.NODEJS_22_X` and esbuild target `node22`.
- `infra/app.ts` references the correct account (`178778217786`) and region (`us-east-2`).
- Analytics events are flowing to Kinesis, not DynamoDB.
- No LLM calls exist anywhere outside `src/evolve/`.
- No hard-deletion code found anywhere — archive module uses `status: "archived"`.

Minor deviation: IMPL-01 scope was described as scaffolding — config files, folder structure, and stub index files. The delivered scaffold includes fully implemented archive module handlers (`archiveHandler.ts`, `archiveSkill.ts`, `unarchiveSkill.ts`, `archiveUtils.ts`), a Bedrock embedding utility (`src/registry/bedrock.ts`), and all registry CRUD handlers. This is scope creep beyond IMPL-01, but it is beneficial scope creep — the extra work is correct and tested. Noted so Quimby can update IMPL-02/IMPL-04 task scope accordingly.

---

## Security Check

- **Input validation:** Pass — API handlers using `archiveSkill.ts` and `unarchiveSkill.ts` validate path parameters via Zod. SQS-triggered `archiveHandler.ts` parses the message body directly without Zod validation (SQS messages are assumed to come from the internal Decision Engine, not user input). This is acceptable for an internal queue but should be documented.
- **DynamoDB safety:** Pass — all DynamoDB expressions use `ExpressionAttributeNames` and `ExpressionAttributeValues`. No string concatenation in query construction found.
- **Sandbox integrity:** N/A — no skill execution code in this scope.
- **Error response safety:** Pass — error responses return generic messages (`"An unexpected error occurred"`). Stack traces and table names do not appear in response bodies. Internal errors are logged to CloudWatch only.
- **Hardcoded secrets:** Pass — no API keys or credentials found. Account ID in `infra/app.ts` is a CDK deployment target, not a credential.
- **IAM least privilege:** Partial fail — see W-01 and W-02 below.

---

## Issues Found

### [WARNING] W-01: All archive module files import from `kinesis.ts` (throwing) instead of `emitEvent.ts` (fire-and-forget)

Files: `src/archive/archiveHandler.ts:12`, `src/archive/archiveSkill.ts:15`, `src/archive/unarchiveSkill.ts:15`, `src/archive/archiveUtils.ts:25`

The `emitEvent` function in `src/shared/kinesis.ts` throws on Kinesis failure. The `emitEvent` function in `src/shared/emitEvent.ts` is documented as "must NEVER throw" and includes Zod validation. All archive call sites compensate by manually adding `.catch(() => {})`, but this pattern is fragile — any future call site that omits the `.catch()` will silently break archive idempotency.

Fix: Change all four archive files to import from `../shared/emitEvent.js` and remove the `.catch(() => {})` wrappers. This is a two-line change per file and eliminates the footgun entirely.

This must be resolved before IMPL-04 is considered complete.

### [WARNING] W-02: `healthFn` granted ReadWriteData on all tables and Write on Kinesis stream

File: `infra/codevolve-stack.ts:535-539`

A health check Lambda does not need write access to primary DynamoDB tables or the Kinesis stream. This violates least-privilege IAM. If the health Lambda is ever compromised or has a bug, it can corrupt production data.

Suggested fix: Grant `healthFn` only `DescribeTable` (via `addToRolePolicy`) on the tables, or remove table grants entirely if the health check only returns a static response.

### [WARNING] W-03: `archiveHandlerFn` granted unnecessary Bedrock permissions

File: `infra/codevolve-stack.ts:571-578`

The archive handler Lambda (`archiveHandler.ts`) processes SQS messages and updates DynamoDB. It does not call Bedrock. Granting speculative Bedrock permissions to a Lambda that processes externally-triggered messages is a security surface expansion that should not occur until the Lambda actually uses Bedrock.

Fix: Remove `archiveHandlerFn.addToRolePolicy(bedrockPolicy)` until the handler actually calls Bedrock.

### [SUGGESTION] S-01: `tsconfig.test.json` is missing `"isolatedModules": false`

The IMPL-01 plan specified this field to prevent future test failures with `const enum` patterns. All current tests pass without it. Low urgency, but the deviation from the plan should be resolved.

### [SUGGESTION] S-02: `infra/app.ts` hardcodes account ID and region as string literals

`infra/app.ts` lines 13-16 hardcode `account: "178778217786"` and `region: "us-east-2"`. CDK best practice is to read these from `process.env.CDK_DEFAULT_ACCOUNT` / `process.env.CDK_DEFAULT_REGION` or a CDK context variable to allow multi-environment deployments. Not blocking for a single-environment Phase 1 project, but should be addressed before a staging/prod split.

### [SUGGESTION] S-03: Kinesis stream retention should be increased before production

`infra/codevolve-stack.ts:152` sets `retentionPeriod: cdk.Duration.hours(24)`. This is insufficient for production — events not consumed within 24 hours are lost. 7 days (168 hours) is the standard minimum. Acceptable at scaffold phase; flag for ARCH review before production deployment.

### [SUGGESTION] S-04: Archive event uses `event_type: "fail"` — semantically incorrect

Files: `archiveHandler.ts:87`, `archiveSkill.ts:173`, `archiveUtils.ts:154`. All archive event emissions use `event_type: "fail"` with a comment "closest available event type for archive events."

The analytics schema in CLAUDE.md defines `event_type` as `"resolve | execute | validate | fail"`. There is no `"archive"` type. This is a schema gap — analytics dashboards cannot distinguish archive events from execution failures. Recommend adding `"archive"` to the `event_type` enum in `AnalyticsEventSchema` (a one-line change in `src/shared/validation.ts`). Flag for IMPL-02/IMPL-03.

---

## Notes for Ada and Jorven

1. **W-01 (Kinesis import)** is the single most important fix before IMPL-04 ships. It is a mechanical search-and-replace across four files. The fix eliminates an entire category of future archive regression bugs.

2. The archive module and registry CRUD handlers delivered here go well beyond IMPL-01 scope. Jorven should update the task list: IMPL-02 (registry CRUD) and IMPL-04 (archive mechanism) are substantially pre-implemented. The review for those tasks (REVIEW-03 and REVIEW-04 per the current task list) should focus on the existing code, not treat it as new work.

3. The `kinesis.ts` vs `emitEvent.ts` dual-export situation is a module design debt. Consider deleting `kinesis.ts` entirely once IMPL-02 confirms all callers have migrated to `emitEvent.ts`. The `kinesisClient` export from `kinesis.ts` is currently unused outside tests.

4. Test quality is high. The `archiveHandler.test.ts` tests cover: happy path, idempotency (already-archived), not-found, canonical-block, partial batch failure, execution-lock retry, malformed JSON body, and metadata passthrough. The `emitEvent.test.ts` tests cover: single and batch emission, partition key selection, Kinesis failure tolerance, invalid event dropping, and the full POST /events handler surface. These are meaningful behavioral tests, not stubs.

---

## Completion Gate Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` exits 0 | Pass |
| `npm test` — all tests pass | Pass (126/126) |
| All required folders exist | Pass |
| `package.json` has `engines: { node: ">=22" }` | Pass |
| `tsconfig.json` has `ts-node` CommonJS override | Pass |
| `tsconfig.test.json` references `tsconfig.json` | Pass |
| `jest.config.ts` references `tsconfig.test.json` in both transforms | Pass |
| `cdk.json` has full CDK v2 feature flag set | Pass |
| All Lambdas use `NODEJS_22_X` | Pass |
| All esbuild commands use `--target=node22` | Pass |
| No `NODEJS_20` references in `infra/codevolve-stack.ts` | Pass |
| `infra/app.ts` targets account `178778217786`, region `us-east-2` | Pass |
| No LLM calls outside `src/evolve/` | Pass |
| No analytics events written to DynamoDB | Pass |
| No hard deletions — archive uses `status: "archived"` | Pass |
