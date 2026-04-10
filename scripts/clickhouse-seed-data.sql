-- codeVolve ClickHouse seed data script
-- Inserts 235 synthetic analytics_events rows spanning 2026-04-03 through 2026-04-09.
-- Covers all 5 dashboard types: resolve-performance, execution-caching, skill-quality,
-- evolution-gap, and agent-behavior.
--
-- Run after clickhouse-init.sql. Safe to re-run (event_ids are deterministic;
-- ReplacingMergeTree will deduplicate on replay).
--
-- Skill IDs used:
--   s1: 00000000-0000-0000-0000-000000000001  (domain: filesystem)
--   s2: 00000000-0000-0000-0000-000000000002  (domain: algorithm)
--   s3: 00000000-0000-0000-0000-000000000003  (domain: api)
--   s4: 00000000-0000-0000-0000-000000000004  (domain: database)
--   s5: 00000000-0000-0000-0000-000000000005  (domain: algorithm)
--   s6: 00000000-0000-0000-0000-000000000006  (domain: infrastructure)

-- 1. High-confidence resolve events (100 rows)
--    Feeds: resolve-performance, agent-behavior conversion funnel
INSERT INTO codevolve.analytics_events
(event_id, event_type, timestamp, skill_id, intent, latency_ms, confidence, cache_hit, input_hash, success)
SELECT
    lower(hex(MD5(concat('seed-resolve-hi-', toString(number))))) AS event_id,
    'resolve' AS event_type,
    toDateTime64(
        addSeconds(
            toDateTime('2026-04-03 00:00:00', 'UTC'),
            toInt32(number % 7) * 86400 + toInt32(number * 12373 % 86400)
        ),
        3, 'UTC'
    ) AS timestamp,
    arrayElement([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006'
    ], toUInt32(number % 6) + 1) AS skill_id,
    arrayElement([
        'list files in directory',
        'sort array of integers',
        'parse JSON from string',
        'compute fibonacci sequence',
        'reverse a string',
        'find duplicates in array',
        'read environment variable',
        'create REST API endpoint',
        'connect to postgresql database',
        'compress file with gzip'
    ], toUInt32(number % 10) + 1) AS intent,
    50.0 + toFloat64(number * 37 % 450) AS latency_ms,
    round(0.72 + toFloat64(number % 28) * 0.01, 2) AS confidence,
    0 AS cache_hit,
    lower(hex(MD5(concat('inp-res-', toString(number % 40))))) AS input_hash,
    if(number % 12 = 0, 0, 1) AS success
FROM numbers(100);

-- 2. Low-confidence resolve events — unresolved intents (30 rows)
--    Feeds: evolution-gap (unresolved_intents, low_confidence_intents, domain_coverage_gaps)
INSERT INTO codevolve.analytics_events
(event_id, event_type, timestamp, skill_id, intent, latency_ms, confidence, cache_hit, input_hash, success)
SELECT
    lower(hex(MD5(concat('seed-resolve-lo-', toString(number))))) AS event_id,
    'resolve' AS event_type,
    toDateTime64(
        addSeconds(
            toDateTime('2026-04-04 00:00:00', 'UTC'),
            toInt32(number % 6) * 86400 + toInt32(number * 98317 % 86400)
        ),
        3, 'UTC'
    ) AS timestamp,
    '' AS skill_id,
    arrayElement([
        'optimize slow postgresql query with large join',
        'implement oauth2 pkce flow in react spa',
        'configure kubernetes horizontal pod autoscaler',
        'setup terraform remote state with s3 locking',
        'debug memory leak in long-running node process'
    ], toUInt32(number % 5) + 1) AS intent,
    180.0 + toFloat64(number * 83 % 320) AS latency_ms,
    round(0.25 + toFloat64(number % 40) * 0.01, 2) AS confidence,
    0 AS cache_hit,
    '' AS input_hash,
    0 AS success
FROM numbers(30);

