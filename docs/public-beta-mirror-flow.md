# codeVolve Mirrored Public Beta Flow

> Purpose: `BETA-20` controlled rehearsal artifact for the intended public-beta onboarding flow. This is not public launch copy. It is a non-public mirror script used to test whether a fresh agent operator can move from first-contact copy to feedback submission without guessing.

## What This Covers

This mirror flow tests the beta path in the same order an external reader should experience it:

`launch post copy -> docs/discovery landing -> API key/auth instructions -> MCP/API quickstart -> one feedback path`

It is narrower than [docs/beta-smoke-path.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-path.md). The smoke path proves the full product happy path. This mirror flow proves the onboarding and conversion path before anything is posted publicly.

## Scope Rules

- Run this in a controlled non-public channel only.
- Do not post this copy to Moltbook or any public feed.
- Evaluate the current beta product model only:
  `exact lookup or intent -> skill summary -> implementation fetch if needed -> local execution -> feedback`
- Fail the run if any step implies hosted execution, hosted validation, Cognito onboarding, IAM credentials, or a required web UI.

## Roles

- `Operator`: the person staging the rehearsal and capturing evidence.
- `Fresh reader`: a teammate or test agent who has not been briefed beyond the launch-copy snippet in Step 1.
- `Recorder`: optional second observer who notes friction and timestamps.

One human may play multiple roles, but the `fresh reader` should behave as if they just encountered the launch post for the first time.

## Preconditions

- You have a current beta API base URL.
- You have a current docs/discovery landing URL.
- You have a controlled place to paste the mirrored launch copy: local note, private chat, draft doc, or internal thread.
- You have `curl` and `jq` available.
- You can run an MCP client locally if you want to verify the MCP quickstart path directly.
- You are prepared to issue or use one beta API key during the rehearsal.

Set these once before starting:

```powershell
$env:BASE_URL = "https://api.codevolve.dev/v1"
$env:DOCS_URL = "https://codevolve.dev/docs"
$env:MIRROR_SUFFIX = (Get-Date -Format "yyyyMMdd-HHmmss")
```

## Controlled Launch Copy

Use this exact non-public mirror copy for the rehearsal unless there is a newer approved launch draft:

> codeVolve is a registry and routing layer for programming skills built for AI agents.  
> Start with intent routing or direct lookup, inspect the skill, run it locally in your own environment, and send feedback back to the registry.  
> Public beta uses API keys for authenticated writes. You do not need Cognito, IAM credentials, or a hosted dashboard to try the core flow.  
> Start here: docs/discovery first, then API or MCP quickstart, then run one local feedback cycle.

The operator should place this copy in the controlled rehearsal surface and give the fresh reader only the landing link that would accompany it publicly.

## Execution Record

Record one row per step in [docs/public-beta-mirror-evidence-template.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-mirror-evidence-template.md) while you run the script.

Use:

- `PASS`: step completed without operator rescue
- `SOFT FAIL`: step completed only after clarification, retry, or guesswork
- `FAIL`: step could not be completed or contradicted the beta contract

## Step 1: First-Contact Copy Check

Goal: prove the launch-copy snippet points the reader toward the correct mental model before they touch the API.

Action:

1. Show the fresh reader only the controlled launch copy above.
2. Ask them to answer these questions in one sentence each, without opening any docs yet:
   - What is codeVolve?
   - Does codeVolve run the code for you?
   - What auth is needed for the first meaningful write?
   - What should you try first: UI, docs/discovery, MCP, or API?

Pass when:

- They describe codeVolve as a registry and routing surface for agent-use code.
- They say execution is local, not server-hosted.
- They identify API keys as the onboarding auth for writes.
- They choose docs/discovery first, then API or MCP.

Fail when:

- They infer hosted execution or hosted validation.
- They think the dashboard web UI is required.
- They think Cognito or IAM is the starting auth mechanism.

## Step 2: Docs or Discovery Landing Check

Goal: prove the link behind the launch copy lands on a page that explains the beta model cleanly.

Action:

1. Send the fresh reader to the chosen landing surface:
   - preferred: public docs URL
   - fallback: `GET /` discovery output if the docs page is unavailable
2. Ask them to find, without operator hints:
   - the canonical routing endpoint
   - the local-execution statement
   - the validation/feedback statement
   - the write-auth model

Suggested direct checks:

```powershell
curl.exe -s "$env:BASE_URL/" | jq
```

Pass when:

- They can identify `POST /intent` as the routing entry point.
- They can find wording that execution is caller-owned and local.
- They can find wording that `POST /validate/:skill_id` is feedback-style validation.
- They can find that API-key auth is used for writes.

Fail when:

- The landing surface still implies `/resolve` is primary.
- The landing surface implies hosted execution, server-side validation, or public cache behavior.
- The auth story is ambiguous enough that the reader asks whether Cognito or IAM is required.

## Step 3: API Key / Auth Instruction Check

Goal: prove a fresh reader can understand how to get and use a beta key.

Action:

1. Ask the fresh reader to locate the auth instructions from the landing surface.
2. Have them explain the difference between read access and write access in beta.
3. Have them identify the first authenticated action needed for the flow.
4. Then run the minimal key path:

```powershell
$register = curl.exe -s `
  -X POST "$env:BASE_URL/auth/register" `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"beta-mirror-root-$env:MIRROR_SUFFIX\"}" | jq

$register

$env:ROOT_API_KEY = ($register | jq -r ".api_key")
$env:ROOT_KEY_ID = ($register | jq -r ".key_id")
```

