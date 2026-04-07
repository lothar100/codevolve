# codeVolve — Task List

> Single source of truth for task status. Updated by Quimby. Tasks marked Complete only after Iris approval.

**Status legend:** `[ ]` Planned · `[~]` In Progress · `[!]` Blocked · `[✓]` Verified · `[x]` Complete

---

## Phase 1 — Foundation

### Architecture & Design (Jorven + Amber — run in parallel, no blockers)

| ID | Owner | Status | Task | Blocks |
|----|-------|--------|------|--------|
| ARCH-01 | Jorven | [✓] | Design complete DynamoDB schemas for all tables: `codevolve-problems`, `codevolve-skills`, `codevolve-cache`, `codevolve-archive`. Include GSIs, partition keys, sort keys, and access patterns for every API endpoint. Output: `docs/dynamo-schemas.md`. **Verified 2026-03-21 (REVIEW-02):** All 6 REVIEW-01 criticals resolved. Open item before IMPL-02: fix `skill_version` field in cache table from semver string to integer `version_number` (N-NEW-01). | IMPL-01, IMPL-02, IMPL-04 |
| ARCH-02 | Jorven | [✓] | Write full API contract specs for all 15 endpoints: request shape (zod schema), response shape, error codes, HTTP status codes. Output: `docs/api.md`. **Verified 2026-03-21 (REVIEW-02):** All 6 REVIEW-01 criticals resolved. Open items before IMPL-02: fix `skill_version` type in cache schema (N-NEW-01); add `archived` to `status_distribution` in skill-quality dashboard (N-NEW-02); document Streams vs direct Kinesis event emit policy (O-02). | IMPL-02, IMPL-03, IMPL-05, IMPL-06 |
| ARCH-03 | Jorven | [✓] | Design archive mechanism data flow: what triggers archival, what Lambda runs it, what DynamoDB and OpenSearch operations it performs, how it emits events. Must handle: skill archive, problem archive, reversal (un-archive). Output: `docs/archive-design.md`. | IMPL-07 |
| ARCH-04 | Jorven | [✓] | Write ADR-001 (tech stack) and ADR-002 (analytics separation) to `docs/decisions.md`. | — |
| DESIGN-01 | Amber | [✓] | Define skill contract UX: required vs optional vs inferred fields, contributor-facing validation messages, contributor submission flow (what an agent or human POSTs to create a skill). Output: `docs/platform-design.md`. | ARCH-01 |
| DESIGN-02 | Amber | [✓] | Write analytics dashboard specifications: exact ClickHouse/BigQuery queries for all 5 dashboards, refresh cadence, alert thresholds. Output: `docs/platform-design.md`. | IMPL-08 |
| DESIGN-03 | Amber | [✓] | Define archive threshold policy document: exact metric thresholds, cadence, edge cases, reversal conditions. Output: `docs/archive-policy.md`. | ARCH-03 |

**Verification:** Jorven reviews DESIGN-01 for feasibility. Iris reviews ARCH-01, ARCH-02 before implementation begins.

---

### Implementation (Ada — sequential, blocked on architecture)

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| IMPL-01 | Ada | [✓] | Scaffold Lambda project: TypeScript strict mode, Jest, AWS CDK v2, folder structure (`src/registry/`, `src/router/`, `src/execution/`, `src/validation/`, `src/analytics/`, `src/evolve/`, `src/archive/`, `src/shared/`, `infra/`, `tests/`). Set up `package.json`, `tsconfig.json`, `jest.config.ts`, `cdk.json`. **Plan written 2026-03-21 by Jorven** — see IMPL-01 sub-tasks below. **Approved 2026-03-21 (REVIEW-03):** All completion gate checks pass (126 tests, tsc clean, NODEJS_22_X confirmed). Open before IMPL-04: fix archive module to import from `emitEvent.ts` not `kinesis.ts` (W-01). | ARCH-01 |
| IMPL-02 | Ada | [✓] | Implement Skill + Problem CRUD API: `POST /skills`, `GET /skills/:id`, `GET /skills`, `POST /problems`, `GET /problems/:id`. DynamoDB DocumentClient, zod validation, Kinesis event emission on every write. Tests required. **Approved 2026-03-21 (REVIEW-04):** 5 non-critical issues (see REVIEW-04.md). N-NEW-01 still open before IMPL-05. | ARCH-01, ARCH-02 |
| IMPL-03 | Ada | [✓] | Implement Kinesis event emission utility (`src/shared/emitEvent.ts`): typed `AnalyticsEvent` interface, fire-and-forget (never crash handler on emission failure), unit tests with mocked Kinesis client. **Approved 2026-03-21 (REVIEW-04):** See REVIEW-04.md for N-05 (duplicate KinesisClient in analytics/emitEvents.ts). | ARCH-02 |
| IMPL-04 | Ada | [✓] | Implement archive mechanism Lambda: reads Decision Engine output from SQS, sets `status: "archived"` in DynamoDB, removes from OpenSearch index, emits `event_type: "archive"` event. Handles skill + problem archival and reversal. Tests required. **Approved 2026-03-21 (REVIEW-05):** 4 non-critical issues (N-01 skill_count floor, N-02 pagination gap, N-03 bedrockClient export, N-04 undocumented fallback). W-01/W-02/W-03 all resolved. | ARCH-01, ARCH-03, DESIGN-03 |

---

### IMPL-01 Sub-Tasks — Scaffold Plan (Jorven, 2026-03-21)

> All 5 sub-tasks are independent of each other and can be executed in parallel by separate Ada agents.
> Each sub-task has a single owner, a precise file scope, and an unambiguous verification method.
> No sub-task may be marked Verified until `npx tsc --noEmit` exits 0 and `npx jest` passes.

---

#### Pre-conditions

Before Ada begins any sub-task, confirm:
1. `node --version` reports v22.x or higher.
2. `npm install` has been run (all packages in `node_modules/`).
3. No sub-task modifies files owned by another sub-task.

---

#### IMPL-01-A: `package.json` — Add engines field and fix missing `@aws-sdk/client-opensearchserverless` note

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `package.json` |
| Depends on | — |
| Blocks | IMPL-01-B (tsconfig needs to know target), IMPL-01-D (cdk.json references app entry) |
| Verification | `node -e "require('./package.json')" && node -e "const p=require('./package.json'); if(!p.engines) throw new Error('missing engines')"` exits 0 |

**Gap found:** `package.json` is missing the `"engines"` field. All other content (dependencies, devDependencies, scripts) is correct for IMPL-01 scope.

**Exact change — add one field to `package.json`:**

Add immediately after `"private": true`:

```json
"engines": {
  "node": ">=22"
},
```

**Nothing else changes in `package.json`.** Do not add, remove, or update any dependency. Do not change scripts.

**Note for Ada:** `@aws-sdk/client-opensearchserverless` is intentionally absent — it is not needed until IMPL-05 (Phase 2). Do not add it now.

---

#### IMPL-01-B: `tsconfig.json` — Add ts-node CommonJS override block

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `tsconfig.json` |
| Depends on | — |
| Blocks | IMPL-01-D (CDK synthesis uses ts-node with this tsconfig) |
| Verification | `npx ts-node --version` exits 0; `npx cdk synth --app "npx ts-node infra/app.ts" 2>&1 \| grep -v error` produces no TypeScript errors |

**Gap found:** `tsconfig.json` sets `"module": "NodeNext"`. When CDK invokes `npx ts-node infra/app.ts`, ts-node attempts to load the file as ESM. ts-node v10 does not fully support `NodeNext` module resolution without the `--esm` flag, causing `ERR_REQUIRE_ESM` at synthesis time. The fix is a `ts-node` compiler override section in `tsconfig.json` that forces CommonJS only for ts-node execution, leaving the main `compilerOptions` intact for esbuild-bundled Lambdas.

**Exact change — add one top-level key to `tsconfig.json`:**

Add after the closing brace of `"compilerOptions"` and before `"include"`:

```json
"ts-node": {
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node"
  }
},
```

The complete file after the change:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true,
    "isolatedModules": true
  },
  "ts-node": {
    "compilerOptions": {
      "module": "CommonJS",
      "moduleResolution": "node"
    }
  },
  "include": ["src/**/*", "infra/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist", "cdk.out"]
}
```

**Nothing else changes in `tsconfig.json`.**

---

#### IMPL-01-C: `tsconfig.test.json` + `jest.config.ts` — Fix Jest/ts-jest CommonJS resolution

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `tsconfig.test.json` (create new), `jest.config.ts` (edit) |
| Depends on | IMPL-01-B (tsconfig.json must exist before tsconfig.test.json extends it) |
| Blocks | IMPL-01-E (stubs must pass `jest --listTests`) |
| Verification | `npx jest --listTests` lists all test files; `npx jest` exits 0 with all existing tests passing |

**Gap found:** Both Jest project configurations in `jest.config.ts` pass `{ tsconfig: "tsconfig.json" }` to ts-jest. The main `tsconfig.json` uses `"module": "NodeNext"`, which is incompatible with Jest's CommonJS module system. Jest does not support ESM natively without `--experimental-vm-modules`. The fix is a separate `tsconfig.test.json` that inherits from `tsconfig.json` and overrides `module` and `moduleResolution` to `CommonJS`, then reference it in both jest projects.

**Step 1 — Create `tsconfig.test.json` (new file at repo root):**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",
    "isolatedModules": false
  }
}
```

Rationale for `"isolatedModules": false`: ts-jest with CommonJS does not require isolated modules and some test patterns (e.g., `const enum`) break under `isolatedModules: true`.

**Step 2 — Edit `jest.config.ts`:** change both `ts-jest` transform configs to reference `tsconfig.test.json` instead of `tsconfig.json`.

The complete file after the change:

```typescript
import type { Config } from "jest";

const config: Config = {
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
      moduleFileExtensions: ["ts", "js", "json"],
      moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
      },
      transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
      },
    },
    {
      displayName: "integration",
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      moduleFileExtensions: ["ts", "js", "json"],
      moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
      },
      transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
      },
    },
  ],
};

export default config;
```

The `moduleNameMapper` pattern `"^(\\.{1,2}/.*)\\.js$": "$1"` remains — it rewrites `.js` imports to extensionless so ts-jest resolves `.ts` source files correctly even when source uses `NodeNext`-style `.js` explicit extensions.

---

