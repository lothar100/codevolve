# codeVolve — Archive Policy

> Maintained by Quimby. Defined by Amber (DESIGN-03), reviewed by Jorven.

---

## Principles (established)

- Archive is never deletion. Records are preserved with `status: "archived"`.
- Archived skills are excluded from `/resolve` routing and OpenSearch index.
- Archived problems are hidden from the mountain visualization by default (toggleable).
- ClickHouse/BigQuery analytics events for archived skills are never deleted.
- All archive decisions are reversible via `POST /skills/:id/unarchive`.
- Archive evaluation runs every 24 hours via the Decision Engine Lambda.

---

## 1. Metric Thresholds

This section defines the exact threshold for each archive trigger specified in ARCH-03. Every threshold is stored as a configuration entry in the `codevolve-config` DynamoDB table and can be updated without a code deployment.

### 1.1 Staleness — last execution > 90 days

| Parameter | Value |
|-----------|-------|
| Metric | Days since last `event_type = 'execute'` for the skill |
| Threshold | > 90 days |
| Configurable | Yes (`archive.staleness_days`, default 90) |

**Rationale.** 90 days (one fiscal quarter) balances two concerns: it is long enough that genuinely useful skills with infrequent but real demand are unlikely to be caught, yet short enough that the registry does not accumulate dead weight. A 30-day threshold would be too aggressive — many skills serve niche domains with monthly-or-less usage. A 180-day threshold would leave clearly abandoned skills polluting `/resolve` results for half a year.

**Seasonal skills.** Some skills have legitimate annual usage patterns (tax calculation, academic grading, holiday logistics). These are handled by the **seasonal tag exemption** (see Section 3.3) rather than by inflating the staleness window for all skills. Skills tagged with `seasonal` receive a staleness threshold of **365 days** instead of 90.

**Edge case — new skills.** A skill created fewer than 90 days ago cannot trigger the staleness condition regardless of execution history, because the grace period (Section 3.1) exempts it from evaluation entirely.

### 1.2 Low confidence — confidence < 0.3

| Parameter | Value |
|-----------|-------|
| Metric | `confidence` field on the Skill DynamoDB record |
| Threshold | < 0.3 |
| Configurable | Yes (`archive.low_confidence_threshold`, default 0.3) |

**Rationale.** The confidence score ranges from 0.0 to 1.0. Skills below 0.7 already trigger the `/evolve` pipeline for improvement. The archive threshold at 0.3 sits well below the evolution trigger, giving `/evolve` ample room to operate. A skill at 0.3 has failed roughly 70% of its test suite or has consistently poor real-world outcomes — it is actively harmful to serve it via `/resolve`. Setting the threshold any lower (e.g., 0.1) would leave dangerously unreliable skills in the active pool.

**Skills that just need more validation.** A skill with few executions may have a misleadingly low confidence score due to small sample size. To address this: the low-confidence trigger only applies to skills with **at least 5 lifetime executions**. Skills with fewer than 5 executions are not eligible for archive via this trigger; they may still be archived via the zero-usage or staleness triggers if those conditions are met.

**Edge case — confidence recovering.** If a skill's confidence drops below 0.3 but then recovers above 0.3 before the next evaluation cycle, it will not be archived. The evaluation reads the confidence value at evaluation time, not historical minimums.

### 1.3 High failure rate — > 80% over 30 days, minimum 10 executions

| Parameter | Value |
|-----------|-------|
| Metric | `COUNT(success=false) / COUNT(*)` for `event_type = 'execute'` in the last 30 days |
| Threshold | > 80% failure rate AND >= 10 executions in the window |
| Configurable | Yes (`archive.failure_rate_threshold` default 0.80, `archive.failure_rate_window_days` default 30, `archive.failure_rate_min_executions` default 10) |

