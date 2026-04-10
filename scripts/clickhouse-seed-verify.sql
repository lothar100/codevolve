-- codeVolve ClickHouse verification script
-- Run after clickhouse-init.sql to confirm the table is set up correctly.
-- Expected output: one row with the column list for analytics_events.

SELECT name, type
FROM system.columns
WHERE database = 'codevolve'
  AND table = 'analytics_events'
ORDER BY position;