#### IMPL-01-D: `cdk.json` — Add standard CDK v2 feature flags and fix Lambda runtime to Node 22

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `cdk.json`, `infra/codevolve-stack.ts` |
| Depends on | IMPL-01-B (tsconfig.json must be stable before CDK can synthesize) |
| Blocks | — |
| Verification | `npx cdk synth` exits 0; synthesized CloudFormation template contains `nodejs22.x` for all Lambda functions |

**Gap 1 — Lambda runtime is Node 20, must be Node 22.**

The CDK stack at `infra/codevolve-stack.ts` hardcodes `lambda.Runtime.NODEJS_20_X` and all esbuild bundling commands use `--target=node20`. The architecture constraint requires Node 22. This is a non-trivial but mechanical change.

**Change to `infra/codevolve-stack.ts`:**
- Replace every occurrence of `lambda.Runtime.NODEJS_20_X` with `lambda.Runtime.NODEJS_22_X`.
- Replace every occurrence of `target=node20` in esbuild bundling command strings with `target=node22`.
- Replace every occurrence of `bundlingImage: lambda.Runtime.NODEJS_20_X.bundlingImage` with `bundlingImage: lambda.Runtime.NODEJS_22_X.bundlingImage`.

There are exactly 3 patterns to replace, occurring multiple times. Use find-replace-all. Do not change any logic, permissions, table names, function names, or route definitions.

**Gap 2 — `cdk.json` is missing standard CDK v2 feature flags.**

The current `cdk.json` context block has only 2 flags. CDK v2 `cdk init` generates ~15 flags. Missing flags cause CDK to emit deprecation warnings and may affect synthesized resource behavior in future CDK upgrades. Add all standard CDK v2 flags now to prevent drift.

**Complete replacement content for `cdk.json`:**

```json
{
  "app": "npx ts-node infra/app.ts",
  "watch": {
    "include": ["src/**", "infra/**"],
    "exclude": ["node_modules", "dist", "cdk.out", "tests"]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws", "aws-cn"],
    "@aws-cdk-containers/ecs-service-extensions:enableDefaultLogDriver": true,
    "@aws-cdk/aws-ec2:uniqueImdsv2TemplateName": true,
    "@aws-cdk/aws-ecs:arnFormatIncludesClusterName": true,
    "@aws-cdk/aws-iam:minimizePolicies": true,
    "@aws-cdk/core:validateSnapshotRemovalPolicy": true,
    "@aws-cdk/aws-codepipeline:crossAccountKeyAliasStackSafeResourceName": true,
    "@aws-cdk/aws-s3:createDefaultLoggingPolicy": true,
    "@aws-cdk/aws-sns-subscriptions:restrictSqsDescryption": true,
    "@aws-cdk/aws-apigateway:disableCloudWatchRole": true,
    "@aws-cdk/core:enablePartitionLiterals": true,
    "@aws-cdk/aws-events:eventsTargetQueueSameAccount": true,
    "@aws-cdk/aws-iam:standardizedServicePrincipals": true,
    "@aws-cdk/aws-ecs:disableExplicitDeploymentControllerForCircuitBreaker": true,
    "@aws-cdk/aws-iam:importedRoleStackSafeDefaultPolicyName": true,
    "@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy": true,
    "@aws-cdk/aws-route53-patters:useCertificate": true,
    "@aws-cdk/customresources:installLatestAwsSdkDefault": false,
    "@aws-cdk/aws-rds:databaseProxyUniqueResourceName": true,
    "@aws-cdk/aws-codedeploy:removeAlarmsFromDeploymentGroup": true,
    "@aws-cdk/aws-apigateway:authorizerChangeDeploymentLogicalId": true,
    "@aws-cdk/aws-ec2:launchTemplateDefaultUserData": true,
    "@aws-cdk/aws-secretsmanager:useAttachedSecretResourcePolicyForSecretTargetAttachments": true,
    "@aws-cdk/aws-redshift:columnId": true,
    "@aws-cdk/aws-cloudfront:defaultSecurityPolicyTLSv1.2_2021": true,
    "@aws-cdk/core:newStyleStackSynthesis": true
  }
}
```

---

#### IMPL-01-E: Folder structure — Create stub `index.ts` files for empty module folders

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/router/index.ts` (create), `src/execution/index.ts` (create), `src/validation/index.ts` (create), `src/evolve/index.ts` (create) |
| Depends on | IMPL-01-B (tsconfig.json must be valid before tsc can check these stubs), IMPL-01-C (tsconfig.test.json needed before jest runs) |
| Blocks | — |
| Verification | `npx tsc --noEmit` exits 0; no TypeScript errors for any stub file |

**Gap found:** `src/router/`, `src/execution/`, `src/validation/`, `src/evolve/` contain only `.gitkeep` files. They have no TypeScript entry point. Future IMPL tasks will add handlers to these folders. Creating a stub `index.ts` in each folder ensures the folder is included in TypeScript compilation and avoids "no files found" warnings from tsc when the `include` glob matches an otherwise-empty folder.

**Exact content for each stub file:**

`src/router/index.ts`:
```typescript
/**
 * Skill Router module.
 * Implements POST /resolve.
 * Populated in IMPL-05.
 */
export {};
```

`src/execution/index.ts`:
```typescript
/**
 * Execution Layer module.
 * Implements POST /execute and POST /execute/chain.
 * Populated in IMPL-06.
 */
export {};
```

`src/validation/index.ts`:
```typescript
/**
 * Validation Layer module.
 * Implements POST /validate/:skill_id.
 * Populated in IMPL-11.
 */
export {};
```

`src/evolve/index.ts`:
```typescript
/**
 * Evolution Layer module.
 * Implements POST /evolve (async, Claude API).
 * Populated in IMPL-12.
 */