**Rationale.** An 80% failure rate over 30 days with at least 10 executions is strong statistical evidence that a skill is broken, not merely experiencing transient issues. The 10-execution minimum prevents a skill that ran twice and failed both times from being archived on insufficient data. The 30-day window is long enough to smooth out temporary infrastructure failures (e.g., a bad deployment causing a spike of failures over a weekend) but short enough that a genuinely broken skill does not persist for months.

**Why 80% and not lower?** A skill with a 50% failure rate is unreliable but may still be under active improvement by `/evolve`. The `/evolve` pipeline is triggered at 70% confidence (roughly 30% failure rate). Setting the archive threshold at 80% failure ensures the `/evolve` pipeline has had meaningful opportunity to intervene before archival occurs. If `/evolve` cannot fix the skill within the 30-day window while failures remain above 80%, the skill should be archived.

**Why a minimum of 10 executions?** At fewer than 10 data points, the failure rate is dominated by noise. A skill executed 3 times with 3 failures (100% rate) may simply have encountered bad inputs or a transient bug. 10 executions provides a minimum viable sample.

### 1.4 Zero usage — 0 lifetime executions AND age > 60 days

| Parameter | Value |
|-----------|-------|
| Metric | Lifetime `COUNT(*) WHERE event_type = 'execute'` = 0, combined with `created_at` age |
| Threshold | 0 executions AND skill age > 60 days |
| Configurable | Yes (`archive.zero_usage_age_days`, default 60) |

**Rationale.** A skill that has existed for 60 days without a single execution is almost certainly not useful. It was either created speculatively (e.g., by a seed batch or `/evolve` pipeline) and never matched any real intent, or it duplicates another skill that gets all the traffic. The 60-day window is shorter than the 90-day staleness window because there is a meaningful difference between "was used once 91 days ago" (may still have value) and "was never used at all" (almost certainly has none).

**Why 60 days and not 30?** New skills need time to be discovered. After creation, a skill must be embedded and indexed in OpenSearch before `/resolve` can route to it. Additionally, the intent that would match this skill may not arrive frequently. 60 days provides a generous discovery window.

---

## 2. Evaluation Cadence

### 2.1 Primary cadence — every 24 hours

All archive triggers are evaluated on a single 24-hour cadence. The Decision Engine Lambda runs on a 5-minute EventBridge schedule for its other duties (auto-cache, optimization flags, gap detection); archive evaluation is gated by a `last_archive_evaluation` timestamp in DynamoDB and runs only when 24 hours have elapsed.

**Why 24 hours?** Archive decisions are not urgent. A skill that qualifies for archival today will still qualify tomorrow. Running more frequently (e.g., hourly) would increase ClickHouse query load without meaningful benefit — the underlying metrics (90-day staleness, 30-day failure window) change slowly. Running less frequently (e.g., weekly) would allow broken skills to serve bad results for too long.

**Should different thresholds have different cadences?** No, and here is why. The high-failure-rate trigger might seem to benefit from more frequent evaluation (broken skills are actively harmful), but the 30-day window and 10-execution minimum already smooth out transient issues. Running the failure-rate check every hour would produce the same result as every 24 hours because the underlying 30-day window barely shifts in an hour. The simplicity of a single cadence outweighs the marginal benefit of per-trigger cadences.

### 2.2 Evaluation time

The archive evaluation should run during **off-peak hours**: **04:00 UTC** (approximately 00:00 US Eastern). The Decision Engine achieves this by setting the initial `last_archive_evaluation` timestamp to 04:00 UTC on the deployment date. Subsequent evaluations then naturally occur near 04:00 UTC each day (with minor drift from the 5-minute EventBridge schedule; maximum drift is 5 minutes per day, corrected by snapping the stored timestamp to the nearest 04:00 UTC after each run).

**Why 04:00 UTC?** This avoids peak hours for both US and European users. ClickHouse query load from the evaluation (scanning all active skills) is non-trivial and should not compete with dashboard queries during business hours.

### 2.3 Delayed or skipped evaluation

If the Decision Engine Lambda fails or is delayed (e.g., due to a deployment, throttling, or infrastructure issue):

