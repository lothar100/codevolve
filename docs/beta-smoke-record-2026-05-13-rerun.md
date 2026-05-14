# codeVolve Beta Smoke Record - May 13, 2026 Rerun

> Second execution record for `BETA-09` against the live beta deployment on the same date. This appends evidence rather than replacing the earlier failed run.

**Result:** `FAIL / NO-GO`  
**Date:** May 13, 2026  
**Run time:** approximately 7:07 PM America/New_York  
**Operator environment:** local PowerShell from the main repo workspace  
**Runbook used:** [docs/beta-smoke-path.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-path.md)

## Target

- Public docs/discovery URL from the runbook: `https://api.codevolve.dev/v1/`
- Reachable deployed API URL used for the live check: `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/`

## Summary

The smoke path was rerun on May 13, 2026 after the first failed attempt recorded earlier the same day.

The rerun did not change the outcome:

1. The public vanity API hostname is still not resolvable.
2. The discovery document served from the reachable execute-api deployment still advertises the broken vanity API and docs URLs.
3. The self-serve registration path is still broken in the same two-step pattern:
   - documented body shape using `name` fails validation because the live contract still requires `agent_name`
   - live-required body shape using `agent_name` still fails with `500 INTERNAL_ERROR`

Because registration still fails, the authenticated beta happy path remains blocked and later smoke steps were not executed.

## Step Record

| Step | Expected | Actual | Result |
|---|---|---|---|
| Vanity domain reachability | `https://api.codevolve.dev/v1/` resolves and serves discovery | DNS resolution failed: `Could not resolve host: api.codevolve.dev` | `FAIL` |
| Public docs URL reachability | `https://codevolve.dev/docs` resolves | DNS resolution failed: `Could not resolve host: codevolve.dev` | `FAIL` |
| `GET /` on reachable beta deployment | Discovery document returns `200` | `200 OK` from `https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/` | `PASS` |
| Discovery alignment | Discovery advertises reachable public onboarding URLs | Discovery still returns `base_url: "https://api.codevolve.dev/v1"` and `docs_url: "https://codevolve.dev/docs"` | `FAIL` |
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

### 2. Public vanity API domain failure

Request:

```powershell
curl.exe -sS -o NUL -w "%{http_code}" https://api.codevolve.dev/v1/
```

Observed:

- Curl could not resolve `api.codevolve.dev`
- No usable public discovery URL was available through the documented hostname

### 3. Public docs domain failure

Request:

```powershell
curl.exe -sS -I https://codevolve.dev/docs
```

Observed:

- Curl could not resolve `codevolve.dev`
- The docs URL advertised in discovery is not currently reachable from the test environment

### 4. Registration drift still present

Attempt A used the runbook body:

```json
{ "name": "beta-smoke-root-20260513-190712" }
```

Observed:

- `400`
- `{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":{"agent_name":["Required"]}}}`

Attempt B used the live-required body:

```json
{ "agent_name": "beta-smoke-root-20260513-190712" }
```

Observed:

- `500`
- `{"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}`

## What This Means

- `BETA-09` remains blocked as of May 13, 2026.
- The rerun confirms there was no operational recovery between the first run and this second check.
- The launch checklist items for auth path, docs and discovery alignment, public URL target, and end-to-end smoke path remain `FAIL`.

## Immediate Follow-Ups

1. Restore or replace the public API vanity domain used in discovery and docs.
2. Restore or replace the public docs domain returned by discovery.
3. Fix `POST /auth/register` on the deployed beta environment.
4. Re-run the full smoke path only after those deployment issues are addressed.