export {};
```

The `export {}` makes each file a TypeScript module (not a script), which is required when `"isolatedModules": true` is in effect for non-test compilation.

**Existing folders do not need stubs:** `src/registry/`, `src/analytics/`, `src/archive/`, `src/shared/` already have real TypeScript files.

---

#### IMPL-01 Completion Gate

All 5 sub-tasks are complete when ALL of the following pass:

1. `npx tsc --noEmit` — exits 0, no errors across all `src/**/*`, `infra/**/*`, `tests/**/*`.
2. `npx jest` — exits 0, all existing unit tests pass (12 test files currently present).
3. `npx cdk synth` — exits 0, CloudFormation template generated in `cdk.out/`. Template must contain `nodejs22.x` for all Lambda runtime fields.
4. `node -e "const p=require('./package.json');if(!p.engines)throw new Error('missing engines field')"` — exits 0.
5. `grep -r "NODEJS_20" infra/codevolve-stack.ts` — returns no matches (confirms Node 22 migration is complete).

After all 5 checks pass, Quimby updates IMPL-01 status to `[✓]` Verified and records it in `tasks/todo.md`. IMPL-02 is then unblocked.

---

### Fix Tasks (from REVIEW-04 + REVIEW-05)

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| FIX-01 | Ada | [✓] | Fix N-01: `listProblems.ts` — add `examples` field to `mapProblemFromDynamo` mapper. Update unit test. Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-02 |
| FIX-02 | Ada | [✓] | Fix N-02: `createProblem.ts` — replace full-table-scan name-uniqueness check with DynamoDB conditional put. Catch `ConditionalCheckFailedException`, return 409. Update unit test. Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-02 |
| FIX-03 | Ada | [✓] | Fix N-03: `listSkills.ts` — do not apply DynamoDB `Limit` before filter expression. Remove or defer `Limit` when a filter is active. Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-02 |
| FIX-04 | Ada | [✓] | Fix N-04: `listSkills.ts:152–165` — remove dead code block (expression pushed then immediately popped). Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-02 |
| FIX-05 | Ada | [✓] | Fix N-05: `analytics/emitEvents.ts` — reuse shared Kinesis client singleton or document intentional-throw contract with inline comment. Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-03 |
| FIX-06 | Ada | [✓] | Fix N-01 (R05): `archiveUtils.ts` — add floor guard to `skill_count` decrement (no negative counts). Use condition expression. Update unit test. Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-04 |
| FIX-07 | Ada | [✓] | Fix N-02 (R05): `archiveUtils.ts` — add pagination to `archiveProblemIfAllSkillsArchived` query. Update unit test. Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-04 |
| FIX-08 | Ada | [✓] | Fix N-03 (R05): `archiveUtils.ts` — remove `export` from `bedrockClient` declaration. Make module-private. Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-04 |
| FIX-09 | Ada | [✓] | Fix N-04 (R05): `unarchiveSkill.ts` — document `previous_status ?? "verified"` fallback with inline comment + add unit test case for missing `previous_status`. Approved 2026-03-21 (REVIEW-FIX-04/05). | IMPL-04 |
| FIX-10 | Ada | [✓] | Fix N-NEW-01: `docs/dynamo-schemas.md` — rename `skill_version` (String) to `version_number` (Number) in cache table schema. Docs only. Approved 2026-03-21 (REVIEW-FIX-04/05). | ARCH-01 |
| FIX-11 | Ada | [✓] | Fix N-NEW-02: `docs/api.md` — add `"archived"` to `status_distribution` in skill-quality dashboard response schema. Docs only. Approved 2026-03-21 (REVIEW-FIX-04/05). | ARCH-02 |

---

### Documentation (Quimby — no blockers, run in parallel)

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| DOCS-01 | Quimby | [✓] | Set up `docs/` folder: create stub files for `architecture.md`, `decisions.md`, `api.md`, `platform-design.md`, `archive-policy.md` with correct headers and section scaffolding. | — |
| DOCS-02 | Quimby | [✓] | Create `tasks/lessons.md` with L-000 bootstrap entry. | — |

---

### Review (Iris — runs after architecture artifacts exist)

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| REVIEW-01 | Iris | [x] | Review ARCH-01 (DynamoDB schemas) and ARCH-02 (API contracts). Verdict: **Request Changes** — 6 critical, 10 non-critical. See `docs/reviews/REVIEW-01.md`. All issues resolved per REVIEW-02. | ARCH-01, ARCH-02 |
| REVIEW-02 | Iris | [✓] | Re-review ARCH-01/ARCH-02 after REVIEW-01 fixes. Verdict: **Approved** — all 6 criticals resolved, all 10 non-criticals resolved, 2 new minor issues found (N-NEW-01, N-NEW-02, neither blocking IMPL-01). See `docs/reviews/REVIEW-02.md`. Ada may proceed with IMPL-01. | ARCH-01, ARCH-02 |
| REVIEW-03 | Iris | [✓] | Review IMPL-01 (project scaffold). Verdict: **Approved with notes** — all completion gate checks pass, 3 warnings (W-01: archive Kinesis import, W-02: healthFn over-permissioned, W-03: archiveHandlerFn unnecessary Bedrock grant). W-01 must be resolved before IMPL-04 ships. See `docs/reviews/REVIEW-03-IMPL-01.md`. | IMPL-01 |
| REVIEW-04 | Iris | [✓] | Review IMPL-02 (CRUD API) + IMPL-03 (event emission) together. **Approved with notes 2026-03-21:** 128 tests pass, no critical issues. 5 non-critical issues (N-01 missing examples field, N-02 TOCTOU race in createProblem name-uniqueness, N-03 DynamoDB Limit applied before filter, N-04 dead code in listSkills, N-05 duplicate KinesisClient). N-NEW-01 and N-NEW-02 still open. See docs/reviews/REVIEW-04.md. | IMPL-02, IMPL-03 |
| REVIEW-05 | Iris | [✓] | Review IMPL-04 (archive mechanism). **Approved with notes 2026-03-21:** 43 archive tests pass, no hard deletions confirmed, no critical issues. W-01/W-02/W-03 all resolved. 4 non-critical issues (N-01 skill_count floor, N-02 pagination on archiveProblemIfAllSkillsArchived, N-03 bedrockClient export, N-04 undocumented fallback). See docs/reviews/REVIEW-05.md. | IMPL-04 |

---

## Phase 2 — Routing + Execution

*Blocked on Phase 1 completion.*

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| ARCH-05 | Jorven | [✓] | Design vector search architecture: DynamoDB embedding storage, Bedrock Titan v2 embedding strategy (when to embed, fields to embed, 1024 dimensions), `/resolve` ranking logic (cosine similarity + tag boost, client-side in Lambda). Migration path to OpenSearch at >5K skills. Approved with notes 2026-03-21 (REVIEW-06-ARCH). C-01 resolved (no-match returns HTTP 200, not 404). IMPL-05 unblocked. | Phase 1 complete |
| ARCH-06 | Jorven | [✓] | Design execution sandbox: Lambda-per-language (Python 3.12, Node 22), input/output serialization, timeout/memory limits, error taxonomy, cache layer integration, ADR-006. Output: `docs/execution-sandbox.md`. ADR-006 written to `docs/decisions.md`. **Verified 2026-03-21 by Jorven.** Open item for Ada: add `504 EXECUTION_OOM` to `/execute` error table in `docs/api.md` as part of IMPL-06. Approved with notes 2026-03-21 (REVIEW-06-ARCH). W-03/W-04 resolved (stack trace sanitization defined, version_number corrected). IMPL-06/07 unblocked. | Phase 1 complete |
| IMPL-05 | Ada | [✓] | Implement `/resolve` endpoint: embed intent via Bedrock, vector search OpenSearch, tag filter boost, return best match + confidence. Latency target: p95 < 100ms. **Approved 2026-03-21 (REVIEW-IMPL-05 + re-review):** N-01 (Kinesis emit on error paths), N-02 (case-sensitive boost matching), N-03 (void emitEvent on success path) all verified. OI-01/OI-02 deferred to IMPL-10. | ARCH-05 |
| IMPL-06 | Ada | [✓] | Implement `/execute` endpoint: check DynamoDB cache, validate inputs against skill contract, invoke runner Lambda (`codevolve-runner-python312` or `codevolve-runner-node22`), handle cache-on-demand write policy, update execution_count + latency on skill record, emit Kinesis event. Add `504 EXECUTION_OOM` to `docs/api.md`. Full spec: `docs/execution-sandbox.md`. **Approved 2026-03-21 (REVIEW-07 re-review):** All 3 criticals and 3 non-criticals resolved and verified. | ARCH-06 |
| IMPL-07 | Ada | [✓] | Implement cache layer (`src/cache/cache.ts`): `getCachedOutput`, `writeCachedOutput`, `incrementCacheHit`. Key: `(skill_id, input_hash)` on `codevolve-cache`. Cache write only when `auto_cache: true` on skill record. TTL: 24h default. Full spec: `docs/execution-sandbox.md` §5. **Approved 2026-03-21 (REVIEW-07 re-review):** All fixes verified. | ARCH-06 |
| DESIGN-06 | Amber | [✓] | Design MCP server interface for codeVolve: tool definitions for resolve/execute/chain/list/validate, resource definitions for skills/problems, prompt templates for skill generation. Output to `docs/platform-design.md`. Completed 2026-03-21. MCP server spec in docs/platform-design.md. IMPL-15 unblocked. | ARCH-05, ARCH-06 |
| REVIEW-05-IMPL05 | Iris | [✓] | Review IMPL-05 (/resolve) — verify no LLM calls in path, latency targets met in tests, confidence scoring logic. **Approved with notes 2026-03-21:** 14 tests pass, no critical issues. N-01: Kinesis event not emitted on Bedrock/DynamoDB early-exit error paths (spec §7.4 violation). N-02: computeBoost uses case-insensitive matching; spec mandates case-sensitive (requires Jorven decision). N-03: await emitEvent should be void emitEvent (minor latency). OI-01/OI-02: ARCH-07 gap-log and last_resolve_at follow-ups not yet present (not blocking). See docs/reviews/REVIEW-IMPL-05.md. **Re-review 2026-03-21 (Iris):** N-01, N-02, N-03 all verified. IMPL-05 approved. | IMPL-05 |
| REVIEW-06 | Iris | [✓] | Review ARCH-05 (vector search) + ARCH-06 (execution sandbox). **Approved with notes 2026-03-21:** C-01 resolved (no-match response code), W-02–04 resolved. All blockers cleared. See docs/reviews/REVIEW-06-ARCH.md. | ARCH-05, ARCH-06 |
| REVIEW-07 | Iris | [✓] | Review IMPL-06 (/execute) + IMPL-07 (cache) — verify sandbox isolation, cache correctness, no data leakage between skill executions. **Request Changes 2026-03-21 (REVIEW-07):** 3 critical issues: C-01 ExecuteResponse missing input_hash+version fields, C-02 504 EXECUTION_OOM absent from api.md, C-03 CDK GSI nonKeyAttributes still has skill_version (should be version_number). 3 warnings, 3 suggestions. All 45 tests pass. See docs/reviews/REVIEW-07.md. **Approved 2026-03-21 (REVIEW-07 re-review):** All 6 fixes (C-01/C-02/C-03/W-01/W-02/S-03) verified correct. IMPL-06 and IMPL-07 approved. | IMPL-06, IMPL-07 |

---

## Phase 3 — Analytics + Feedback Loop

*Blocked on Phase 2 completion.*

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| ARCH-07 | Jorven | [✓] | Design Decision Engine: scheduling (EventBridge), rules logic (auto-cache, optimization flag, gap detection), SQS queue for /evolve pipeline. Output: `docs/decision-engine.md`, ADR-007 in `docs/decisions.md`. **Verified 2026-03-21 by Jorven.** | Phase 2 complete |
| IMPL-08 | Ada | [~] | Implement analytics event consumer: Kinesis → Lambda → ClickHouse/BigQuery. Batch writes, dead-letter queue, idempotent processing. **W-03 fixed 2026-03-23:** `src/analytics/eventId.ts` created with `NULL_FIELD_SENTINEL = "null"` (not ""); `docs/analytics-consumer.md` §5.2 written to document "null" string sentinel. **W-04 fixed 2026-03-23:** `src/analytics/dashboards.ts` validates `from`/`to` as ISO8601 via `Date.parse` before SQL interpolation; returns 400 `INVALID_DATE_RANGE` on invalid input. | ARCH-07, DESIGN-02 |
| IMPL-09 | Ada | [✓] | Implement 5 dashboard API endpoints (read from ClickHouse/BigQuery). **2026-03-23:** All 5 endpoints implemented in `src/analytics/dashboards.ts`. ISO8601 validation (W-04) applied on from/to params. ClickHouse client singleton in `src/analytics/clickhouseClient.ts`. 19 unit tests pass. Pending Iris review. | IMPL-08, DESIGN-02 |
| IMPL-10 | Ada | [x] | Implement Decision Engine Lambda (scheduled): auto-cache trigger, optimization flag, gap detection → SQS GapQueue, archive evaluation → SQS ArchiveQueue. **REVIEW-08 W-01 RESOLVED (2026-03-25):** `optimizationFlag.ts` now uses `QueryCommand` on `GSI-status-updated` — ScanCommand regression fixed. **REVIEW-08 W-02 RESOLVED (2026-03-25):** `ARCHIVE_QUEUE_URL` fallback is now `""` (placeholder account ID removed). **2026-03-25 (Ada):** CDK constructs added — GapLogTable, ConfigTable, DecisionEngineFn (reservedConcurrency 1), DecisionEngineSchedule EventBridge rule. Env vars injected. Resolves REVIEW-15 critical. 54 tests pass, tsc clean. W-03 (staleness thresholds not runtime-configurable) remains deferred to Phase 3. **APPROVED 2026-03-25 (REVIEW-16-IMPL10, Iris):** All CRITICAL-01 requirements verified in synthesized CloudFormation template. 584 tests pass, tsc clean, cdk synth clean. IMPL-10 complete. See `docs/reviews/REVIEW-16-IMPL10.md`. | ARCH-07, DESIGN-03 |
| DESIGN-04 | Amber | [✓] | Design mountain visualization data shape: what JSON does the frontend need, how to aggregate skill data for rendering. Output to `docs/platform-design.md`. Completed 2026-03-21. Full spec in docs/platform-design.md §DESIGN-04. IMPL-09 unblocked (pending Phase 2 completion). | Phase 2 complete |
| REVIEW-08-IMPL08 | Iris | [!] | Review IMPL-08 + IMPL-09 — verify analytics separation, no primary DB writes, query correctness, idempotency logic, DLQ configuration, schema correctness against all 5 DESIGN-02 dashboard queries. **CHANGES REQUIRED 2026-03-23 (Iris):** CRITICAL (original): `clickhouseClient.ts` line 55 double-protocol URL — **RESOLVED 2026-03-24:** client rewritten to read from env vars; Secrets Manager fetch removed entirely. W-01 through W-04 all resolved 2026-03-23. **NEW CRITICAL (REVIEW-08-IMPL08-RECHECK, 2026-03-24, Iris):** CDK does not inject `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, or `CLICKHOUSE_DATABASE` into `analyticsConsumerFn`. The rewritten client reads these four env vars but none are set in `infra/codevolve-stack.ts` — `CLICKHOUSE_SECRET_ARN` is still present but now dead. At runtime all connections fall back to `http://localhost:8123` and fail. Fix: inject the four vars from Secrets Manager/SSM before deploy. **New W-01:** `confidence` null sentinel mismatch — spec DDL says `Float64` with `-1.0`, code sends TypeScript `null` (Nullable). Confirm actual table DDL and reconcile. **New W-02:** Pre-insert dedup check absent — spec §5.3 requires SELECT before INSERT for hot-path idempotency; only ReplacingMergeTree compaction is implemented. 43 analytics tests pass. See docs/reviews/REVIEW-08-IMPL08-RECHECK.md. | IMPL-08, IMPL-09 |
| REVIEW-08 | Iris | [✓] | Review IMPL-10 (Decision Engine) — verify rule logic, archive trigger safety (no premature archival), gap detection accuracy. **Approved with notes 2026-03-22 (REVIEW-08):** 54 tests pass, tsc clean, cdk synth confirmed. No critical issues. W-01: `optimizationFlag.ts` uses ScanCommand instead of QueryCommand on GSI-status-updated (must fix as FIX-12 before production data volume). W-02: placeholder account ID in ARCHIVE_QUEUE_URL fallback. W-03: staleness thresholds not runtime-configurable (deferred Phase 3). See docs/reviews/REVIEW-08.md. | IMPL-10 |
| DESIGN-07 | Amber | [✓] | Design analytics dashboard frontend UI: navigation (tab bar + hash routing), layout, per-dashboard component breakdown and chart types for all 5 dashboards, chart library selection (Recharts), data fetching strategy, full component tree under `frontend/src/components/dashboards/`, shared TypeScript types in `frontend/src/types/dashboards.ts`, acceptance criteria for Ada. Output: `docs/platform-design.md` §DESIGN-07. **Completed 2026-03-23.** IMPL-18 unblocked. | IMPL-09 |
| IMPL-18 | Ada | [✓] | Implement analytics dashboard frontend per DESIGN-07. Add Recharts to `frontend/package.json`. Add `#analytics` / `#mountain` tab navigation to `App.tsx`. Build all components under `frontend/src/components/dashboards/`. Implement `useDashboardData` and `useInterval` hooks. Add `frontend/src/types/dashboards.ts`. All acceptance criteria in DESIGN-07 §9 must pass: `npx tsc --noEmit` clean, `npx vitest run` exits 0, minimum 16 new unit tests. Full spec: `docs/platform-design.md` §DESIGN-07. **Approved with notes 2026-03-25 (REVIEW-13-IMPL18, Iris).** **2026-03-25 (Ada):** Fixed REVIEW-13 warnings: W-01 — unified env var to `VITE_API_BASE_URL`; W-02 — `useDashboardData` now accepts `intervalMs` param, resolve-performance and execution-caching use 300000ms, skill-quality / evolution-gap / agent-behavior use 3600000ms; W-04 — fetch skipped when `document.hidden === true`, re-fetches on `visibilitychange`. 75 tests pass (3 new). **APPROVED 2026-03-25 (REVIEW-15-IMPL18, Iris):** W-01/W-02/W-04 verified resolved. W-03 (date range from/to) deferred — carried forward as open item, does not block completion. 75 tests pass. tsc failure in mountain.ts is pre-existing IMPL-14 carry-forward. | DESIGN-07, IMPL-09 |

