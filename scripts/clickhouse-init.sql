-- codeVolve ClickHouse initialization script
-- Run once against ClickHouse Cloud to create the analytics database and table.
-- This script is idempotent: safe to run multiple times.

CREATE DATABASE IF NOT EXISTS codevolve;

CREATE TABLE IF NOT EXISTS codevolve.analytics_events
(
    event_id     String,                         -- SHA-256 hex: deduplication key (ORDER BY)
    event_type   LowCardinality(String),         -- 'resolve' | 'execute' | 'validate' | 'fail' | ...
    timestamp    DateTime64(3, 'UTC'),           -- millisecond precision, UTC
    skill_id     String,                         -- UUID string or empty string (never NULL in CH)
    intent       String,                         -- intent string or empty string
    latency_ms   Float64,
    confidence   Nullable(Float64),              -- null for 'fail' and 'archive_warning' events
    cache_hit    UInt8,                          -- 0 or 1 (boolean stored as UInt8)
    input_hash   String,                         -- SHA-256 hex or empty string
    success      UInt8,                          -- 0 or 1
    _ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)  -- version column: latest write wins
)
ENGINE = ReplacingMergeTree(_ingested_at)
ORDER BY (event_type, toDate(timestamp), skill_id, event_id)
PARTITION BY toYYYYMM(timestamp)
TTL toDate(timestamp) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