-- 3. Execute events with cache hit/miss variation (70 rows)
--    Feeds: execution-caching (top_skills, cache rates, latency, cache_candidates),
--            agent-behavior (conversion funnel, abandoned_executions)
INSERT INTO codevolve.analytics_events
(event_id, event_type, timestamp, skill_id, intent, latency_ms, confidence, cache_hit, input_hash, success)
SELECT
    lower(hex(MD5(concat('seed-execute-', toString(number))))) AS event_id,
    'execute' AS event_type,
    toDateTime64(
        addSeconds(
            toDateTime('2026-04-03 00:00:00', 'UTC'),
            toInt32(number % 7) * 86400 + toInt32(number * 77761 % 86400)
        ),
        3, 'UTC'
    ) AS timestamp,
    arrayElement([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006'
    ], toUInt32(number % 6) + 1) AS skill_id,
    '' AS intent,
    100.0 + toFloat64(number * 53 % 900) AS latency_ms,
    -1.0 AS confidence,
    if(number % 3 = 0, 1, 0) AS cache_hit,
    -- Repeating input hashes (mod 15) drives high input_repeat_rate for cache candidates
    lower(hex(MD5(concat('inp-exe-', toString(number % 15))))) AS input_hash,
    if(number % 14 = 0, 0, 1) AS success
FROM numbers(70);

-- 4. Validate events (20 rows)
--    Feeds: skill-quality (test_pass_rates, confidence_over_time, confidence_degradation)
INSERT INTO codevolve.analytics_events
(event_id, event_type, timestamp, skill_id, intent, latency_ms, confidence, cache_hit, input_hash, success)
SELECT
    lower(hex(MD5(concat('seed-validate-', toString(number))))) AS event_id,
    'validate' AS event_type,
    toDateTime64(
        addSeconds(
            toDateTime('2026-04-03 00:00:00', 'UTC'),
            toInt32(number % 7) * 86400 + toInt32(number * 44221 % 86400)
        ),
        3, 'UTC'
    ) AS timestamp,
    arrayElement([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000004'
    ], toUInt32(number % 4) + 1) AS skill_id,
    '' AS intent,
    220.0 + toFloat64(number * 67 % 480) AS latency_ms,
    round(0.76 + toFloat64(number % 24) * 0.01, 2) AS confidence,
    0 AS cache_hit,
    '' AS input_hash,
    if(number % 5 = 0, 0, 1) AS success
FROM numbers(20);

-- 5. Fail events (15 rows)
--    Feeds: evolution-gap (failed_executions, evolve_pipeline),
--            skill-quality (failure_rates)
INSERT INTO codevolve.analytics_events
(event_id, event_type, timestamp, skill_id, intent, latency_ms, confidence, cache_hit, input_hash, success)
SELECT
    lower(hex(MD5(concat('seed-fail-', toString(number))))) AS event_id,
    'fail' AS event_type,
    toDateTime64(
        addSeconds(
            toDateTime('2026-04-04 00:00:00', 'UTC'),
            toInt32(number % 6) * 86400 + toInt32(number * 55117 % 86400)
        ),
        3, 'UTC'
    ) AS timestamp,
    arrayElement([
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000005'
    ], toUInt32(number % 3) + 1) AS skill_id,
    arrayElement([
        'optimize slow postgresql query with large join',
        'implement oauth2 pkce flow in react spa',
        'configure kubernetes horizontal pod autoscaler'
    ], toUInt32(number % 3) + 1) AS intent,
    500.0 + toFloat64(number * 91 % 1000) AS latency_ms,
    -1.0 AS confidence,
    0 AS cache_hit,
    lower(hex(MD5(concat('inp-fail-', toString(number))))) AS input_hash,
    0 AS success
FROM numbers(15);

-- Verify row count after seed
SELECT event_type, count() AS rows FROM codevolve.analytics_events GROUP BY event_type ORDER BY rows DESC;
