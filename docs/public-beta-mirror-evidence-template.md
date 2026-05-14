# codeVolve Mirrored Public Beta Flow Evidence Template

> Fill this out while running [docs/public-beta-mirror-flow.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-mirror-flow.md).

## Run Metadata

| Field | Value |
|---|---|
| Run date | |
| Environment | |
| Operator | |
| Fresh reader | |
| Recorder | |
| API base URL | |
| Landing URL used | |
| Launch-copy variant | default mirrored copy / revised copy / other |
| First path chosen by reader | API / MCP |
| Root key issued | yes / no |
| Child key issued | yes / no |
| Skill ID used for feedback step | |
| Overall verdict | PASS / SOFT FAIL / FAIL |

## Step Record

| Step | Goal | Result | Evidence | Rescue needed | Notes |
|---|---|---|---|---|---|
| 1 | First-contact copy sets the correct mental model | PASS / SOFT FAIL / FAIL | | yes / no | |
| 2 | Docs or discovery landing explains intent, local execution, feedback, and auth | PASS / SOFT FAIL / FAIL | | yes / no | |
| 3 | API-key auth instructions are understandable and usable | PASS / SOFT FAIL / FAIL | | yes / no | |
| 4 | API quickstart leads to a valid route/read-first workflow | PASS / SOFT FAIL / FAIL | | yes / no | |
| 5 | MCP quickstart mirrors the same beta model clearly | PASS / SOFT FAIL / FAIL | | yes / no | |
| 6 | One caller-reported feedback write succeeds | PASS / SOFT FAIL / FAIL | | yes / no | |
| 7 | Reader would continue without operator intervention | PASS / SOFT FAIL / FAIL | | yes / no | |

## Exact Friction Points

| Order seen | Location | What confused the reader | Why it matters | Proposed fix |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

## Contract Checks

Mark each item based on what the reader actually inferred during the run.

| Statement | Pass? | Notes |
|---|---|---|
| Reader understood `POST /intent` is the primary routing entry point | yes / no | |
| Reader understood execution is local, not hosted by codeVolve | yes / no | |
| Reader understood `POST /validate/:skill_id` is feedback-style validation | yes / no | |
| Reader understood API keys are required for writes | yes / no | |
| Reader did not assume Cognito or IAM was required for beta onboarding | yes / no | |
| Reader did not assume the dashboard web UI was required | yes / no | |

## Evidence Snippets

Paste or summarize the minimum evidence needed to audit the run later.

### Step 1 Reader Summary

```text
```

### Step 2 Landing Proof

```text
```

### Step 3 Auth Output

```text
```

### Step 4 API Quickstart Output

```text
```

### Step 5 MCP Proof

```text
```

### Step 6 Feedback Response

```json
```

## Final Assessment

### Should this flow be safe to mirror publicly after launch-copy cleanup?

`yes / no`

### What must change before that is true?

1. 
2. 
3. 

### Follow-up owners

| Gap | Owner | Target task |
|---|---|---|
| | | |
| | | |
| | | |