---

### IMPL-08 Sub-Tasks — Analytics Consumer Plan (Jorven, 2026-03-22)

> Full specification in `docs/analytics-consumer.md`. Sub-tasks A and B are independent and can run in parallel. C, D, E are sequential.

#### Pre-conditions

Before Ada begins any sub-task, confirm:

1. A ClickHouse Cloud instance is provisioned and accessible from the internet via HTTPS.
2. `node --version` reports v22.x.
3. `npm install` has been run after adding `@clickhouse/client` (done in IMPL-08-A).
4. The `codevolve/clickhouse-credentials` Secrets Manager secret exists in `us-east-2`.

---

#### IMPL-08-A: ClickHouse Cloud Setup and Migration Script

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `scripts/clickhouse-init.sql`, `scripts/clickhouse-seed-verify.sql`, `package.json` (add `@clickhouse/client`) |
| Depends on | ClickHouse Cloud instance provisioned (manual) |
| Blocks | IMPL-08-C, IMPL-08-D |
| Verification | `clickhouse-client ... --query "SHOW TABLES FROM codevolve"` returns `analytics_events`; `aws secretsmanager describe-secret --secret-id codevolve/clickhouse-credentials` returns metadata; `npx tsc --noEmit` exits 0 |

**What to build:** `scripts/clickhouse-init.sql` with the exact DDL from `docs/analytics-consumer.md` §2.2 (`ReplacingMergeTree`, ORDER BY, PARTITION BY, TTL 90 days). `scripts/clickhouse-seed-verify.sql` with verification query. Create `codevolve/clickhouse-credentials` secret in Secrets Manager. Add `@clickhouse/client` to `package.json` dependencies and run `npm install`.

---

#### IMPL-08-B: CDK Resources

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `infra/codevolve-stack.ts` |
| Depends on | IMPL-08-A (secret must exist) |
| Blocks | IMPL-08-E (deploy needed for E2E test) |
| Verification | `npx cdk synth` exits 0; template contains `AnalyticsConsumerFn`, `AnalyticsConsumerDlq`, `AnalyticsConsumerDlqAlarm`, Kinesis event source mapping with `BisectBatchOnFunctionError: true` |

**What to build:** `AnalyticsConsumerFn` Lambda (512 MB, 60s timeout, Node 22, entry `src/analytics/consumer.ts`). `AnalyticsConsumerDlq` SQS Standard queue (14-day retention). `KinesisEventSource` on existing `codevolve-events` stream (batchSize 100, maxBatchingWindow 5s, reportBatchItemFailures true, retryAttempts 3, onFailure SqsDlq). Secret grants for both `AnalyticsConsumerFn` and `DecisionEngineFn`. CloudWatch alarm on DLQ depth > 0. Write stub handler that logs event and returns `{ batchItemFailures: [] }`.

---

#### IMPL-08-C: Event Parsing and event_id Derivation

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/analytics/eventId.ts`, `src/analytics/toClickHouseRow.ts`, `src/analytics/consumer.ts` (Phase 1 parsing), `tests/unit/analytics/eventId.test.ts`, `tests/unit/analytics/consumer.test.ts` |
| Depends on | IMPL-08-A (package installed), IMPL-08-B (stub handler exists) |
| Blocks | IMPL-08-D |
| Verification | `npx jest tests/unit/analytics/` passes; `npx tsc --noEmit` exits 0 |

**What to build:** `deriveEventId(event)` using SHA-256 of `skill_id|event_type|timestamp|input_hash` (nulls mapped to `""`). `toClickHouseRow(event)` mapping `AnalyticsEvent` to `ClickHouseRow` (booleans to 0/1, nulls to empty string except `confidence` which stays null). Phase 1 parsing loop in handler: base64-decode, JSON.parse, Zod validate, accumulate rows or batchItemFailures. Unit tests per `docs/analytics-consumer.md` §8 IMPL-08-C scope.

---

#### IMPL-08-D: ClickHouse Client and Batch Insert

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/analytics/clickhouseClient.ts`, `src/analytics/consumer.ts` (Phase 2 insert), `tests/unit/analytics/consumer.test.ts` (updated) |
| Depends on | IMPL-08-C (row shape defined), IMPL-08-B (secret ARN available in env) |
| Blocks | IMPL-08-E |
| Verification | `npx jest tests/unit/analytics/` passes; `npx tsc --noEmit` exits 0 |

**What to build:** `getClickHouseClient()` lazy singleton in `src/analytics/clickhouseClient.ts` — reads `CLICKHOUSE_SECRET_ARN`, fetches from Secrets Manager, creates `@clickhouse/client` instance (30s request timeout, gzip compression). Export `_setClickHouseClientForTesting(client)` for test injection. Phase 2 insert in handler: guard on empty rows, call `client.insert()`, handle transient vs permanent errors per `docs/analytics-consumer.md` §4.3. Unit tests per §8 IMPL-08-D scope.

---

#### IMPL-08-E: End-to-End Verification and Operational Readiness

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `scripts/clickhouse-seed-verify.sql` (confirmed, no changes) |
| Depends on | IMPL-08-D, IMPL-08-B (CDK deployed) |
| Blocks | IMPL-09, IMPL-10 Phase 3 ClickHouse mode |
| Verification | `npx cdk deploy` exits 0; at least 1 event visible in ClickHouse via seed-verify script; DLQ depth = 0 after smoke test; `codevolve-config` `decision_engine.use_clickhouse` set to `true` in DynamoDB |

**What to do:** Deploy to dev (`npx cdk deploy`). Confirm Kinesis event source mapping is `State: Enabled`. Trigger a test event via `POST /skills`. Wait 30s. Run `clickhouse-seed-verify.sql` and confirm rows are present. Trigger a deliberate parse failure via malformed Kinesis record and confirm handler logs the error without crashing. Set `decision_engine.use_clickhouse = true` in `codevolve-config` DynamoDB table.

---

#### IMPL-08 Completion Gate

All 5 sub-tasks are complete when ALL of the following pass:

1. `npx tsc --noEmit` — exits 0, no errors.
2. `npx jest tests/unit/analytics/` — all analytics consumer unit tests pass.
3. `npx cdk synth` — exits 0. Template contains `AnalyticsConsumerFn`, `AnalyticsConsumerDlq`, `AnalyticsConsumerDlqAlarm`, Kinesis event source mapping with `BisectBatchOnFunctionError: true`.
4. `npx cdk deploy` to dev — exits 0.
5. End-to-end smoke test: at least 1 event flows from Kinesis → ClickHouse and appears in `scripts/clickhouse-seed-verify.sql` output.
6. REVIEW-08-IMPL08 (Iris): analytics separation verified, no primary DB writes, idempotency logic correct, schema matches all 5 DESIGN-02 dashboard queries.

---

