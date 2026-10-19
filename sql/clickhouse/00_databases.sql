-- The three databases the workshop uses. Idempotent.
--
--   retail_analytics  clickstream, card transactions, rollups, products_search
--   retail_oltp       the Postgres CDC ClickPipe's destination (module 03)
--   retail_otel       ClickStack's tables, written by the OTel gateway
--
-- retail_otel must exist before the collector starts: otel-collector/migrate.py
-- skips CREATE DATABASE against Cloud.
--
-- retail_oltp is created here, not by the ClickPipe wizard, so the wizard
-- always finds it and `10_products_search.sql` has a database to refer to. The
-- tables inside it are created by the ClickPipe, not by any file in this repo.
CREATE DATABASE IF NOT EXISTS retail_analytics;
CREATE DATABASE IF NOT EXISTS retail_otel;
CREATE DATABASE IF NOT EXISTS retail_oltp;