- **Delayed by < 24 hours.** The next successful invocation detects that > 24 hours have passed and runs the evaluation immediately. No data is lost — the evaluation reads current metrics.
- **Delayed by > 24 hours (multiple missed cycles).** Same behavior: the evaluation runs once on the next successful invocation. Missed cycles are not "caught up" — there is no backfill. This is acceptable because archive thresholds are based on absolute time windows (90 days, 30 days, 60 days), not on the cadence itself.
- **Monitoring.** A CloudWatch alarm fires if no archive evaluation has completed in **36 hours** (50% grace beyond the 24-hour cadence). This gives the operations team time to investigate before the gap grows large.

---

## 3. Edge Cases

### 3.1 Newly created skills — grace period

**Rule: skills younger than 30 days are exempt from all archive evaluation.**

A newly created skill needs time to be indexed, discovered via `/resolve`, and executed. Evaluating it against staleness or zero-usage thresholds during its first weeks would create false positives. The 30-day grace period begins at `created_at` and applies to all four archive triggers.

| Threshold | Grace period | Reasoning |
|-----------|-------------|-----------|
| Staleness (90 days) | 30 days | Cannot possibly be stale at < 30 days |
| Low confidence (< 0.3) | 30 days | Confidence may not yet reflect real-world performance |
| High failure rate (> 80%) | 30 days | Early failures may be due to test-suite issues, not skill quality |
| Zero usage (60 days) | 30 days (redundant — 60-day age threshold already covers this) | Explicit exemption for clarity |

Configuration: `archive.grace_period_days`, default 30.

### 3.2 Skills currently being improved by /evolve

**Rule: skills with an active `/evolve` job are exempt from archive evaluation.**

The `/evolve` pipeline sets an `evolve_in_progress` flag on the skill record when it begins work and clears it on completion (with a TTL fallback of 24 hours). The Decision Engine skips any skill where `evolve_in_progress` is true.

Rationale: archiving a skill that is actively being improved defeats the purpose of the feedback loop. The `/evolve` pipeline may be about to upload a new implementation that fixes the failing tests or raises confidence.

### 3.3 Skills in domains with naturally low usage

**Rule: domain-specific staleness overrides are supported via the configuration table.**

Some domains (e.g., `tax`, `academic`, `regulatory-compliance`) have inherently low or seasonal usage. Rather than inflating the global staleness threshold, operators can set per-domain overrides:

```
archive.staleness_days.domain.tax = 365
archive.staleness_days.domain.academic = 180
```

Additionally, any skill tagged with `seasonal` receives the longest configured staleness threshold (default: 365 days). The tag can be applied manually or by the Decision Engine when it detects a skill with a clear annual usage pattern (executed in the same 30-day window each year for at least two consecutive years).

### 3.4 Seasonal skills

Handled by the `seasonal` tag mechanism described in Section 3.3. When a skill is tagged `seasonal`:

- Staleness threshold becomes 365 days (configurable: `archive.staleness_days.seasonal`, default 365).
- All other thresholds (low confidence, high failure rate, zero usage) remain unchanged — a seasonal skill that is broken is still broken regardless of its usage cadence.

**Automatic seasonal detection.** The Decision Engine can flag skills as seasonal candidates when:
- The skill has been executed at least twice.
- All executions fall within the same 60-day calendar window across different years.
- The skill has no executions outside that window.

Flagged skills appear in the Evolution/Gap dashboard for operator review. The `seasonal` tag is not applied automatically — an operator must confirm it.

### 3.5 High execution count but recent confidence drop

**Rule: this is not an edge case — it triggers archival normally.**

A skill that was historically popular but now has confidence below 0.3 is actively serving bad results to many consumers. High historical execution count does not override current quality metrics. In fact, a popular skill with low confidence is *more* dangerous than an obscure one, because it affects more consumers.

