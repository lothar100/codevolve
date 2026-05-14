# codeVolve Beta Smoke Record - May 13, 2026 Rerun 2

> Third execution record for `BETA-09` against the live beta deployment on the same date. This appends evidence rather than replacing earlier failed runs.

**Result:** `FAIL / NO-GO`  
**Date:** May 13, 2026  
**Run time:** approximately 7:12 PM America/New_York  
**Operator environment:** local PowerShell from the main repo workspace  
**Runbook used:** [docs/beta-smoke-path.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-path.md)

## Target

- Shared deployed API URL used for the live check: `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/`
- Discovery-advertised API URL: `https://api.codevolve.dev/v1/`

## Summary

The smoke path was rerun again on May 13, 2026 against the deployed execute-api endpoint.

The outcome is unchanged:

1. The deployed discovery endpoint is reachable and still advertises vanity API/docs URLs that are intentionally unprovisioned.
2. The advertised vanity API URL still does not resolve.
3. The self-serve registration path is still broken in the same two-step pattern:
   - documented body shape using `name` fails validation because the live contract still requires `agent_name`
   - live-required body shape using `agent_name` still fails with `500 INTERNAL_ERROR`

Because registration still fails on the deployed service, the authenticated beta happy path remains blocked and later smoke steps were not executed.

## Step Record

| Step | Expected | Actual | Result |
|---|---|---|---|
| `GET /` on reachable beta deployment | Discovery document returns `200` | `200 OK` from `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/` | `PASS` |
| Discovery alignment | Discovery advertises the real shared onboarding URL | Discovery still returns `base_url: "https://api.codevolve.dev/v1"` and `docs_url: "https://codevolve.dev/docs"` | `FAIL` |
| Discovery-advertised API URL reachability | `https://api.codevolve.dev/v1/` resolves and serves discovery | DNS resolution failed: `Could not resolve host: api.codevolve.dev` | `FAIL` |
| `POST /auth/register` using documented field | Request succeeds with first API key | `400 VALIDATION_ERROR`; body says `agent_name` is required | `FAIL` |
| `POST /auth/register` using live-required field | Request succeeds with first API key | `500 INTERNAL_ERROR`; body says `An unexpected error occurred` | `FAIL` |

The smoke run stopped at registration. Later steps were not executed because the beta happy path still depends on self-serve external auth creation.

## Evidence

### 1. Reachable discovery on execute-api URL

Request:

```powershell
curl.exe -sS -D - https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/
```

Observed:

- `HTTP/1.1 200 OK`
- Discovery still advertises `base_url: "https://api.codevolve.dev/v1"`
- Discovery still advertises `docs_url: "https://codevolve.dev/docs"`
- Discovery still describes `POST /auth/register` as the entry point for a first API key

### 2. Discovery-advertised API URL failure

Request:

```powershell
curl.exe -sS -o NUL -w "%{http_code}" https://api.codevolve.dev/v1/
```

Observed:

- Curl could not resolve `api.codevolve.dev`
- The discovery payload still names a URL that is not a valid onboarding surface

### 3. Registration drift still present on the deployed environment

Attempt A used the runbook body:

```json
{ "name": "beta-smoke-root-20260513-191250" }
```

Observed:

- `400`
- `{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":{"agent_name":["Required"]}}}`

Attempt B used the live-required body:

```json
{ "agent_name": "beta-smoke-root-20260513-191250" }
```

Observed:

- `500`
- `{"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}`

## What This Means

- `BETA-09` remains blocked as of May 13, 2026.
- The repeated rerun confirms the live failure is still on the deployed auth path, not just in earlier operator input.
- The next useful rerun should wait for a deploy that fixes `POST /auth/register` and updates discovery to a real reachable onboarding URL.
