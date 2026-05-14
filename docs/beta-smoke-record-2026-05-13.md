# codeVolve Beta Smoke Record - May 13, 2026

> Execution record for `BETA-09` against the live beta deployment.

**Result:** `FAIL / NO-GO`  
**Date:** May 13, 2026  
**Operator environment:** local PowerShell from the main repo workspace  
**Runbook used:** [docs/beta-smoke-path.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-path.md)

## Target

- Public docs/discovery URL from the runbook: `https://api.codevolve.dev/v1/`
- Reachable deployed API URL used for the live check: `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/`

## Summary

The smoke path was executed for real on May 13, 2026. It did not pass.

Two launch-blocking issues were confirmed before the happy path could complete:

1. The public API vanity domain in the docs and discovery contract is not reachable from the test environment.
2. The self-serve external auth onboarding path is not working on the live deployment.

Because public beta requires both a working public URL and a working unauthenticated registration flow, this run is an operational `NO-GO`.

## Step Record

| Step | Expected | Actual | Result |
|---|---|---|---|
| Vanity domain reachability | `https://api.codevolve.dev/v1/` resolves and serves discovery | DNS resolution failed: `Could not resolve host: api.codevolve.dev` | `FAIL` |
| `GET /` on reachable beta deployment | Discovery document returns `200` | `200 OK` from `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/` | `PASS` |
| `POST /auth/register` using documented field | Request succeeds with first API key | `400 VALIDATION_ERROR`; body says `agent_name` is required | `FAIL` |
| `POST /auth/register` using live-required field | Request succeeds with first API key | `500 INTERNAL_ERROR`; body says `An unexpected error occurred` | `FAIL` |

The smoke run stopped at registration. Later steps were not executed because the public beta happy path depends on self-serve auth creation.

## Evidence

### 1. Reachable discovery on execute-api URL

Request:

```powershell
curl.exe -sS -D - https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/
```

Observed:

- `HTTP/1.1 200 OK`
- Discovery response still advertises `base_url: "https://api.codevolve.dev/v1"`
- Discovery response still describes `POST /auth/register` as the entry point for a first API key

### 2. Public vanity domain failure

Request:

```powershell
curl.exe -sS -o NUL -w "%{http_code}" https://api.codevolve.dev/v1/
```

Observed:

- Curl could not resolve `api.codevolve.dev`
- No usable public discovery URL was available through the documented hostname

### 3. Registration drift against the documented contract

Attempt A used the runbook body:

```json
{ "name": "beta-smoke-root-..." }
```

Observed:

- `400`
- `{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":{"agent_name":["Required"]}}}`

Attempt B used the live-required body:

```json
{ "agent_name": "beta-smoke-root-..." }
```

Observed:

- `500`
- `{"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}`

## What This Means

- `BETA-09` is now evidenced, not speculative.
- The public beta gate remains closed.
- The launch checklist items for auth path, end-to-end smoke path, and public URL target are currently `FAIL`.

## Immediate Follow-Ups

1. Fix or replace the public API vanity domain used in docs and discovery.
2. Fix `POST /auth/register` on the deployed beta environment.
3. Re-run the same smoke path after deploy and append a second dated record instead of overwriting this one.
