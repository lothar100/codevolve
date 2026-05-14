# codeVolve Beta Smoke Record - May 13, 2026 Rerun 3

> Fourth execution record for `BETA-09` against the live beta deployment on the same date. This appends evidence rather than replacing earlier runs.

**Result:** `PASS / GO`  
**Date:** May 13, 2026  
**Run time:** approximately 7:34 PM America/New_York  
**Operator environment:** local PowerShell from the main repo workspace  
**Runbook used:** [docs/beta-smoke-path.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-path.md)

## Target

- Shared deployed API URL used for the live check: `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/`

## Summary

The smoke path was rerun on May 13, 2026 after redeploying the backend and frontend.

This run passed end to end:

1. Anonymous discovery returned the reachable AWS API URL as both `base_url` and `docs_url`.
2. `POST /auth/register` succeeded with the documented `name` field and issued a usable first API key.
3. Root and child API key flows both worked.
4. Problem creation, skill submission, anonymous intent lookup, MCP resource read, feedback submission, canonical promotion, and public readback all succeeded.
5. The newly submitted skill was returned in the anonymous intent lookup immediately with no retry delay, although an older beta-smoke skill remained the `best_match` for the generic query text.

## Step Record

| Step | Expected | Actual | Result |
|---|---|---|---|
| `GET /` discovery | Reachable discovery returns `200` and public onboarding URLs | `200 OK`; discovery returned the AWS execute-api URL for both `base_url` and `docs_url` | `PASS` |
| `POST /auth/register` | Request succeeds with first API key | `201 Created`; issued agent `agt_cd9961b1-a448-4a57-8b0a-39daa02cb620` and key `9f0d0180-326d-4b3d-a3db-f5dce4de1abc` | `PASS` |
| `GET /auth/keys` | Root key works for key listing | `200 OK`; keys list included the root key | `PASS` |
| `POST /auth/keys` | Child key is issued under same account | `201 Created`; child key `dcd10e91-e548-4996-9a84-a50778bdc585` owned by `agt_cd9961b1-a448-4a57-8b0a-39daa02cb620` | `PASS` |
| `POST /problems` | Create smoke problem | `201 Created`; problem `0174ddcb-d747-4958-a2cc-936977f8fbfd` | `PASS` |
| `POST /skills` | Create smoke skill | `201 Created`; skill `cd0acc2b-9941-489f-8757-e91d9fd5cbcd` with `is_canonical = false` and `confidence = 0` | `PASS` |
| `POST /intent` | Skill appears on anonymous read path | `200 OK`; the new skill appeared immediately with `0` seconds retry delay | `PASS` |
| MCP resource read | `codevolve://skills/{skill_id}` returns the same skill payload | Succeeded for `codevolve://skills/cd0acc2b-9941-489f-8757-e91d9fd5cbcd` and included implementation, tests, and validation fields | `PASS` |
| `POST /validate/{skill_id}` | Passing feedback updates confidence and status | `200 OK`; `new_confidence = 1`, `new_status = optimized`, `fail_count = 0` | `PASS` |
| `POST /skills/{id}/promote-canonical` | Promote the validated skill | Canonical state verified on public readback; a duplicate promote retry observed `already canonical` only after the successful promote | `PASS` |
| `GET /skills/{id}` | Public readback shows promoted state | `200 OK`; skill remained non-archived and canonical with `status = optimized` | `PASS` |

## IDs

- Agent ID: `agt_cd9961b1-a448-4a57-8b0a-39daa02cb620`
- Root key ID: `9f0d0180-326d-4b3d-a3db-f5dce4de1abc`
- Child key ID: `dcd10e91-e548-4996-9a84-a50778bdc585`
- Problem ID: `0174ddcb-d747-4958-a2cc-936977f8fbfd`
- Skill ID: `cd0acc2b-9941-489f-8757-e91d9fd5cbcd`

## Notable Observation

The generic query `sum two integers` returned an older beta-smoke skill as `best_match`, while the newly submitted skill still appeared in `matches` immediately and was therefore visible on the anonymous routing path without delay. That satisfies the current runbook, but it suggests the intent-ranking surface is sensitive to prior smoke data when queries are intentionally generic.

## What This Means

- `BETA-09` now has a live passing end-to-end smoke record on May 13, 2026.
- The previously blocking production issues on discovery and self-serve registration were resolved by the redeploy.
- Public beta still depends on the remaining launch-gate decisions in the task log, but this specific smoke-path blocker is no longer failing.