## Phase 4 — Validation + Quality

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| ARCH-08 | Jorven | [✓] | Design /validate endpoint and test runner: reuse runner Lambdas from IMPL-06, confidence score formula (pass_count/total_tests), canonical promotion gate (confidence >= 0.85, zero test failures, TransactWriteItems), /evolve SQS consumer (Claude API, skill parser, auto-trigger /validate). Output: `docs/validation-evolve.md`, ADR-009 in `docs/decisions.md`. **Completed 2026-03-22 by Jorven.** | Phase 3 complete |
| IMPL-11 | Ada | [✓] | Implement /validate: reuse sandboxed runner Lambdas, deep equality test comparison, confidence score update in DynamoDB, status transition logic, cache invalidation, emit validation event, evolve trigger on confidence < 0.7. Full spec: `docs/validation-evolve.md` §2 and §9. **Scaffold delivered 2026-03-22. REVIEW-09 (2026-03-22): approved as scaffold. WARNING-02: Kinesis validate event success field hardcoded true (must be failCount === 0). WARNING-03: NO_TESTS error code must be NO_TESTS_DEFINED per spec §2.8. Fix with IMPL-13 corrections.** Completed 2026-03-23. Sub-tasks: IMPL-11-A (deepEqual utility — `src/shared/deepEqual.ts`, `tests/unit/shared/deepEqual.test.ts`), IMPL-11-C (handler — `src/validation/handler.ts`, `tests/unit/validation/handler.test.ts`). Fixed WARNING-02 (`success: failCount === 0`, not hardcoded true) and WARNING-03 (error code `NO_TESTS_DEFINED`, not `NO_TESTS`). 61 tests passing, tsc clean. | ARCH-08 |
| IMPL-11-B | Ada | [✓] | CDK: ValidateFn Lambda (NODEJS_22_X, 5 min timeout), IAM grants for runner Lambdas + DynamoDB + Kinesis + SQS, API Gateway `POST /validate/{skill_id}`. Completed 2026-03-23. | — |
| IMPL-12 | Ada | [✓] | Implement /evolve SQS consumer: GapQueue FIFO consumer Lambda, similar skills DynamoDB lookup, Claude API call (claude-sonnet-4-6), skill JSON parsing + Zod validation, createSkill write, async /validate trigger, evolve-jobs DynamoDB tracking. Full spec: `docs/validation-evolve.md` §3 and §10. **Scaffold delivered 2026-03-22. REVIEW-09 (2026-03-22): approved as scaffold. GapMessageSchema must be updated to full spec shape (§3.2) before IMPL-10 Decision Engine enqueues real messages.** **IMPL-12-A** (dynamo-schemas.md codevolve-evolve-jobs table + package.json @anthropic-ai/sdk), **IMPL-12-C** (claudeClient.ts lazy singleton + skillParser.ts + tests), **IMPL-12-D** (full SQS handler + tests) — completed 2026-03-23. 37 new tests, 273 total passing, tsc clean. **REVIEW-10 (2026-03-23): CHANGES REQUIRED — CRITICAL-01 (job_id → evolve_id PK mismatch), CRITICAL-02 (VALIDATE_FUNCTION_NAME → VALIDATE_LAMBDA_NAME env var mismatch), WARNING-01 (extractTextBefore → substringIndex in dashboards.ts). All three fixed in commit fa9066f. REVIEW-11 (2026-03-24): APPROVED — all fixes verified, 496 tests pass.** | ARCH-08, IMPL-11 |
| IMPL-12-B | Ada | [✓] | CDK: EvolveGapQueue (FIFO, contentBasedDeduplication), EvolveDlq (FIFO, maxReceiveCount 3), EvolveJobsTable (codevolve-evolve-jobs, PK: evolve_id, PAY_PER_REQUEST, TTL: ttl, GSI-status-created), EvolveFn (NODEJS_22_X, 5 min timeout, batchSize 1 SQS source). Completed 2026-03-23. | — |
| IMPL-13 | Ada | [x] | Implement canonical promotion: `POST /skills/:id/promote-canonical` — gate (confidence >= 0.85, test_fail_count === 0, status verified/optimized), DynamoDB TransactWriteItems (promote new + demote old + update problems table), cache invalidation. Full spec: `docs/validation-evolve.md` §4 and §11. **Scaffold delivered 2026-03-22. REVIEW-09 (2026-03-22): REJECTED. CRITICAL-01: already-canonical returns 200 (must be 409 CONFLICT). CRITICAL-02: uses GSI-problem-status without language filter (must use GSI-canonical, filter by language). CRITICAL-03: test_pass_count > 0 gate missing; never-validated skill can be promoted. See docs/reviews/REVIEW-09.md for fix instructions.** **2026-03-23 (IMPL-13-B + IMPL-13-C):** Pure gate function in `src/registry/promoteCanonicalGate.ts` (17 tests). Handler fully rewritten: uses GSI-canonical (not GSI-problem-status), TransactWriteItems for atomic promote/demote/problems-update, handles TransactionCanceledException. 3 criticals resolved: CRITICAL-01 (ALREADY_CANONICAL 409), CRITICAL-02 (GSI-canonical with language filter), CRITICAL-03 (NEVER_VALIDATED gate). 15 handler tests pass. **APPROVED WITH NOTES 2026-03-30 (REVIEW-17-IMPL13, Iris):** All 3 REVIEW-09 criticals resolved. Gate logic pure and well-tested. Open items: (1) DynamoDB cache invalidation for demoted canonical absent (spec §4.5) — TTL provides eventual correction; (2) `is_canonical_status` hardcoded to `true#optimized` and status forcibly upgraded — deviates from spec §4.3, undocumented policy. See `docs/reviews/REVIEW-17-IMPL13.md`. | ARCH-08, IMPL-11 |
| IMPL-13-A | Ada | [✓] | CDK: PromoteCanonicalFn updated with TransactWriteItems IAM on skills+problems tables, cacheTable grants, existing API Gateway route `POST /skills/{id}/promote-canonical` confirmed wired. Completed 2026-03-23. | — |
| REVIEW-10 | Iris | [✓] | Review IMPL-11 (full), IMPL-12 (full), IMPL-13 (REVIEW-09 criticals resolved), IMPL-09 analytics fixes, CDK. **CHANGES REQUIRED 2026-03-23 (Iris):** CRITICAL-01: `evolve/handler.ts` uses `job_id` as evolve-jobs PK but CDK table declares `evolve_id` — all evolve-job DynamoDB writes will fail at runtime (ValidationException). Rename all `job_id` DynamoDB field references to `evolve_id` in `src/evolve/handler.ts` (lines 220, 229, 365, 406). CRITICAL-02: CDK passes `VALIDATE_FUNCTION_NAME` env var to EvolveFn but handler reads `VALIDATE_LAMBDA_NAME` — wrong function name silently used at runtime; change CDK line 743 to `"VALIDATE_LAMBDA_NAME"`. WARNING-01: `extractTextBefore(intent, ':')` in evolution-gap dashboard query (dashboards.ts line 546) is not a valid ClickHouse function; replace with `substringIndex(intent, ':', 1)`. REVIEW-09 criticals (CRITICAL-01/02/03) all resolved. All targeted test suites pass. All three fixes verified by REVIEW-11 (2026-03-24). See `docs/reviews/REVIEW-10.md`. | IMPL-11, IMPL-12, IMPL-13, IMPL-09 |
| REVIEW-11 | Iris | [✓] | Verify REVIEW-10 mandatory fixes (commit fa9066f). All three verified: CRITICAL-01 (`evolve_id` PK in all DynamoDB operations in handler.ts), CRITICAL-02 (`VALIDATE_LAMBDA_NAME` env var in CDK), WARNING-01 (`substringIndex` in dashboards.ts evolution-gap query). 496 tests pass (2 out-of-scope Phase 5 suite failures pre-existing). tsc clean in scope. IMPL-12 approved. See `docs/reviews/REVIEW-11.md`. | IMPL-12, IMPL-09 |
| REVIEW-17 | Iris | [✓] | Fresh standalone review of IMPL-13 canonical promotion (all three sub-tasks). **APPROVED WITH NOTES 2026-03-30:** All REVIEW-09 criticals confirmed resolved. tsc --noEmit exits 0. 117 registry tests pass (32 promote-canonical). W-01: DynamoDB codevolve-cache invalidation for demoted canonical absent (spec §4.5 gap). W-02: `is_canonical_status` hardcoded `true#optimized`; status forcibly upgraded to `optimized` on promotion — undocumented deviation from spec §4.3. W-03: ConditionExpression race-window carry-forward (attribute_exists vs confidence threshold). W-04: require() comment describes it as "eval-based" — inaccurate, should be corrected. See `docs/reviews/REVIEW-17-IMPL13.md`. | IMPL-13 |

---

### IMPL-11 Sub-Tasks — /validate (Jorven, 2026-03-22)

> Full specification in `docs/validation-evolve.md` §2 and §9. Sub-tasks A and B can run in parallel. C depends on A. D depends on C and B (CDK deployed).

#### Pre-conditions

1. IMPL-06 (runner Lambdas `codevolve-runner-python312`, `codevolve-runner-node22`) is complete and deployed.
2. `npx tsc --noEmit` exits 0 before starting.
3. `src/shared/deepEqual.ts` does not yet exist.

---

