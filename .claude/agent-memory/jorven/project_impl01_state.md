---
name: project_impl01_state
description: State of the codeVolve repo when Jorven wrote the IMPL-01 scaffold plan on 2026-03-21. Records what was already implemented, what gaps existed, and what the plan prescribed. Useful for understanding what Ada did and whether IMPL-01 is complete.
type: project
---

## Context

IMPL-01 plan was written on 2026-03-21 after REVIEW-02 approved ARCH-01 and ARCH-02.

## What was already present (before IMPL-01 work began)

The repo was significantly pre-populated, not a blank slate. The following existed as untracked files:

### Configuration files (all present)
- `package.json` — correct dependencies, scripts, CDK v2, ts-jest 29, TypeScript 5.7. Missing only `"engines"` field.
- `tsconfig.json` — correct strict mode, NodeNext module resolution. Missing ts-node CommonJS override block.
- `jest.config.ts` — unit and integration projects defined. Used wrong tsconfig (main tsconfig, not a test-specific one).
- `cdk.json` — app entry correct. Missing most standard CDK v2 feature flags. Lambda runtime was Node 20 (wrong).

### Source files (substantially populated)
- `src/shared/` — types.ts, validation.ts, dynamo.ts, emitEvent.ts, kinesis.ts, response.ts, health.ts, eventBuilders.ts (all complete implementations)
- `src/registry/` — createSkill.ts, getSkill.ts, listSkills.ts, createProblem.ts, getProblem.ts, promoteCanonical.ts, bedrock.ts (all complete implementations)
- `src/analytics/` — emitEvents.ts (complete implementation)
- `src/archive/` — archiveSkill.ts, unarchiveSkill.ts, archiveHandler.ts, archiveUtils.ts (complete implementations)
- `src/router/`, `src/execution/`, `src/validation/`, `src/evolve/` — EMPTY (only .gitkeep files)

### Infra (complete)
- `infra/app.ts` — CDK app entry, hardcoded account 178778217786, region us-east-2
- `infra/codevolve-stack.ts` — full CDK stack with all DynamoDB tables, Kinesis, Lambda functions, API Gateway routes. Used NODEJS_20_X (wrong).

### Tests (present)
- `tests/unit/` — 12 test files across registry, archive, shared modules
- `tests/integration/` — empty (.gitkeep only)

## Gaps found and what the plan prescribes

| Gap | Severity | Sub-task | Fix |
|-----|----------|----------|-----|
| Missing `"engines"` field in package.json | Minor | IMPL-01-A | Add `"engines": { "node": ">=22" }` |
| tsconfig.json has no ts-node override | Blocking for CDK synth | IMPL-01-B | Add `"ts-node": { "compilerOptions": { "module": "CommonJS", "moduleResolution": "node" } }` block |
| jest.config.ts references main tsconfig (NodeNext) | Blocking for Jest | IMPL-01-C | Create tsconfig.test.json (CommonJS), update both jest projects to reference it |
| Lambda runtime hardcoded as NODEJS_20_X | Architecture violation | IMPL-01-D | Replace all NODEJS_20_X with NODEJS_22_X, node20 with node22 in infra/codevolve-stack.ts |
| cdk.json missing CDK v2 feature flags | Quality | IMPL-01-D | Replace context block with full set of ~28 standard CDK v2 flags |
| src/router/, src/execution/, src/validation/, src/evolve/ have no TypeScript files | Structural gap | IMPL-01-E | Create stub index.ts with `export {}` in each |

## Key finding: kinesis.ts vs emitEvent.ts duplication

Two files do similar things:
- `src/shared/kinesis.ts` — thin wrapper, no validation, throws on error
- `src/shared/emitEvent.ts` — validates with Zod, fire-and-forget, batch support

The archive module (`archiveSkill.ts`) imports from `kinesis.ts` (the throwing one). The IMPL-01 plan does not address this — it is a concern for IMPL-03 review (REVIEW-03). Flagged for Iris.

## Completion gate for IMPL-01

1. `npx tsc --noEmit` exits 0
2. `npx jest` exits 0 (all 12 existing unit tests pass)
3. `npx cdk synth` exits 0
4. CloudFormation template contains `nodejs22.x` for all Lambdas
5. `grep -r "NODEJS_20" infra/codevolve-stack.ts` returns no matches
