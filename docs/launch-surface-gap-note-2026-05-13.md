# Launch-Surface Gap Note

> Date: May 13, 2026  
> Purpose: short support note for `BETA-19`, `BETA-20`, and `BETA-06` after the live smoke rerun and the now-passing mirrored public-beta rehearsal on the same date.

## Current Public Story

The public-facing beta story now holds up for both the REST and MCP onboarding paths:

- [docs/api.md](/C:/Users/pgl49/source/repos/codevolve/docs/api.md) presents the live shared AWS API URL as the beta base URL and includes an MCP quickstart.
- [src/registry/discovery.ts](/C:/Users/pgl49/source/repos/codevolve/src/registry/discovery.ts) derives the same live onboarding URL at runtime and now exposes MCP bootstrap guidance directly in the discovery payload.
- [docs/beta-smoke-path.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-path.md) has already been proven live by the passing smoke rerun in [docs/beta-smoke-record-2026-05-13-rerun-3.md](/C:/Users/pgl49/source/repos/codevolve/docs/beta-smoke-record-2026-05-13-rerun-3.md).

The earlier launch-surface blockers around vanity URLs and `POST /auth/register` are closed with dated evidence.

## Current Evidence

The mirrored public-beta rehearsal now has both the initial failure record and the confirming no-rescue pass:

- first run: [docs/public-beta-mirror-record-2026-05-13.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-mirror-record-2026-05-13.md)
- confirming rerun: [docs/public-beta-mirror-record-2026-05-13-rerun.md](/C:/Users/pgl49/source/repos/codevolve/docs/public-beta-mirror-record-2026-05-13-rerun.md)

What the rerun proved:

- discovery is reachable at the launch URL and now includes MCP bootstrap guidance directly
- API-key bootstrap via `POST /auth/register` still works
- child-key issuance still works
- route/read-first API workflow still works
- the documented MCP package path now uses `X-Api-Key` correctly for write actions
- MCP resolve, read, and feedback steps succeed against the live API with no operator rescue

## Remaining Gap

### Launch-copy rewrite only

The launch-surface gap that blocked `BETA-20` is now closed. The remaining launch-facing work is no longer product onboarding proof; it is public copy polish for `BETA-06`.

What still matters:

- `BETA-06` should describe the now-proven path clearly and compactly
- launch copy should continue to avoid implying a hosted UI or hosted execution model

## What BETA-06 Should Avoid Claiming

Launch copy should still avoid implying:

- a hosted runner or hosted validation model
- that the dashboard web UI is required to use the beta

## Bottom Line

The launch-surface blockers found earlier on May 13, 2026 are now closed with dated evidence. The real onboarding URL works, self-serve auth works, discovery exposes the MCP bootstrap directly, and the mirrored API plus MCP path reaches a real feedback write with no operator rescue. The next launch-facing task is `BETA-06`, not another onboarding proof pass.