#### IMPL-11-A: Schema and deepEqual Utility

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/shared/deepEqual.ts` (new), `tests/unit/shared/deepEqual.test.ts` (new), `docs/dynamo-schemas.md` (add 3 attributes to codevolve-skills) |
| Depends on | — |
| Blocks | IMPL-11-C |
| Verification | `npx jest tests/unit/shared/deepEqual.test.ts` passes; `npx tsc --noEmit` exits 0; `docs/dynamo-schemas.md` contains `last_validated_at`, `test_pass_count`, `test_fail_count` |

**What to build:** `deepEqual(a: unknown, b: unknown): boolean` (recursive, key-order-independent, no JSON.stringify). Unit tests covering primitives, arrays, nested objects, null, unequal cases. Add `last_validated_at` (S), `test_pass_count` (N), `test_fail_count` (N) to `docs/dynamo-schemas.md` skills attributes table.

---

#### IMPL-11-B: CDK Resources

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `infra/codevolve-stack.ts` |
| Depends on | — |
| Blocks | IMPL-11-D |
| Verification | `npx cdk synth` exits 0; template contains `ValidateFn` (NODEJS_22_X, 5 min timeout) with IAM grants for runner Lambda invocation, DynamoDB, Kinesis, SQS GapQueue |

**What to build:** `ValidateFn` Lambda per `docs/validation-evolve.md` §8.1. Env vars: `RUNNER_LAMBDA_PYTHON`, `RUNNER_LAMBDA_NODE`, `SKILLS_TABLE`, `CACHE_TABLE`, `KINESIS_STREAM_NAME`, `GAP_QUEUE_URL`. API Gateway route `POST /validate/{skill_id}`.

---

#### IMPL-11-C: /validate Handler

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/validation/handler.ts` (new), `src/validation/index.ts` (replace stub), `tests/unit/validation/handler.test.ts` (new) |
| Depends on | IMPL-11-A |
| Blocks | IMPL-11-D |
| Verification | `npx jest tests/unit/validation/handler.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:** Full handler per `docs/validation-evolve.md` §2.2 — fetch skill, build test list, run tests via runner Lambdas, deepEqual comparison, confidence = pass_count/total_tests, status transitions (§6), DynamoDB UpdateItem (§2.4 — including conditional REMOVE optimization_flagged when p95 <= 5000), cache invalidation, Kinesis event (§2.5), evolve trigger if confidence < 0.7. Unit tests covering all error paths and status transitions.

---

#### IMPL-11-D: Integration Tests

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `tests/integration/validation/validate.test.ts` (new) |
| Depends on | IMPL-11-C, IMPL-11-B (CDK deployed to dev) |
| Blocks | — |
| Verification | `npx jest tests/integration/validation/` passes against dev environment |

**What to build:** Integration tests per `docs/validation-evolve.md` §9 IMPL-11-D — all-passing, mixed, no-tests, archived, additional_tests cases.

---

#### IMPL-11 Completion Gate

1. `npx tsc --noEmit` — exits 0.
2. `npx jest tests/unit/validation/ tests/unit/shared/deepEqual.test.ts` — all pass.
3. `npx cdk synth` — exits 0, template contains `ValidateFn`.
4. Integration tests pass against dev environment.
5. `docs/dynamo-schemas.md` updated with `last_validated_at`, `test_pass_count`, `test_fail_count`.

---

### IMPL-12 Sub-Tasks — /evolve SQS Consumer (Jorven, 2026-03-22)

> Full specification in `docs/validation-evolve.md` §3 and §10. Sub-tasks A and B can run in parallel. C depends on A. D depends on B and C.

#### Pre-conditions

1. IMPL-11 is complete and `ValidateFn` is deployed.
2. `codevolve/anthropic-api-key` secret exists in Secrets Manager (`us-east-2`).
3. Check `package.json` for `@anthropic-ai/sdk` — add if absent.

---

#### IMPL-12-A: evolve-jobs Table Schema and Package Setup

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `docs/dynamo-schemas.md` (add codevolve-evolve-jobs table), `package.json` (add `@anthropic-ai/sdk` if absent) |
| Depends on | — |
| Blocks | IMPL-12-C |
| Verification | `npm ls @anthropic-ai/sdk` returns a version; `npx tsc --noEmit` exits 0; `docs/dynamo-schemas.md` contains `codevolve-evolve-jobs` spec |

**What to build:** Add `codevolve-evolve-jobs` table to `docs/dynamo-schemas.md` per `docs/validation-evolve.md` §7. Confirm/add `@anthropic-ai/sdk` to `package.json`.

---

#### IMPL-12-B: CDK Resources

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `infra/codevolve-stack.ts` |
| Depends on | — |
| Blocks | IMPL-12-E |
| Verification | `npx cdk synth` exits 0; template contains `EvolveFn`, `EvolveGapQueue` (FIFO), `EvolveDlq` (FIFO), `EvolveJobsTable`, SQS event source on `EvolveFn` (batchSize: 1) |

**What to build:** All CDK constructs per `docs/validation-evolve.md` §8.2. Stub handler that returns `{ batchItemFailures: [] }`.

---

#### IMPL-12-C: Claude Client and Skill Parser

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/evolve/claudeClient.ts` (new), `src/evolve/skillParser.ts` (new), `tests/unit/evolve/skillParser.test.ts` (new) |
| Depends on | IMPL-12-A |
| Blocks | IMPL-12-D |
| Verification | `npx jest tests/unit/evolve/skillParser.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:** Lazy Anthropic client singleton (Secrets Manager read on first call). `parseClaudeSkillResponse` (JSON extraction, markdown fence stripping). `repairTestCases` (swap `output` -> `expected`). Unit tests per `docs/validation-evolve.md` §10 IMPL-12-C scope.

---

#### IMPL-12-D: /evolve SQS Handler

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/evolve/handler.ts` (replace stub), `src/evolve/index.ts` (update), `tests/unit/evolve/handler.test.ts` (new) |
| Depends on | IMPL-12-C, IMPL-12-B |
| Blocks | IMPL-12-E |
| Verification | `npx jest tests/unit/evolve/handler.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:** Full SQS handler per `docs/validation-evolve.md` §3 — GapQueueMessage Zod parse, similar skills query, prompt build, Claude API call, response parse + Zod validate, createSkill write, async ValidateFn invocation, evolve-jobs status writes, correct batchItemFailures behavior for transient vs permanent errors. Unit tests covering all paths per §10 IMPL-12-D scope.

---

#### IMPL-12-E: End-to-End Smoke Test

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `scripts/evolve-smoke-test.ts` (new, dev-only test script) |
| Depends on | IMPL-12-D, IMPL-12-B (CDK deployed) |
| Blocks | — |
| Verification | Manual: SQS test message -> Lambda logs -> new skill in `codevolve-skills` -> validation event in ClickHouse within 60s |

---

#### IMPL-12 Completion Gate

1. `npx tsc --noEmit` — exits 0.
2. `npx jest tests/unit/evolve/` — all pass.
3. `npx cdk synth` — exits 0, template contains `EvolveFn`, `EvolveGapQueue`, `EvolveDlq`, `EvolveJobsTable`.
4. `docs/dynamo-schemas.md` includes `codevolve-evolve-jobs` table spec.
5. E2E smoke test: one valid SQS message -> new skill in DynamoDB -> validation event in ClickHouse.

---

### IMPL-13 Sub-Tasks — Canonical Promotion (Jorven, 2026-03-22)

> Full specification in `docs/validation-evolve.md` §4 and §11. Sub-tasks A and B can run in parallel. C depends on both.

#### Pre-conditions

1. IMPL-11 is complete (skill records have `test_pass_count` and `test_fail_count` attributes from at least one /validate run).
2. `npx tsc --noEmit` exits 0 before starting.

---

#### IMPL-13-A: CDK Resources

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `infra/codevolve-stack.ts` |
| Depends on | — |
| Blocks | IMPL-13-C |
| Verification | `npx cdk synth` exits 0; template contains `PromoteCanonicalFn` (NODEJS_22_X, 30s timeout) with `dynamodb:TransactWriteItems` IAM grant |

**What to build:** `PromoteCanonicalFn` Lambda per `docs/validation-evolve.md` §8.3. Env vars: `SKILLS_TABLE`, `PROBLEMS_TABLE`, `CACHE_TABLE`. API Gateway route `POST /skills/{id}/promote-canonical`.

---

#### IMPL-13-B: Promotion Gate Logic

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/registry/promoteCanonicalGate.ts` (new), `tests/unit/registry/promoteCanonicalGate.test.ts` (new) |
| Depends on | — |
| Blocks | IMPL-13-C |
| Verification | `npx jest tests/unit/registry/promoteCanonicalGate.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:** Pure function `validatePromotionGate(skill)` returning `{ valid: true }` or `{ valid: false; status; code; message }`. Unit tests for every gate condition per `docs/validation-evolve.md` §11 IMPL-13-B scope.

---

#### IMPL-13-C: promote-canonical Handler

| Field | Value |
|-------|-------|
| Owner | Ada |
| Status | [ ] Planned |
| Files | `src/registry/promoteCanonical.ts` (new), `tests/unit/registry/promoteCanonical.test.ts` (new) |
| Depends on | IMPL-13-A, IMPL-13-B |
| Blocks | — |
| Verification | `npx jest tests/unit/registry/promoteCanonical.test.ts` passes; `npx tsc --noEmit` exits 0 |

**What to build:** Full handler per `docs/validation-evolve.md` §4 — GetItem, gate check, previous canonical query (GSI-canonical), TransactWriteItems (promote + demote + update problems), cache invalidation for demoted skill, re-fetch and return PromoteCanonicalResponse. Unit tests per §11 IMPL-13-C scope including TransactionCanceledException ConditionalCheckFailed -> 422.

---

#### IMPL-13 Completion Gate

1. `npx tsc --noEmit` — exits 0.
2. `npx jest tests/unit/registry/` (promoteCanonicalGate + promoteCanonical) — all pass.
3. `npx cdk synth` — exits 0, template contains `PromoteCanonicalFn`.
4. Manual smoke test: create skill -> validate (all pass) -> promote-canonical -> 200, `is_canonical: true`.
5. Demote test: create second skill for same problem -> validate -> promote -> first skill has `is_canonical: false`.

---

## Beta Readiness

> This section tracks work required before public beta launch. All SECURITY tickets must be complete and verified before any public URL is shared or Moltbook posting goes live. AUTH tickets must be complete before CONTENT tickets are actionable.

---

### BETA-01 — SECURITY: Fix SSRF vulnerability in Node 22 skill runner sandbox

| Field | Value |
|-------|-------|
| ID | BETA-01 |
| Owner | Ada |
| Priority | Critical |
| Status | [~] In Progress |
| Files | `src/runners/node22/handler.js`, `tests/unit/runners/node22-sandbox.test.js` |
| Depends on | — |
| Blocks | All public beta traffic |
| Verification | Iris review of patched handler; automated test attempting fetch to 169.254.169.254 returns blocked error, not a response; audit checklist for all dangerous globals signed off |

**2026-04-03 (Ada):** Sandbox rewritten with global shadowing for fetch, process, eval, WebSocket, FormData. Test file created at `tests/unit/runners/node22-sandbox.test.js`. All 8 tests pass. Pending Iris review.

**Context.**
The Node 22 skill runner at `src/runners/node22/handler.js` executes user-submitted skill implementations using `new Function()`. Node 22 exposes `fetch` as a global, meaning any skill implementation can call `fetch('http://169.254.169.254/latest/meta-data/')` and exfiltrate IAM role credentials from the Lambda execution environment. The sandbox currently blocks only `require` (allowlist: `crypto`, `path`) but does not shadow any other Node 22 globals.

**Root cause.**
The sandbox was designed around `require` isolation. It does not account for Node 22 globals introduced after the original sandbox design: `fetch`, `Headers`, `Request`, `Response`, `FormData`, `ReadableStream`, `WritableStream`, `TransformStream`, `WebSocket`, `Blob`, `URL`, `URLSearchParams`, `structuredClone`, `BroadcastChannel`, `MessageChannel`, `MessageEvent`. Several of these (`fetch`, `WebSocket`) provide direct network egress. Others (`process.env`) are pre-existing Node globals not addressed at all.

**Motivation.**
codeVolve is a public registry. Any agent or human can submit a skill. Before beta, a trivial malicious skill could extract the Lambda execution role credentials, enumerate internal VPC resources, or reach DynamoDB/S3 endpoints directly through the metadata service. This is a pre-condition blocker for all public access.

**Acceptance criteria.**

1. `globalThis.fetch` is shadowed with a blocking stub before `new Function()` receives control. Stub throws a descriptive `SandboxNetworkError` for any call.
2. The following globals are similarly stubbed or removed from the function scope: `Headers`, `Request`, `Response`, `WebSocket`, `XMLHttpRequest` (if present), `FormData`.
3. `process` is shadowed: the stub exposes only `{ env: {}, version: process.version, platform: process.platform }` — no `env` values, no `exit`, no `kill`, no `binding`, no `mainModule`.
4. `require` bypass attempts are audited: `global.require`, `globalThis.require`, `Function.prototype.constructor` chain, `eval`. Document each and confirm the `new Function()` context does not expose them.
5. A dedicated test file (`tests/unit/runners/node22-sandbox.test.js`) covers: fetch blocked, process.env empty, require allowlist enforced, eval blocked or harmless, metadata IP unreachable at the code level.
6. Iris reviews the patched handler and the test file before status moves to [✓] Verified.
7. Architectural rule 3 in `docs/architecture.md` is confirmed accurate post-patch: "No network access, no filesystem writes."

**Design note for Ada.**
The shadow must be injected into the `new Function()` parameter list — not just set on `globalThis` of the outer Lambda process — because `new Function()` inherits the global object of the executing realm. The correct pattern is to pass shadow variables as named parameters to the constructed function and declare them as `const fetch = () => { throw new SandboxNetworkError(...) }` in the injected preamble before user code runs.

---

### BETA-02 — SECURITY: API Gateway rate limiting and WAF

| Field | Value |
|-------|-------|
| ID | BETA-02 |
| Owner | Ada |
| Priority | High |
| Status | [ ] Planned |
| Files | `infra/codevolve-stack.ts`, `docs/architecture.md` |
| Depends on | — |
| Blocks | Public beta traffic |
| Verification | Iris review of CDK diff; manual test confirming 429 response at throttle threshold; WAF rule set visible in AWS Console; CORS preflight from non-allowlisted origin returns 403 |

**Context.**
API Gateway currently has no usage plans, no per-key or per-stage throttling, and no WAF in front of it. The `/execute` and `/validate` endpoints invoke sandboxed Lambda runners and update DynamoDB — both are expensive relative to a simple GET. An unauthenticated caller can invoke these at full Lambda concurrency limits at no cost to them and at potentially significant cost and disruption to codeVolve.

**Motivation.**
Before any public URL is shared (Moltbook post, docs, MCP server config), the API must have basic rate limiting and abuse resistance. The goal is not perfect security — it is preventing the most obvious denial-of-wallet and resource exhaustion attacks.

**Acceptance criteria.**

1. API Gateway usage plan created with:
   - Default stage-level throttling: rate = 100 req/s, burst = 200.
   - Per-endpoint override for POST `/execute` and POST `/validate`: rate = 10 req/s, burst = 20.
   - Per-endpoint override for POST `/evolve`: rate = 2 req/s, burst = 5 (Claude API calls are expensive).
2. API keys are required for write endpoints (see BETA-03 for the key system design). Usage plan is associated with the key system introduced in BETA-03.
3. AWS WAF WebACL deployed and associated with the API Gateway stage:
   - AWS Managed Rules: `AWSManagedRulesCommonRuleSet` and `AWSManagedRulesKnownBadInputsRuleSet` enabled.
   - Rate-based rule: block IPs exceeding 1,000 requests per 5-minute window.
4. CORS: `Access-Control-Allow-Origin` header restricted from `*` to an explicit allowlist. For beta, allowlist is `https://codevolve.example.com` and `http://localhost:5173` (local dev). The wildcard origin must be removed from all Lambda handlers that currently set it.
5. CDK diff for BETA-02 changes is reviewed by Iris before deploy.
6. `docs/architecture.md` AWS Resources table updated to include WAF WebACL and Usage Plan.

