-- Migration 007: add user_id to snowplow_events
--
-- Foundation for the behavioural fraud-detection feature
-- (docs/fraud-detection/PLAN.md, WS0-T1). Today the browser tracker never
-- calls setUserId and snowplow-bridge does not map Snowplow's `user_id`
-- field, so every event is anonymous. This column is the identity join that
-- lets us build a per-user behaviour baseline and detect deviations from it.
--
-- Contract (PLAN.md §4.1): String, format 'u_%06d' (e.g. 'u_000042'), empty
-- string means anonymous. Populated by:
--   - the storefront tracker after sign-in (frontend/src/lib/snowplow.ts)
--   - snowplow-bridge/main.py, mapping Snowplow's own `user_id` field
--   - the fraud generator and (as an explicit empty string) the web producer
--
-- Idempotent: this file is re-applied on every deploy (see 006's header for
-- why), so every statement uses IF NOT EXISTS.

ALTER TABLE retail_analytics.snowplow_events
    ADD COLUMN IF NOT EXISTS user_id String DEFAULT '' AFTER domain_sessionid;

ALTER TABLE retail_analytics.snowplow_events
    ADD INDEX IF NOT EXISTS idx_user_id user_id TYPE bloom_filter(0.01) GRANULARITY 4;