Optional follow-up if self-service key management is part of the instruction path:

```powershell
$child = curl.exe -s `
  -X POST "$env:BASE_URL/auth/keys" `
  -H "Content-Type: application/json" `
  -H "X-Api-Key: $env:ROOT_API_KEY" `
  -d "{\"name\":\"beta-mirror-child-$env:MIRROR_SUFFIX\"}" | jq

$child

$env:CHILD_API_KEY = ($child | jq -r ".api_key")
```

Pass when:

- The reader correctly states that reads can be unauthenticated but writes require an API key.
- They do not reach for Cognito or IAM.
- The register call succeeds and yields one usable `cvk_...` key.
- If the child-key path is tested, it succeeds without needing a second auth mechanism.

Fail when:

- The docs force the operator to explain the auth model manually.
- The reader cannot tell which endpoints require the key.
- The API key issuance instructions are missing, contradictory, or broken.

## Step 4: API Quickstart Check

Goal: prove the landing material gives the reader enough to perform one minimal API-driven local workflow.

Action:

1. Ask the fresh reader to identify the shortest plausible API path to try codeVolve.
2. Use that path to do one anonymous route/read and one authenticated feedback write.
3. For the mirror flow, use an existing skill if available; otherwise use the fresh skill path from the smoke runbook.

Minimum anonymous route/read example:

```powershell
curl.exe -s `
  -X POST "$env:BASE_URL/intent" `
  -H "Content-Type: application/json" `
  -d "{\"intent\":\"sum two integers\",\"language\":\"typescript\"}" | jq
```

Pass when:

- The reader can identify a valid first API call from the docs/discovery surface.
- They understand that they fetch or route first, then run locally.
- They do not expect `/execute` to run the skill for them.

Fail when:

- The quickstart path depends on unstated setup.
- The reader mistakes telemetry endpoints for execution endpoints.
- The docs omit the distinction between routing/read surfaces and authenticated feedback writes.

## Step 5: MCP Quickstart Check

Goal: prove the beta onboarding story can also be followed from MCP without implying hosted execution.

Action:

1. Ask the fresh reader to find the MCP entry point from the docs or linked instructions.
2. Set:

```powershell
$env:CODEVOLVE_API_URL = $env:BASE_URL
$env:CODEVOLVE_API_KEY = if ($env:CHILD_API_KEY) { $env:CHILD_API_KEY } else { $env:ROOT_API_KEY }
```

3. In the MCP client, verify one routing/read action and one feedback-oriented action description:
   - route with `resolve_skill`
   - fetch with `get_skill` or `codevolve://skills/{skill_id}`
   - confirm that `feedback_skill` is described as local test feedback, not hosted validation

Pass when:

- The reader can discover the MCP flow without being told to use a hidden internal tool.
- MCP wording matches the beta model: route, fetch, run locally, report feedback.
- `validate_skill` is clearly optional compatibility language rather than the preferred concept.

Fail when:

- MCP wording suggests hosted execution or remote verification.
- The reader cannot tell which MCP tool to use first.
- The MCP path requires unstated manual translation from the REST docs.

## Step 6: One Feedback Path Check

Goal: prove the mirror onboarding path reaches one real caller-reported feedback write.

Action:

1. Choose one skill from the API quickstart or MCP quickstart path.
2. Run the skill locally in a controlled way.
3. Submit one feedback report with aggregate counts:

```powershell
curl.exe -s `
  -X POST "$env:BASE_URL/validate/$env:SKILL_ID" `
  -H "Content-Type: application/json" `
  -H "X-Api-Key: $env:CHILD_API_KEY" `
  -d "{\"pass_count\":2,\"fail_count\":0,\"total_tests\":2}" | jq
```

Pass when:

- The reader understands that they are reporting local results, not asking the server to run tests.
- The request succeeds with `200`.
- The response returns the updated `new_confidence`, `new_status`, and compatibility aliases if present.

Fail when:

- The reader expects to upload code for remote execution.
- The docs lead them to send per-test runner payloads the beta contract no longer documents.
- The API returns an auth or contract error caused by unclear onboarding instructions.

## Step 7: Mirror Conversion Verdict

Goal: conclude whether the mirrored public-beta flow converts a fresh reader into one successful feedback action.

Action:

1. Ask the fresh reader whether they would continue without a live operator present.
2. Record:
   - the first point of confusion
   - any operator rescue needed
   - whether the docs/discovery path felt linear
   - whether API or MCP felt like the clearer first run

Pass when:

- All critical steps above are `PASS`.
- No operator rescue was needed on the auth model or local-execution model.
- The reader reaches one successful feedback write in a single sitting.

Fail when:

- The flow required product knowledge not present in the docs/discovery surface.
- The reader finished but only after multiple clarifications.
- The reader still cannot explain the core beta model after completing the path.

## Required Output

After each rehearsal, store the completed evidence in:

- [docs/public-beta-mirror-evidence-template.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-mirror-evidence-template.md)

At minimum, capture:

- date and environment
- launch-copy variant used
- landing URL used
- API base URL
- whether the reader chose API or MCP first
- one row of evidence for every step
- overall verdict: `PASS`, `SOFT FAIL`, or `FAIL`
- follow-up gaps to fix before any public share

## Decision Rule

Do not treat `BETA-20` as complete just because this document exists. `BETA-20` is complete only after:

1. this script is executed end to end in a controlled setting
2. the evidence template is filled out
3. the observed gaps are fed back into docs, onboarding, or launch-copy changes
4. a second run no longer requires operator rescue on the core beta model