However, the Decision Engine emits a **high-impact archive warning** event to the Evolution/Gap dashboard when a skill with lifetime execution count > 100 is flagged for archival. This alerts operators that a widely-used skill is about to be archived and may need urgent attention from the `/evolve` pipeline.

### 3.6 Recently unarchived skills — anti-thrashing protection

**Rule: a skill that has been unarchived receives a 14-day cool-down period before it is eligible for archive evaluation again.**

Without this protection, a skill could be unarchived (manually or via API), immediately re-evaluated on the next cycle, and re-archived because the underlying metrics have not had time to change. The cool-down is tracked via the `unarchived_at` timestamp field set during the unarchive operation.

Configuration: `archive.unarchive_cooldown_days`, default 14.

During the cool-down period, the skill is fully active (appears in `/resolve`, can be executed, etc.) but is invisible to the archive evaluation logic.

---

## 4. Reversal Conditions

### 4.1 Automatic unarchival

**The Decision Engine does not automatically unarchive skills.** All unarchive operations are initiated manually via `POST /skills/:id/unarchive`. This is a deliberate design choice: archival removes the skill's embedding and cache entries, so restoration has a real cost (embedding regeneration via Bedrock). Automatic unarchival could create oscillation where skills are archived and unarchived repeatedly.

**Future consideration.** If analytics show that a significant number of `/resolve` intents fail to find a match and the best historical match was an archived skill, the Decision Engine could be extended to recommend unarchival candidates in the Evolution/Gap dashboard. This would still require operator confirmation rather than automatic action.

### 4.2 Manual unarchive via API

`POST /skills/:id/unarchive` is unrestricted — any authenticated API caller can unarchive any skill. There are no restrictions beyond:

- The skill must currently have `status: "archived"`.
- The unarchive operation triggers embedding regeneration, which takes 1-3 seconds (Bedrock Titan v2 latency).
- The 14-day anti-thrashing cool-down (Section 3.6) begins immediately.

**Rate limiting.** The unarchive endpoint is rate-limited to **20 requests per minute** per API caller to prevent bulk unarchive operations from overwhelming the Bedrock embedding service.

### 4.3 Cool-down period

After unarchive, the skill enters a **14-day cool-down** (Section 3.6). During this period:

- The skill is fully active and routable.
- The skill is exempt from archive evaluation.
- The skill can be executed, validated, and promoted to canonical.
- The skill's confidence score and failure rate begin accumulating fresh data.

After the cool-down expires, the skill is evaluated on the next 24-hour cycle like any other active skill. If the underlying issues were not resolved, it will be re-archived — this is expected and correct behavior.

---

## 5. Threshold Tuning

### 5.1 Adjustment process

All thresholds are stored in the `codevolve-config` DynamoDB table and can be updated via `PUT /config/:key`. Changes take effect on the next evaluation cycle (within 24 hours). There is no need to redeploy the Decision Engine Lambda.

**Who can change thresholds?** Only operators with the `codevolve:admin` IAM policy. Threshold changes are logged to CloudTrail and emit a Kinesis event:

```json
{
    "event_type": "config_change",
    "key": "archive.staleness_days",
    "old_value": 90,
    "new_value": 120,
    "changed_by": "arn:aws:iam::...",
    "timestamp": "2026-03-21T00:00:00Z"
}
```

### 5.2 Metrics for detecting miscalibrated thresholds

The following metrics should be monitored on the Evolution/Gap dashboard to detect thresholds that need adjustment:

**Thresholds too aggressive (archiving too many skills):**

| Signal | Description | Response |
|--------|-------------|----------|
| Archive rate spike | > 20 skills archived per cycle for 3+ consecutive cycles | Review thresholds; likely too tight |
| Unarchive rate spike | > 5 manual unarchives per week | Operators are overriding the system — thresholds may be wrong |
| Resolve miss rate increase | `/resolve` returning low-confidence results more often after archival | Useful skills are being removed from the pool |
| Archive-then-unarchive rate | > 10% of archived skills unarchived within 30 days | Strong signal of over-aggressive thresholds |

