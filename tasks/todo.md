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
| IMPL-08 | Ada | [ ] | Implement analytics event consumer: Kinesis → Lambda → ClickHouse/BigQuery. Batch writes, dead-letter queue, idempotent processing. | ARCH-07, DESIGN-02 |
| IMPL-09 | Ada | [ ] | Implement 5 dashboard API endpoints (read from ClickHouse/BigQuery). | IMPL-08, DESIGN-02 |
| IMPL-10 | Ada | [ ] | Implement Decision Engine Lambda (scheduled): auto-cache trigger, optimization flag, gap detection → SQS GapQueue, archive evaluation → SQS ArchiveQueue. | ARCH-07, DESIGN-03 |
| DESIGN-04 | Amber | [✓] | Design mountain visualization data shape: what JSON does the frontend need, how to aggregate skill data for rendering. Output to `docs/platform-design.md`. Completed 2026-03-21. Full spec in docs/platform-design.md §DESIGN-04. IMPL-09 unblocked (pending Phase 2 completion). | Phase 2 complete |
| REVIEW-07 | Iris | [ ] | Review IMPL-08 + IMPL-09 — verify analytics separation, no primary DB writes, query correctness. | IMPL-08, IMPL-09 |
| REVIEW-08 | Iris | [ ] | Review IMPL-10 (Decision Engine) — verify rule logic, archive trigger safety (no premature archival), gap detection accuracy. | IMPL-10 |

---

## Phase 4 — Validation + Quality

| ID | Owner | Status | Task | Depends On |
|----|-------|--------|------|-----------|
| ARCH-08 | Jorven | [ ] | Design /validate endpoint and test runner: Lambda container approach, test execution format, confidence score formula, canonical promotion gate logic. | Phase 3 complete |
| IMPL-11 | Ada | [ ] | Implement /validate: sandboxed test runner, confidence score update in DynamoDB, emit validation event. | ARCH-08 |
| IMPL-12 | Ada | [ ] | Implement /evolve: consume GapQueue, construct skill-generation prompt, call Claude API (claude-sonnet-4-6), parse output into skill contract, auto-trigger /validate. | ARCH-08 |
| IMPL-13 | Ada | [ ] | Implement canonical promotion: `POST /skills/:id/promote-canonical` — verify confidence >= 0.85, all tests passing, demote previous canonical for same problem. | ARCH-08 |

---

## Phase 5 — Visualization + Scale

| ID | Owner | Status | Task |
|----|-------|--------|------|
| DESIGN-05 | Amber | [ ] | Full mountain visualization spec: Three.js approach, React component tree, interaction model, filter/zoom behavior. |
| IMPL-14 | Ada | [ ] | Implement mountain visualization frontend (React + Three.js). |
| IMPL-15 | Ada | [ ] | Implement MCP server per DESIGN-06: tools for resolve/execute/chain/validate, resources for skills/problems. Depends on DESIGN-06. |
| IMPL-16 | Ada | [ ] | Implement community auth (Cognito) + per-user trusted mountain (saved skill sets). |
