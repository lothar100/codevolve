## Iris Review — IMPL-16 / Community Auth (Cognito) + Trusted Mountain

### Verdict: APPROVED WITH NOTES

---

### Test Results

```
Tests:       31 passed, 31 total  (17 authorizer + 14 trustedMountain)
Test Suites: 2 passed, 2 total
Time:        0.785 s
```

TypeScript: one pre-existing error in `tests/unit/mcp/server.test.ts` (MCP SDK missing — carried from REVIEW-12-IMPL15); no errors in IMPL-16 files.

CDK synth: exits 0. 48 feature flags note is CDK tooling noise, not a stack error.

---

### Review Questions

**1. Would a senior engineer approve this implementation?**

Yes. Both files are clean and readable without over-commenting. Names are accurate (`extractUserId`, `getJwksKeys`, `buildPolicy`, `addToTrustedMountain`). Logic is linear and free of cleverness. The decision to use Node.js built-in `https` and `crypto` instead of `jsonwebtoken` or `jwks-rsa` is appropriate given the zero-external-deps constraint stated in the task spec, and the implementation is correct. The trustedMountain handler's three-branch `if` dispatch is clear and easy to follow.

**2. Is there a simpler solution?**

For the custom JWT authorizer: no. The constraint is zero external dependencies, so the manual JWKS fetch + RSA verification is the correct path. The implementation is already minimal.

For `trustedMountain.ts`: the GET/POST/DELETE handler is compact at 201 lines including comments. The `extractUserId` helper is clean and reusable. The one potential simplification — skipping the `GetCommand` existence check before `DeleteCommand` and relying on `ConditionExpression` instead — would remove a round-trip but the current pattern is more legible for the 404 case and acceptable at this scale.

**3. Are there unintended side effects?**

None found. `trustedMountainFn` is granted `ReadWriteData` on `trustedMountainTable` only — it does not touch skills, problems, cache, or Kinesis. The authorizer Lambda is not wired into the API Gateway auth chain (it is deployed as a standalone backup Lambda); actual API Gateway authentication uses `CognitoUserPoolsAuthorizer`. This means the custom authorizer Lambda exists as dead infrastructure for now, which is noted below.

**4. Are edge cases handled?**

- Missing/malformed Authorization header: Deny returned (not thrown) — correct for API Gateway.
- Expired token: checked before JWKS fetch — efficient.
- Wrong issuer: validated before signature check — correct order.
- Non-RS256 algorithm: rejected before any key lookup — correct.
- `kid` not found in JWKS: error with descriptive message.
- Invalid signature: explicit false check.
- Empty trusted mountain (GET): returns `{ items: [] }` — correct.
- POST with non-UUID `skill_id`: zod schema catches with `VALIDATION_ERROR`.
- POST with invalid JSON body: caught, returns 400.
- DELETE with missing path parameter: returns 400.
- DELETE of non-existent entry: GetCommand check returns 404 before DeleteCommand.
- Missing or empty `userId` in authorizer context: defensive `extractUserId` returns null, handler returns 401.
- Unsupported HTTP methods: 405 with `METHOD_NOT_ALLOWED`.

One genuine gap:

- The `verifyToken` function does not validate the `token_use` claim. Cognito issues both `id` tokens and `access` tokens; the API should reject ID tokens (`token_use: "id"`) and accept only access tokens (`token_use: "access"`). Without this check, a client presenting an ID token (which may have a different expiry policy and is not intended for API authorization) will be accepted. This is a warning, not a critical, because `CognitoUserPoolsAuthorizer` is the live enforcement path and Cognito's own authorizer validates `token_use` correctly. The custom Lambda is currently backup/non-APIGW use only.

**5. Does the change follow the architectural plan?**

Yes. No LLM calls anywhere in these files. No analytics events written to DynamoDB — trusted mountain writes go only to `codevolve-trusted-mountains`. `userId` is always sourced from JWT context, never from request body, confirmed by dedicated isolation tests. CDK confirms:

- `CommunityUserPool` created with email sign-in, `selfSignUpEnabled: true`, password policy, `RETAIN` removal policy.
- `UserPoolClient` (codevolve-spa) with `userPassword` and `userSrp` auth flows, no secret.
- `CognitoUserPoolsAuthorizer` wired with `identitySource: method.request.header.Authorization`.
- `withAuth` applied to: `POST /skills`, `POST /skills/:id/promote-canonical`, `POST /problems` — all correct write endpoints.
- `withAuth` NOT applied to: `GET /skills`, `GET /skills/:id`, `GET /problems`, `GET /problems/:id`, `POST /resolve`, `POST /execute`, `POST /validate/:id`, `POST /events` — correct; public/agent-facing reads are unauthenticated.
- `GET /users/me/trusted-mountain`, `POST /users/me/trusted-mountain`, `DELETE /users/me/trusted-mountain/{skill_id}` all have `withAuth` — correct; all three methods on a user-scoped resource should be auth-gated.
- `trustedMountainTable.grantReadWriteData(trustedMountainFn)` only — no over-granting.
- `TrustedMountainTable` uses `user_id` (PK) + `skill_id` (SK) — matches handler access patterns exactly.

---

### Security Check

- [x] Input validation: Pass — `AddSkillBodySchema` (zod) on POST body; `skill_id` path parameter presence checked before use; no body parsing on GET or DELETE.
- [x] DynamoDB safety: Pass — all expressions use parameterized `ExpressionAttributeValues` (`":uid": userId`); no string concatenation in query expressions.
- [x] Sandbox integrity: N/A — no skill execution in this module.
- [x] Error response safety: Pass — the catch block in the main handler returns `"An internal error occurred"` without stack trace or internal table names. The 404 message does include `skill_id` from the path parameter, which is acceptable (not sensitive) and mirrors the user's own request input.

---

### Issues Found

- [WARNING] `verifyToken` does not validate `token_use` claim. Cognito access tokens have `token_use: "access"`; ID tokens have `token_use: "id"`. The custom authorizer Lambda should reject ID tokens. Not blocking because `CognitoUserPoolsAuthorizer` is the live enforcement path, but fix before the custom Lambda is used in production or wired into APIGW.

- [WARNING] `authorizerFn` Lambda is deployed but never attached to any API Gateway route. The CDK comment labels it "backup for non-APIGW contexts." This is legitimate, but the function incurs deployment cost and has no documented activation path. Jorven should either document when/how it gets activated, or hold off deploying it until needed.

- [SUGGESTION] The `UserPoolClient` has no `oAuth` flows defined and no `supportedIdentityProviders`. If social login or PKCE flows are planned for Phase 5 community auth, they will require a client update. No action needed now.

- [SUGGESTION] `TrustedMountainTable` has no GSI. The current access pattern (query by `user_id`) is served by the PK alone, so no GSI is needed. If a future "which users have bookmarked skill X?" admin query is added, a GSI on `skill_id` would be required. Fine for now — just track when adding admin tooling.

- [SUGGESTION] POST `/users/me/trusted-mountain` returns `200` on success. Convention in this codebase (see `createSkill.ts`) is `201 Created` for resource creation. Re-adding the same `skill_id` is idempotent and updates `saved_at`, so `200` is defensible, but the inconsistency is worth noting. No change required — document the idempotency intent in the API spec update.

---

### Notes for Ada / Jorven

1. The `token_use` warning is the one item that should be fixed before the custom authorizer Lambda is promoted from backup to primary in any context. It is a two-line addition (`claims.token_use !== "access"` check after the issuer check in `verifyToken`).

2. The CDK comment on line 552 ("backup for non-APIGW contexts") should be tracked as a follow-up: either document the activation conditions in `docs/` or remove the Lambda until it is needed. Paying for an unused Lambda in perpetuity is noise.

3. The `COGNITO_REGION` and `COGNITO_USER_POOL_ID` environment variables are passed to `trustedMountainFn` (lines 574–575 in stack) but `trustedMountain.ts` does not read them — it only reads `TRUSTED_MOUNTAIN_TABLE`. Those env vars are harmless but unnecessary on that function. Suggest removing them in a cleanup pass.

4. All three hard rules most likely to be violated here are clean:
   - No LLM calls outside `src/evolve/`: confirmed.
   - Analytics not in primary DynamoDB: no analytics in this module.
   - `userId` from JWT context only: confirmed by code and dedicated isolation tests.