**Thresholds too lenient (not archiving enough):**

| Signal | Description | Response |
|--------|-------------|----------|
| Stale skill percentage | > 30% of active skills have no execution in 60+ days | Staleness threshold may be too generous |
| Low-confidence active skills | > 10% of active skills have confidence < 0.5 | Low-confidence threshold may be too generous |
| `/resolve` serving failures | High failure rate on skills returned by `/resolve` | Broken skills are not being archived fast enough |

### 5.3 Dry-run mode

The Decision Engine supports a **dry-run mode** that evaluates all archive thresholds and logs the results without sending any messages to the SQS ArchiveQueue.

Configuration: `archive.dry_run`, default `false`.

When dry-run mode is enabled:

1. The evaluation logic runs identically to production.
2. Instead of sending SQS messages, it writes results to a `codevolve-archive-dry-run` DynamoDB table:

```json
{
    "evaluation_id": "uuid",
    "timestamp": "2026-03-21T04:00:00Z",
    "skills_evaluated": 1247,
    "skills_would_archive": 23,
    "details": [
        {
            "skill_id": "uuid",
            "trigger": "staleness_90d",
            "metrics_snapshot": { "days_since_last_execution": 114 }
        }
    ]
}
```

3. A CloudWatch custom metric `archive.dry_run.would_archive_count` is emitted for dashboarding.
4. No skills are actually archived.

**Recommended use.** Enable dry-run mode for **7 days** after any threshold change to observe the impact before switching to live mode. Also enable dry-run mode when initially deploying the archive system to validate thresholds against the real skill population.

---

## 6. Safety Guardrails

### 6.1 Maximum archives per cycle

As specified in ARCH-03:

| Limit | Value | Scope |
|-------|-------|-------|
| Per evaluation cycle | 50 skills | Decision Engine → SQS |
| Per 24-hour rolling window | 100 skills | Archive Handler (all sources combined) |

When the per-cycle limit of 50 is reached, remaining candidates are sorted by severity (highest failure rate first, then lowest confidence, then longest staleness) and deferred to the next cycle.

When the 24-hour rolling window limit of 100 is reached, the Archive Handler **pauses all archival** and raises a CloudWatch alarm. Archival does not resume until an operator acknowledges the alarm and either raises the limit or investigates the cause.

### 6.2 Canonical skill protection

Skills with `is_canonical: true` are **unconditionally exempt** from automatic archival. The Archive Handler rejects any archive request for a canonical skill and emits an `archive_blocked` event (see ARCH-03, Section 6.1).

To archive a canonical skill, an operator must:

1. Promote an alternative skill to canonical via `POST /skills/:alt_id/promote-canonical`, or
2. Explicitly demote the skill via `POST /skills/:id/demote-canonical`.
3. The skill then becomes eligible for archival on the next evaluation cycle.

This two-step process ensures that the problem always has a canonical skill available (or the operator has consciously decided to leave it without one).

### 6.3 Alarm thresholds for anomalous archive volume

| Alarm | Condition | Severity | Action |
|-------|-----------|----------|--------|
| `archive-high-volume` | > 30 skills archived in a single evaluation cycle | Warning | Notify operations channel |
| `archive-limit-reached` | 50-per-cycle or 100-per-day limit hit | Critical | Page on-call; archival paused |
| `archive-evaluation-stale` | No archive evaluation completed in 36 hours | Warning | Investigate Decision Engine health |
| `archive-dlq-nonempty` | Any message in `codevolve-archive-dlq` | Warning | Investigate failed archive operations |
| `archive-canonical-blocked` | `archive_blocked` event for canonical skill | Info | Review canonical skill health; may need `/evolve` attention |

All alarms are configured in CloudWatch and route to the `codevolve-ops` SNS topic.

### 6.4 Rollback procedure for mass archival

If a threshold misconfiguration or system error causes mass archival (defined as > 50 skills archived in a 24-hour period that are subsequently determined to be incorrectly archived):

