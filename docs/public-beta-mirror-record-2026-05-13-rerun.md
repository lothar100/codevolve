# codeVolve Mirrored Public Beta Flow Evidence Record - May 13, 2026 Rerun

> Confirming live execution record for [docs/public-beta-mirror-flow.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-mirror-flow.md) after the MCP onboarding fixes were deployed.

## Run Metadata

| Field | Value |
|---|---|
| Run date | May 13, 2026 8:02 PM America/New_York |
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
| Skill ID used for feedback step | `4f9e8a9a-3995-4bf0-9c2b-d51eb476c519` |
| Overall verdict | PASS |

## Step Record

| Step | Goal | Result | Evidence | Rescue needed | Notes |
|---|---|---|---|---|---|
| 1 | First-contact copy sets the correct mental model | PASS | The live landing surface still matched the launch-copy model: registry/routing product, local execution, API-key writes, docs/discovery first. | no | Same mental-model check as the first run. |
| 2 | Docs or discovery landing explains intent, local execution, feedback, and auth | PASS | `GET /` returned live `base_url`, `docs_url`, API-key auth guidance, local execution wording, feedback-style `/validate`, and an `mcp` section with first-step guidance. | no | The public landing URL is now sufficient by itself. |
| 3 | API-key auth instructions are understandable and usable | PASS | `POST /auth/register` issued root key `cca056bc-c14d-4b9d-9762-d06c33253499`; `GET /auth/keys` and `POST /auth/keys` both succeeded. | no | Child key id `7dafcf67-a97d-468e-8fde-c923970e1c76`. |
| 4 | API quickstart leads to a valid route/read-first workflow | PASS | Created a new problem and skill, then routed with a unique intent and received the new skill as `best_match`. | no | Confirms route/read-first still works after the discovery update. |
| 5 | MCP quickstart mirrors the same beta model clearly | PASS | The deployed discovery payload now exposes MCP bootstrap env vars, primary tools, resource URIs, and the compatibility alias. Using the documented binary at `packages/mcp-server/dist`, `resolve_skill`, `get_skill`, and `codevolve://skills/{skill_id}` all worked against the live API. | no | No source inspection or operator reinterpretation was needed. |
| 6 | One caller-reported feedback write succeeds | PASS | Local run passed `2/2` tests, then `feedback_skill` succeeded through the package MCP client and returned `new_confidence = 1` and `new_status = verified`. | no | This proves the public MCP client path now uses the correct `X-Api-Key` contract. |
| 7 | Reader would continue without operator intervention | PASS | The public landing surface now exposes the MCP path directly and the package MCP binary follows the same beta contract as REST. | no | The second-run no-rescue requirement is satisfied. |

## Contract Checks

| Statement | Pass? | Notes |
|---|---|---|
| Reader understood `POST /intent` is the primary routing entry point | yes | Confirmed by discovery and the live `resolve_skill` call. |
| Reader understood execution is local, not hosted by codeVolve | yes | Discovery and MCP wording both state local execution explicitly. |
| Reader understood `POST /validate/:skill_id` is feedback-style validation | yes | Confirmed by the `feedback_skill` call and returned payload. |
| Reader understood API keys are required for writes | yes | Confirmed by discovery and the live auth/bootstrap path. |
| Reader did not assume Cognito or IAM was required for beta onboarding | yes | Discovery continues to scope Cognito to internal controls only. |
| Reader did not assume the dashboard web UI was required | yes | The full flow succeeded from discovery, REST, and MCP only. |

## Evidence Snippets

### Step 2 Landing Proof

```text
GET / returned an mcp object with CODEVOLVE_API_URL, CODEVOLVE_API_KEY, first_steps, resolve_skill, get_skill, feedback_skill, codevolve://skills/{skill_id}, and validate_skill -> feedback_skill compatibility guidance.
```

### Step 5 MCP Proof

```text
Documented package path used: packages/mcp-server/dist
resolve_skill -> best_match 4f9e8a9a-3995-4bf0-9c2b-d51eb476c519
get_skill -> skill.skill_id 4f9e8a9a-3995-4bf0-9c2b-d51eb476c519
codevolve://skills/4f9e8a9a-3995-4bf0-9c2b-d51eb476c519 -> same skill payload
feedback_skill -> new_confidence 1, new_status verified
```

### Step 6 Feedback Response

```json
{
  "skill_id": "4f9e8a9a-3995-4bf0-9c2b-d51eb476c519",
  "pass_count": 2,
  "fail_count": 0,
  "total_tests": 2,
  "new_confidence": 1,
  "new_status": "verified"
}
```

## Final Assessment

### Should this flow be safe to mirror publicly after launch-copy cleanup?

`yes`

### What must change before that is true?

1. Rewrite the public launch copy for `BETA-06` against the now-proven landing path.

### Follow-up owners

| Gap | Owner | Target task |
|---|---|---|
| Rewrite launch copy against the confirmed onboarding path | Jorven | BETA-06 |
