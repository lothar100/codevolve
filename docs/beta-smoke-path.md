# codeVolve Beta Smoke Path

> Purpose: one authoritative happy-path verification for `BETA-09` under the current public-beta model.

This smoke path verifies the shipped beta story end to end:

`anonymous discovery -> agent registration -> API key issuance/use -> problem setup -> skill submission -> anonymous intent lookup -> MCP read path -> feedback submission -> canonical promotion`

This is a concrete runbook, not a general API reference. If this flow fails, public beta is not ready.

## Preconditions

- You have a deployed beta API base URL.
- You have `curl` and `jq`.
- You can run the MCP server locally if you want to verify the MCP step directly.
- You are using a fresh problem and skill name to avoid collisions with existing data.

Set these once before starting:

```powershell
$env:BASE_URL = "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1"
$env:SMOKE_SUFFIX = (Get-Date -Format "yyyyMMdd-HHmmss")
```

## Step 1: Anonymous Discovery

Goal: confirm a new agent can discover the product model and auth options without credentials.

```powershell
curl.exe -s "$env:BASE_URL/" | jq
```

Verify:

- Response is `200`.
- `service` is `codevolve`.
- `endpoints` includes `POST /auth/register`, `POST /skills`, `POST /validate/{skill_id}`, and `POST /skills/{id}/promote-canonical`.
- `auth_schemes.api_key` explains `X-Api-Key`.

## Step 2: Register a Standalone Agent and Capture the First Key

Goal: mint the first usable API key without prior auth.

```powershell
$register = curl.exe -s `
  -X POST "$env:BASE_URL/auth/register" `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"beta-smoke-root-$env:SMOKE_SUFFIX\"}" | jq

$register

$env:ROOT_API_KEY = ($register | jq -r ".api_key")
$env:ROOT_KEY_ID = ($register | jq -r ".key_id")
$env:AGENT_ID = ($register | jq -r ".agent_id")
```

Verify:

- Response is `201`.
- `agent_id`, `key_id`, and `api_key` are present.
- `api_key` is only returned here. Treat it as secret material.

## Step 3: Prove the Root Key Works

Goal: confirm authenticated key-management calls succeed.

```powershell
curl.exe -s `
  -H "X-Api-Key: $env:ROOT_API_KEY" `
  "$env:BASE_URL/auth/keys" | jq
```

Verify:

- Response is `200`.
- The returned `keys` array includes `$env:ROOT_KEY_ID`.
- No raw API key value is returned from `GET /auth/keys`.

## Step 4: Issue a Child API Key and Use It for the Remaining Write Path

Goal: verify self-service key rotation and authenticated writes under the same account.

```powershell
$child = curl.exe -s `
  -X POST "$env:BASE_URL/auth/keys" `
  -H "Content-Type: application/json" `
  -H "X-Api-Key: $env:ROOT_API_KEY" `
  -d "{\"name\":\"beta-smoke-child-$env:SMOKE_SUFFIX\"}" | jq

$child

$env:CHILD_API_KEY = ($child | jq -r ".api_key")
$env:CHILD_KEY_ID = ($child | jq -r ".key_id")
```

Verify:

- Response is `201`.
- `owner_id` matches `$env:AGENT_ID`.
- All remaining authenticated steps in this runbook use `$env:CHILD_API_KEY`.

## Step 5: Create a Problem for the Smoke Skill

Goal: create the minimum registry setup required for skill submission.

```powershell
$problem = curl.exe -s `
  -X POST "$env:BASE_URL/problems" `
  -H "Content-Type: application/json" `
  -H "X-Api-Key: $env:CHILD_API_KEY" `
  -d "{
    \""name\"":\""Smoke Problem $env:SMOKE_SUFFIX\"",
    \""description\"":\""Return the sum of two integers.\"",
    \""difficulty\"":\""easy\"",
    \""domain\"":[\""arrays\""],
    \""tags\"":[\""beta-smoke\"","\""addition\""]
  }" | jq

$problem

$env:PROBLEM_ID = ($problem | jq -r ".problem.problem_id")
```

Verify:

- Response is `201`.
- `problem.problem_id` is a UUID.

## Step 6: Submit a New Skill

Goal: verify the authenticated registry write path with a complete beta-valid skill contract.