**Immediate response (within 1 hour):**

1. Set `archive.dry_run = true` in the config table to halt further archival.
2. Query the analytics store for all `event_type = 'archive'` events in the affected time window.
3. Assess the scope: how many skills were archived, and which triggers fired.

**Recovery (within 4 hours):**

4. Use the bulk unarchive script (`scripts/bulk-unarchive.ts`, to be implemented by Ada in IMPL-04) to restore incorrectly archived skills. The script:
   - Accepts a list of skill IDs or a time-range filter.
   - Calls `POST /skills/:id/unarchive` for each skill, respecting the Bedrock rate limit.
   - Logs all restored skills.
   - Sets `unarchived_at` to enable the 14-day cool-down.
5. The rate limit on the unarchive endpoint (20/min) applies to the bulk script. For a mass restore of 50 skills, expect approximately 3 minutes of execution time.

**Post-incident (within 24 hours):**

6. Root-cause analysis: determine whether the issue was a bad threshold, a metrics anomaly (ClickHouse stale data), or a code bug.
7. Adjust thresholds if needed. Enable dry-run mode for 7 days after the adjustment.
8. Review whether the 50-per-cycle or 100-per-day limit should be lowered.
9. Write an incident report and update this policy document if a new edge case was discovered.

---

## Appendix A: Configuration Reference

All configuration keys live in the `codevolve-config` DynamoDB table.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `archive.staleness_days` | number | 90 | Days since last execution before staleness trigger |
| `archive.staleness_days.seasonal` | number | 365 | Staleness threshold for skills tagged `seasonal` |
| `archive.staleness_days.domain.{domain}` | number | (none) | Per-domain staleness override |
| `archive.low_confidence_threshold` | number | 0.3 | Confidence below which a skill is archived |
| `archive.low_confidence_min_executions` | number | 5 | Minimum lifetime executions before low-confidence trigger applies |
| `archive.failure_rate_threshold` | number | 0.80 | Failure rate above which a skill is archived |
| `archive.failure_rate_window_days` | number | 30 | Rolling window for failure rate calculation |
| `archive.failure_rate_min_executions` | number | 10 | Minimum executions in window before failure rate trigger applies |
| `archive.zero_usage_age_days` | number | 60 | Skill age (days) before zero-usage trigger applies |
| `archive.grace_period_days` | number | 30 | Days after creation before any archive evaluation |
| `archive.unarchive_cooldown_days` | number | 14 | Days after unarchive before re-evaluation |
| `archive.max_per_cycle` | number | 50 | Maximum archive operations per evaluation cycle |
| `archive.max_per_day` | number | 100 | Maximum archive operations per 24-hour rolling window |
| `archive.dry_run` | boolean | false | If true, evaluate but do not archive |
| `archive.evaluation_hour_utc` | number | 4 | Target hour (UTC) for archive evaluation |

---

## Appendix B: Threshold Summary

Quick reference for all archive triggers and their conditions:

| Trigger | Condition | Grace Period Exempt | Canonical Exempt | Evolve Exempt | Cooldown Exempt |
|---------|-----------|:-------------------:|:----------------:|:-------------:|:---------------:|
| Staleness | Last execution > 90 days (365 if seasonal) | Yes | Yes | Yes | Yes |
| Low confidence | Confidence < 0.3 AND lifetime executions >= 5 | Yes | Yes | Yes | Yes |
| High failure rate | Failure rate > 80% over 30 days AND >= 10 executions | Yes | Yes | Yes | Yes |
| Zero usage | 0 lifetime executions AND age > 60 days | Yes | Yes | Yes | Yes |

A skill is exempt from archival if **any** of the following are true:
- Age < 30 days (grace period)
- `is_canonical = true`
- `evolve_in_progress = true`
- `unarchived_at` is within the last 14 days (cool-down)

---

*Last updated: 2026-03-21 — full threshold policy defined by Amber (DESIGN-03)*
