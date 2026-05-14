# codeVolve Mirrored Public Beta Flow Evidence Record - May 13, 2026

> First live execution record for [docs/public-beta-mirror-flow.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-mirror-flow.md).

## Run Metadata

| Field | Value |
|---|---|
| Run date | May 13, 2026 7:45 PM America/New_York |
| Environment | Local PowerShell from the main repo workspace |
| Operator | Codex |
| Fresh reader | Operator-simulated fresh-agent pass |
| Recorder | Codex |
| API base URL | `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1` |
| Landing URL used | `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/` |
| Launch-copy variant | default mirrored copy |
| First path chosen by reader | API |
| Root key issued | yes |
| Child key issued | yes |
| Skill ID used for feedback step | `f13a0151-cede-4a79-b76d-b2d000f56db5` |
| Overall verdict | SOFT FAIL |

## Step Record

| Step | Goal | Result | Evidence | Rescue needed | Notes |
|---|---|---|---|---|---|
| 1 | First-contact copy sets the correct mental model | PASS | The launch-copy model matched the live discovery surface: registry/routing product, local execution, API-key writes, docs/discovery first. | no | Operator-simulated because no separate human reader was available in-thread. |
| 2 | Docs or discovery landing explains intent, local execution, feedback, and auth | PASS | `GET /` returned `POST /intent`, local execution wording, feedback-style `/validate/{skill_id}`, and API-key auth for writes. | no | Discovery is currently the public onboarding surface. |
| 3 | API-key auth instructions are understandable and usable | PASS | `POST /auth/register` issued agent `agt_d810d9e4-4cf8-4e82-8276-1085efc856ed`; `GET /auth/keys` and `POST /auth/keys` both succeeded. | no | Root key id `d2f5d29e-baa2-401a-b3de-7c53f2265d7e`; child key id `5b80aa92-3702-41f1-a427-0c207462e78b`. |
| 4 | API quickstart leads to a valid route/read-first workflow | PASS | Created problem `0809940d-4c70-41e4-9ee7-78bee3266307`, created skill `f13a0151-cede-4a79-b76d-b2d000f56db5`, then `POST /intent` returned the new skill as `best_match`. | no | Confirms the shortest plausible path is route/read first, not `/execute`. |
| 5 | MCP quickstart mirrors the same beta model clearly | SOFT FAIL | MCP tool and resource wording in `src/mcp/server.ts` is aligned, but the public docs/discovery landing did not expose an explicit MCP quickstart before this follow-up edit. | yes | Reader would have needed source inspection or operator direction to find `resolve_skill`, `get_skill`, `feedback_skill`, and `codevolve://skills/{skill_id}`. |
| 6 | One caller-reported feedback write succeeds | PASS | Local run passed `2/2` tests, then `POST /validate/f13a0151-cede-4a79-b76d-b2d000f56db5` returned `new_confidence = 1` and `new_status = verified`. | no | Confirms feedback is caller-reported local validation, not hosted execution. |
| 7 | Reader would continue without operator intervention | SOFT FAIL | API onboarding now looks linear, but MCP onboarding was not self-discoverable from the public landing surface before the doc fix. | yes | Requires one confirmation rerun after adding a public MCP quickstart. |

## Exact Friction Points

| Order seen | Location | What confused the reader | Why it matters | Proposed fix |
|---|---|---|---|---|
| 1 | [docs/api.md](/C:/Users/pgl49/source/repos/codevolve/docs/api.md) | No explicit MCP quickstart or env-var bootstrap was present on the public docs surface. | Mirror flow Step 5 requires the MCP path to be discoverable without internal context. | Add a short MCP quickstart section with `CODEVOLVE_API_URL`, `CODEVOLVE_API_KEY`, and the first tools/resources to call. |
| 2 | Discovery-only landing | Discovery returned API facts but no direct MCP entry-point guidance. | A fresh reader can pass the REST path and still miss the supported MCP path entirely. | Keep discovery as the onboarding URL for now, but make the linked docs surface include the MCP quickstart. |

## Contract Checks

| Statement | Pass? | Notes |
|---|---|---|
| Reader understood `POST /intent` is the primary routing entry point | yes | Confirmed directly from discovery. |
| Reader understood execution is local, not hosted by codeVolve | yes | Present in discovery and upheld by the live run. |
| Reader understood `POST /validate/:skill_id` is feedback-style validation | yes | Confirmed by discovery wording and successful feedback write. |
| Reader understood API keys are required for writes | yes | Confirmed by `register`, `GET /auth/keys`, `POST /auth/keys`, and `POST /validate`. |
| Reader did not assume Cognito or IAM was required for beta onboarding | yes | Discovery correctly scoped Cognito to internal controls. |
| Reader did not assume the dashboard web UI was required | yes | The mirror run succeeded entirely through discovery and API routes. |

## Evidence Snippets

### Step 1 Reader Summary

```text
codeVolve is a registry and routing layer for agent-use programming skills. It does not run the code for you; the caller executes locally and can report feedback back to the registry. API keys are needed for writes, and the first place to start is docs/discovery, then API or MCP quickstart.
```

### Step 2 Landing Proof

```text
GET / returned base_url and docs_url at the live execute-api host, identified POST /intent as the routing path, described POST /execute as telemetry only, described POST /validate/{skill_id} as caller-reported validation feedback, and marked write routes as api_key-authenticated.
```

### Step 3 Auth Output

```text
POST /auth/register -> agent agt_d810d9e4-4cf8-4e82-8276-1085efc856ed, root key id d2f5d29e-baa2-401a-b3de-7c53f2265d7e
GET /auth/keys -> 1 key listed
POST /auth/keys -> child key id 5b80aa92-3702-41f1-a427-0c207462e78b
```

### Step 4 API Quickstart Output

```text
POST /problems -> 0809940d-4c70-41e4-9ee7-78bee3266307
POST /skills -> f13a0151-cede-4a79-b76d-b2d000f56db5
POST /intent ("add two integers beta mirror 20260513-194500") -> best_match f13a0151-cede-4a79-b76d-b2d000f56db5
GET /skills/f13a0151-cede-4a79-b76d-b2d000f56db5 -> status partial before feedback
```

### Step 5 MCP Proof

```text
Aligned source wording exists in src/mcp/server.ts:
- resolve_skill routes through /intent
- get_skill fetches the implementation/tests for local execution
- feedback_skill reports caller-run local test feedback
- codevolve://skills/{skill_id} exposes the full skill payload as a resource

Public docs did not expose this flow before the follow-up docs/api.md quickstart edit in this task.
```

### Step 6 Feedback Response

```json
{
  "skill_id": "f13a0151-cede-4a79-b76d-b2d000f56db5",
  "pass_count": 2,
  "fail_count": 0,
  "total_tests": 2,
  "new_confidence": 1,
  "new_status": "verified"
}
```

## Final Assessment

### Should this flow be safe to mirror publicly after launch-copy cleanup?

`not yet`

### What must change before that is true?

1. Keep the new MCP quickstart on the public docs surface and confirm it is the version linked from the launch path.
2. Rerun the mirrored flow with no operator rescue on the MCP step.
3. Then update `BETA-20` to complete and use that evidence when drafting `BETA-06`.

### Follow-up owners

| Gap | Owner | Target task |
|---|---|---|
| Confirm public MCP onboarding from the docs/discovery landing | Ada | BETA-20 |
| Rerun the mirrored flow after the docs update | Jorven -> Ada | BETA-20 |
| Rewrite launch copy against the confirmed onboarding path | Jorven | BETA-06 |