**Design notes.**
- WAF must be associated at the regional API Gateway level, not at CloudFront (CloudFront WAF is a separate resource in us-east-1). Use `CfnWebACLAssociation` targeting the stage ARN.
- WAF adds ~$5–$15/month at beta traffic volumes. Acceptable.
- Usage plan throttling is per API key at beta. Unauthenticated read endpoints (GET /skills, GET /problems, POST /resolve) are rate-limited at the stage level only, not per-key.

---

### BETA-03 — AUTH: Agent-friendly API key system

| Field | Value |
|-------|-------|
| ID | BETA-03 |
| Owner | Jorven (design) → Ada (implementation) |
| Priority | High |
| Status | [ ] Planned |
| Files | `docs/api.md`, `docs/decisions.md`, `infra/codevolve-stack.ts`, `src/auth/` (new), `tests/unit/auth/` (new) |
| Depends on | BETA-02 (usage plans must exist before API keys can be associated) |
| Blocks | BETA-05 (Moltbook beta tester targeting), BETA-06 (post draft references key signup URL) |
| Verification | Jorven approves API contract before Ada implements; Iris reviews implementation; end-to-end test: POST /auth/keys returns key, key passed as X-Api-Key on POST /skills returns 201, invalid key returns 403 |

**Context.**
The current auth model uses AWS Cognito ID tokens (1-hour expiry). This is hostile to AI agents: tokens expire during long-running tasks, agents cannot complete Cognito sign-up flows autonomously, and there is no concept of a machine identity. The MCP server currently has no practical auth story for agent consumers.

For the beta, agents need a stable, long-lived credential they can configure once and use indefinitely. Humans and admins continue to use Cognito. Read endpoints should have no auth requirement to minimize friction for discovery.

**Motivation.**
Without agent-native auth, the MCP server cannot be used by agents in production. This is the primary integration path for the beta audience. The Moltbook post cannot be written until the key signup URL exists.

**API contract (must be approved by Jorven before implementation begins).**

```
POST /auth/keys
Authorization: Cognito ID token (human/admin only — bootstraps first key)
  OR: existing valid API key (agents can self-issue additional keys)
Body: { "name": "string (agent or service name)", "description"?: "string" }
Response 201:
{
  "key_id": "uuid",
  "api_key": "cvk_<random 48 chars>",   // shown once, never retrievable again
  "name": "string",
  "created_at": "ISO8601",
  "owner_id": "string"                   // Cognito sub or existing key's owner_id
}
Response 400: { "code": "INVALID_REQUEST", "message": "..." }
Response 401: { "code": "UNAUTHORIZED", "message": "..." }

GET /auth/keys
Authorization: Cognito ID token or API key
Response 200: { "keys": [{ "key_id", "name", "description", "created_at", "last_used_at", "revoked" }] }
// Note: api_key value is never returned after creation

DELETE /auth/keys/{key_id}
Authorization: Cognito ID token or API key (owner only)
Response 204: (no body)
Response 403: { "code": "FORBIDDEN", "message": "..." }
Response 404: { "code": "NOT_FOUND", "message": "..." }
```

**DynamoDB table: `codevolve-api-keys`**

```
PK: key_id (String, UUID)
Attributes:
  api_key_hash   String     SHA-256 of the raw api_key (stored, never the raw value)
  owner_id       String     Cognito sub or parent key's owner_id
  name           String
  description    String?
  created_at     String     ISO8601
  last_used_at   String?    ISO8601, updated async on use
  revoked        Boolean    default false
  revoked_at     String?    ISO8601

GSI: gsi-owner (PK: owner_id) — for GET /auth/keys listing
Billing: PAY_PER_REQUEST
```

**Lambda authorizer design.**
A new `api-key-authorizer` Lambda is deployed as a TOKEN-type custom authorizer on API Gateway. It receives the `X-Api-Key` header value, hashes it with SHA-256, queries `codevolve-api-keys` GSI, validates `revoked == false`, writes `last_used_at` asynchronously (fire-and-forget, does not block auth response), and returns an IAM policy document granting `execute-api:Invoke` on the relevant resources.

**Endpoint auth matrix (to be documented in `docs/api.md`):**

| Endpoint | Auth required |
|----------|--------------|
| GET /skills, GET /skills/:id | None |
| GET /problems, GET /problems/:id | None |
| POST /resolve | None |
| POST /execute | None (read-only execution of existing skills) |
| GET /analytics/dashboards/:type | None |
| POST /skills | API key or Cognito |
| POST /problems | API key or Cognito |
| POST /skills/:id/promote-canonical | API key or Cognito |
| POST /validate/:skill_id | API key or Cognito |
| POST /events | API key or Cognito |
| POST /evolve | API key or Cognito |
| POST /auth/keys | Cognito (first key) or API key |
| GET /auth/keys | API key or Cognito |
| DELETE /auth/keys/:id | API key or Cognito (owner only) |

**Acceptance criteria.**

1. ADR recorded in `docs/decisions.md` (ADR-011): API key system rationale, decision to use custom Lambda authorizer over Cognito machine credentials, key format, storage design.
2. `codevolve-api-keys` DynamoDB table deployed via CDK.
3. `api-key-authorizer` Lambda deployed and attached to write endpoints in API Gateway.
4. `POST /auth/keys`, `GET /auth/keys`, `DELETE /auth/keys/:id` implemented and tested.
5. Raw key value is never stored or logged — only SHA-256 hash in DynamoDB.
6. Unit tests cover: valid key accepted, revoked key rejected, non-existent key rejected, malformed key rejected.
7. `docs/api.md` updated with `/auth/keys` contract and the endpoint auth matrix.
8. Cognito authorizer remains in place for human/admin write paths. API key authorizer is additive, not a replacement.

---

### BETA-04 — RESEARCH: Moltbook competitive landscape survey

| Field | Value |
|-------|-------|
| ID | BETA-04 |
| Owner | Human (manual research task) |
| Priority | Medium |
| Status | [ ] Planned |
| Files | `docs/moltbook-research.md` (new, output of this task) |
| Depends on | — |
| Blocks | BETA-06 (post draft should be informed by competitive context) |
| Verification | Output doc exists, covers all items in acceptance criteria, reviewed by project lead before Moltbook post is written |

**Context.**
codeVolve is planning a beta launch post on Moltbook, a social network for AI agents recently acquired by Meta. Before posting, the team needs to understand what is already on Moltbook in the same space — to identify differentiation, avoid reinventing positioning that already exists, find communities to post into, and avoid stepping on active projects that may react negatively.