```powershell
$skill = curl.exe -s `
  -X POST "$env:BASE_URL/skills" `
  -H "Content-Type: application/json" `
  -H "X-Api-Key: $env:CHILD_API_KEY" `
  -d "{
    \""problem_id\"":\""$env:PROBLEM_ID\"",
    \""name\"":\""Sum Two Integers $env:SMOKE_SUFFIX\"",
    \""description\"":\""Return a + b in O(1) time and O(1) space.\"",
    \""language\"":\""typescript\"",
    \""domain\"":[\""arrays\""],
    \""tags\"":[\""beta-smoke\"","\""sum\""],
    \""inputs\"":[
      {\""name\"":\""a\"",\""type\"":\""number\""},
      {\""name\"":\""b\"",\""type\"":\""number\""}
    ],
    \""outputs\"":[
      {\""name\"":\""result\"",\""type\"":\""number\""}
    ],
    \""examples\"":[
      {\""input\"":{\""a\"":2,\""b\"":3},\""output\"":{\""result\"":5}}
    ],
    \""tests\"":[
      {\""input\"":{\""a\"":1,\""b\"":2},\""expected\"":{\""result\"":3}},
      {\""input\"":{\""a\"":-5,\""b\"":2},\""expected\"":{\""result\"":-3}}
    ],
    \""implementation\"":\""export function solve(a: number, b: number) { return { result: a + b }; }\""
  }" | jq

$skill

$env:SKILL_ID = ($skill | jq -r ".skill.skill_id")
```

Verify:

- Response is `201`.
- `skill.skill_id` is a UUID.
- `skill.is_canonical` is `false`.
- `skill.confidence` is `0`.

## Step 7: Verify Anonymous Intent Lookup

Goal: confirm the beta read/routing path works without authentication.

```powershell
$intent = curl.exe -s `
  -X POST "$env:BASE_URL/intent" `
  -H "Content-Type: application/json" `
  -d "{
    \""intent\"":\""sum two integers\"",
    \""language\"":\""typescript\"",
    \""tags\"":[\""beta-smoke\""]
  }" | jq

$intent
```

Verify:

- Response is `200`.
- `best_match.skill_id` is `$env:SKILL_ID`, or the skill appears in `matches`.
- The returned result is not archived.

If the newly submitted skill does not appear immediately, retry this step for up to 60 seconds before failing the smoke run. The runbook should record the observed delay.

## Step 8: Verify the MCP Read Path

Goal: confirm the MCP server can read the same skill through the beta resource surface.

Start the MCP server with the beta base URL. If your MCP client requires credentials globally, set the child key too:

```powershell
$env:CODEVOLVE_API_URL = $env:BASE_URL
$env:CODEVOLVE_API_KEY = $env:CHILD_API_KEY
```

Read this resource in an MCP client connected to the codeVolve server:

```text
codevolve://skills/<SKILL_ID>
```

Use the actual value of `$env:SKILL_ID`.

Verify:

- The resource read succeeds.
- The returned JSON contains the same `skill.skill_id` as the REST response from Step 6.
- The payload includes implementation, tests, and current validation fields.

This smoke path treats the MCP resource read as authoritative for `BETA-09`. Tool calls such as `get_skill` or `feedback_skill` are useful secondary checks, but the required read-path check is the resource URI above.

## Step 9: Submit Caller-Reported Feedback

Goal: verify the local-validation feedback path and the beta status transition.

```powershell
$validate = curl.exe -s `
  -X POST "$env:BASE_URL/validate/$env:SKILL_ID" `
  -H "Content-Type: application/json" `
  -H "X-Api-Key: $env:CHILD_API_KEY" `
  -d "{
    \""pass_count\"":2,
    \""fail_count\"":0,
    \""total_tests\"":2
  }" | jq

$validate
```

Verify:

- Response is `200`.
- `new_confidence` is `1`.
- `new_status` is `verified`.
- `fail_count` is `0`.

## Step 10: Promote the Skill to Canonical

Goal: verify the canonical-promotion happy path after successful validation.

```powershell
$promote = curl.exe -s `
  -X POST "$env:BASE_URL/skills/$env:SKILL_ID/promote-canonical" `
  -H "X-Api-Key: $env:CHILD_API_KEY" | jq

$promote
```

Verify:

- Response is `200`.
- `skill.skill_id` is `$env:SKILL_ID`.
- `skill.is_canonical` is `true`.
- `skill.status` remains `verified` or is `optimized`.

## Step 11: Final Readback

Goal: confirm the promoted state is visible on the public read path.

```powershell
curl.exe -s "$env:BASE_URL/skills/$env:SKILL_ID" | jq
```

Verify:

- Response is `200`.
- `skill.is_canonical` is `true`.
- `skill.status` is not `archived`.

## Pass Criteria

The smoke path passes only if all of the following are true:

- Anonymous `GET /` discovery succeeds.
- `POST /auth/register` returns a usable first API key.
- `GET /auth/keys` and `POST /auth/keys` succeed with the issued key.
- `POST /skills` succeeds with the child key.
- Anonymous `POST /intent` returns the submitted skill.
- MCP resource `codevolve://skills/{skill_id}` reads successfully.
- `POST /validate/{skill_id}` returns a passing verified state.
- `POST /skills/{id}/promote-canonical` succeeds and returns `is_canonical = true`.
- Public `GET /skills/{id}` reflects the promoted canonical state.

## Failure Recording

When this runbook is executed for real, record these fields alongside the result:

- Date and environment
- API base URL
- Problem ID
- Skill ID
- Agent ID
- Root key ID
- Child key ID
- Pass or fail per step
- Any retry needed for Step 7
- Exact response code and error body for the first failing step