**Motivation.**
Posting into an existing active community without surveying it first risks missing the right Submolts, duplicating positioning already claimed by a competitor, or generating negative reactions from existing projects. Research first; post second.

**Acceptance criteria.**
The output document `docs/moltbook-research.md` must cover:

1. **Competitive landscape:** A table of any projects found on Moltbook that overlap with codeVolve's positioning — skill/tool registries for agents, caching/memoization services for agent computation, reusable algorithmic primitive libraries, MCP server directories, agent capability registries. For each: project name, Moltbook handle, brief description, apparent activity level, overlap with codeVolve.
2. **Non-overlapping adjacent projects:** Projects in adjacent spaces (agent orchestration, tool use, code generation) that are potential partners or integration targets, not competitors.
3. **Relevant Submolts:** A list of Submolts (topic communities on Moltbook) relevant to the beta post. For each: name, member count if visible, post frequency, fit with codeVolve's topic (developer tools, APIs, MCP, skill reuse, agent infrastructure).
4. **Recommended Submolts to post into:** Ranked shortlist with rationale.
5. **Tone and format notes:** Observations on what kind of posts perform well in the target Submolts — length, framing, technical depth, agent-native vs human-readable tone.
6. **Risks:** Any active hostile projects, drama, or community norms that would affect the launch post strategy.

**Note:** This is a manual human research task. It cannot be automated or delegated to an agent. A human must browse Moltbook's agent feed, search for relevant terms (MCP, skill registry, tool cache, algorithm, resolve intent), and compile findings.

---

### BETA-05 — RESEARCH: Moltbook beta tester identification

| Field | Value |
|-------|-------|
| ID | BETA-05 |
| Owner | Human (manual research task) |
| Priority | Medium |
| Status | [ ] Planned |
| Files | `docs/moltbook-beta-targets.md` (new, output of this task) |
| Depends on | BETA-04 (Submolt list needed to know where to look) |
| Blocks | BETA-06 (post draft benefits from knowing the target audience concretely) |
| Verification | Output doc exists with a shortlist of at least 10 agent accounts and 3 Submolts meeting the criteria below |

**Context.**
The Moltbook launch will be more effective if it reaches agents and operators who are already primed to adopt developer tools, API integrations, and MCP-based skill reuse. Spray-posting to the entire Moltbook feed is low-signal. Targeted reach to the right agents and communities produces better early adopters.

**Motivation.**
Early beta testers who understand the use case will generate real usage data, surface meaningful bugs, and provide credible social proof (votes, reposts, agent-to-agent recommendations on Moltbook). Identifying them in advance lets the team engage directly before or immediately after the post goes live.

**Acceptance criteria.**
The output document `docs/moltbook-beta-targets.md` must include:

1. **Agent account shortlist:** At least 10 Moltbook agent accounts that meet at least two of these criteria:
   - Posts about developer tools, APIs, code generation, or LLM tool use.
   - Mentions MCP servers, skill reuse, or tool registries.
   - Has posted about caching, memoization, or avoiding redundant computation.
   - Is active in developer-adjacent Submolts identified in BETA-04.
   - Has a verifiable operator (human or org) who is reachable for direct outreach.
   For each: handle, follower count if visible, brief description, which criteria they meet, suggested engagement approach (direct message, reply to existing post, mention in launch post).
2. **Submolt target list:** The 3 best Submolts to post into at launch, with rationale and recommended posting order.
3. **Operator contacts:** Any human operators behind the agent accounts who would be worth contacting directly for early access before the public post.
4. **Timing notes:** Any observations about posting cadence, time-of-day activity patterns, or upcoming events in the target communities that would affect launch timing.

---

### BETA-06 — CONTENT: Moltbook beta launch post draft

| Field | Value |
|-------|-------|
| ID | BETA-06 |
| Owner | Jorven (draft) |
| Priority | Low |
| Status | [ ] Planned |
| Files | `tasks/moltbook-post-draft.md` |
| Depends on | BETA-01 (security must be resolved before public launch), BETA-03 (API key URL must exist), BETA-04 (competitive context informs positioning), BETA-05 (audience informs tone) |
| Blocks | — |
| Verification | Draft reviewed and approved by project lead; all TODO placeholders filled in; BETA-01 and BETA-02 verified complete before post goes live |

**Context.**
Moltbook is a short-form social platform for AI agents. Agents browse, vote, and repost content. The audience is primarily AI agents (and their operators), not human developers. The post must be written in a register that an agent would find immediately useful — not a marketing pitch, but a capability announcement with enough specificity to let an agent decide whether to try it.

**Motivation.**
The Moltbook launch is the primary beta acquisition channel. The post is the top of the funnel. It must be written before BETA-01 and BETA-03 are deployed so it is ready to go live immediately when the security and auth gates pass.

**Acceptance criteria.**

1. Draft saved at `tasks/moltbook-post-draft.md`.
2. Post explains codeVolve in agent-native terms: a registry of verified, cached algorithmic skills resolvable by intent and executable via API or MCP server.
3. Post highlights the core value proposition concisely: skip re-deriving known solutions, get sub-second cached results, chain skills into pipelines, contribute improvements back.
4. Post references the three primary integration paths: `/resolve` + `/execute` REST API, MCP server config, skill chaining via `/execute/chain`.
5. Post includes instructions for getting an API key — with a TODO placeholder for the actual URL until BETA-03 is deployed.
6. Post is short-form appropriate: under 300 words, no marketing fluff, no emoji overload, technically specific enough that an agent can evaluate it without clicking through.
7. Post includes a TODO section listing items that must be filled in before publishing: actual API URL, docs URL, API key signup URL, any Submolt targeting notes from BETA-05.
8. Tone review: the draft must read as if written by or for an agent, not a human marketing department. Project lead approves tone before the post goes live.

**Draft location:** `tasks/moltbook-post-draft.md` — see that file for the current draft.

---

## Phase 5 — Visualization + Scale

| ID | Owner | Status | Task |
|----|-------|--------|------|
| ARCH-09 | Jorven | [✓] | Design edge caching: CloudFront distribution, API Gateway response caching, tag-based invalidation strategy, CDN for mountain viz frontend, DynamoDB read-through cache. ADR-010 written to `docs/decisions.md`. Edge Caching section in `docs/architecture.md`. **Completed 2026-03-22.** | — |
| DESIGN-05 | Amber | [✓] | Full mountain visualization spec: Three.js + @react-three/fiber stack, InstancedMesh geometry, component tree, interaction model, filter/zoom behavior, GET /mountain endpoint shape, 5-min refresh cadence. Appended to `docs/platform-design.md`. **Completed 2026-03-22.** | — |
| IMPL-14 | Ada | [✓] | Implement mountain visualization frontend (React + Three.js). Full spec: `docs/platform-design.md` §DESIGN-05. **Completed 2026-03-23.** `frontend/` directory: Vite + React 18 + TypeScript strict, @react-three/fiber, @react-three/drei, Three.js. InstancedMesh bricks (4 meshes by status), orbit camera, hover/click interaction, FilterSidebar, DetailPanel, LoadingOverlay, useMountainData hook (5-min refresh). 25 tests pass, `tsc --noEmit` clean. | DESIGN-05 |
| IMPL-15 | Ada | [✓] | Implement MCP server per DESIGN-06: tools for resolve/execute/chain/validate/list/get/submit, resources for skills/problems, prompt templates generate_skill/improve_skill. Depends on DESIGN-06. stdio server, mcp-config.json, 52 unit tests. **Scaffold complete 2026-03-22.** **REJECTED 2026-03-25 (REVIEW-12):** 5 criticals. **Re-implemented 2026-03-25 (commit 50b61fa). APPROVED WITH NOTES 2026-03-25 (REVIEW-15-IMPL15):** All 5 REVIEW-12 criticals resolved. 52 tests pass (4 suites), `tsc --noEmit` exits 0. W-01: resource handlers do not catch `client.request` errors — inconsistent error contract with tool handlers. W-02: `language` field accepts arbitrary strings in `tools.ts` schemas — enum not enforced. W-03: `submitSkillSchema.status` is `z.string()` not `z.enum(...)`. See `docs/reviews/REVIEW-15-IMPL15.md`. | DESIGN-06 |
| IMPL-16 | Ada | [✓] | Implement community auth (Cognito) + per-user trusted mountain (saved skill sets). CommunityUserPool + UserPoolClient CDK, CognitoUserPoolsAuthorizer on write endpoints, backup JWT Lambda. **Scaffold complete 2026-03-22.** **APPROVED WITH NOTES 2026-03-25 (REVIEW-14-IMPL16):** 31 tests pass (17 authorizer + 14 trustedMountain), tsc and cdk synth clean. W-01: `verifyToken` does not validate `token_use` claim — fix before custom authorizer is used outside backup context. W-02: `authorizerFn` deployed but unattached to any route — document activation conditions or defer deployment. See `docs/reviews/REVIEW-14-IMPL16.md`. | — |
| IMPL-17 | Ada | [✓] | Implement edge caching CDK: CloudFront distribution, S3 bucket for mountain frontend, OAC, API Gateway cache, cache invalidation in write Lambdas. Full spec: `docs/architecture.md §Edge Caching` and ADR-010. **Completed 2026-03-23.** S3 bucket (codevolve-mountain-frontend-{account}), OAC, CloudFront distribution (PriceClass_100) with 5 cache behaviors, API GW stage cache (0.5 GB, 60s on GET /skills* and /problems*), `codevolve-read-cache` DynamoDB table, CloudFront invalidation in createSkill/createProblem/promoteCanonical/archiveSkill/unarchiveSkill. `src/shared/cloudfrontInvalidation.ts`, 6 unit tests. `tsc --noEmit` and `cdk synth` both exit 0. | ARCH-09 |
| IMPL-18 | Ada | [✓] | Implement analytics dashboard frontend. Full spec: `docs/platform-design.md` §DESIGN-07. **Approved with notes 2026-03-25 (REVIEW-13-IMPL18):** 5 dashboards implemented (Recharts), all 72 tests pass, 47 new IMPL-18 tests. **Re-reviewed 2026-03-25 (REVIEW-15-IMPL18, Iris):** W-01/W-02/W-04 resolved; 75 tests pass (3 new). W-03 (from/to date range) deferred — carried forward. Pre-existing `tsc --noEmit` failure in `mountain.ts` (IMPL-14 carry-forward). | DESIGN-07, IMPL-09 |
