# ClickShop workshop commands. Every credential comes from the root `.env`
# (copy .env.example). It is handed to containers with `docker run --env-file`
# and never parsed by make: `include .env` would mangle a password that contains
# `$` or `#`, and a `# comment` after a value would become part of the value.

SHELL := /bin/bash

TOOLS_IMAGE   := clickshop-tools
# Pinned: the version the workshop is built against (text index needs 26.2+).
CLICKHOUSE_IMAGE := clickhouse/clickhouse-server:26.9
CLICKHOUSE_NATIVE_TLS_PORT := 9440

# The repo is mounted read-only so tools see sql/, the catalogue and the images.
TOOLS_RUN := docker run --rm --env-file .env -v "$(CURDIR)":/workspace:ro $(TOOLS_IMAGE)
TOOLS_TTY := docker run --rm -it --env-file .env -v "$(CURDIR)":/workspace:ro $(TOOLS_IMAGE)

.DEFAULT_GOAL := help
.PHONY: help check-env tools-image pg-setup pg-reset psql ch-bootstrap ch-search ch-mvs ch-client test images-webp

help: ## List the commands
	@grep -hE '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

check-env:
	@test -f .env || { echo "ERROR: .env not found. Run: cp .env.example .env  and fill in the required block."; exit 1; }

tools-image: ## Build the clickshop-tools image (psql + Python database tasks)
	@docker build -q -t $(TOOLS_IMAGE) tools >/dev/null

# ── Postgres (module 02) ─────────────────────────────────────────────────────
pg-setup: check-env tools-image ## Create the database, apply the schema, seed the catalogue (idempotent)
	@$(TOOLS_RUN) python /app/tools/seed_postgres.py

pg-reset: check-env tools-image ## Truncate every Postgres table and reseed
	@$(TOOLS_RUN) python /app/tools/seed_postgres.py --reset

psql: check-env tools-image ## Open psql on the workshop database
	@$(TOOLS_TTY) sh -c 'if [ -n "$$PGSSLROOTCERT" ]; then : "$${PGSSLMODE:=verify-full}"; else : "$${PGSSLMODE:=require}"; fi; export PGSSLMODE; exec psql'

# ── ClickHouse (modules 01, 04, 06) ──────────────────────────────────────────
ch-bootstrap: check-env tools-image ## Create the databases and the clickstream tables (idempotent)
	@$(TOOLS_RUN) python /app/tools/apply_sql.py --clickhouse sql/clickhouse/00_databases.sql sql/clickhouse/20_clickstream.sql

ch-search: check-env tools-image ## Build products_search from the CDC tables (after the ClickPipe)
	@$(TOOLS_RUN) python /app/tools/apply_sql.py --clickhouse sql/clickhouse/10_products_search.sql

ch-mvs: check-env tools-image ## Create the real-time rollups and backfill them
	@$(TOOLS_RUN) python /app/tools/apply_sql.py --clickhouse sql/clickhouse/30_realtime_mvs.sql

ch-client: check-env ## Open clickhouse-client on the service (uses the official image)
	@docker run --rm -it --env-file .env --entrypoint sh $(CLICKHOUSE_IMAGE) -c \
	  'exec clickhouse-client --host "$$CLICKHOUSE_HOST" --port $(CLICKHOUSE_NATIVE_TLS_PORT) --secure --user "$$CLICKHOUSE_USER" --password "$$CLICKHOUSE_PASSWORD"'

test: tools-image ## Run the Python unit tests (tools and the Snowplow bridge)
	@docker run --rm $(TOOLS_IMAGE) python -m pytest /app/tools -q
	@docker build -q -t clickshop-snowplow-bridge snowplow-bridge >/dev/null
	@docker run --rm -v "$(CURDIR)/snowplow-bridge":/app -w /app clickshop-snowplow-bridge \
	  sh -c 'pip install -q --disable-pip-version-check --root-user-action=ignore pytest && python -m pytest -q'

# ── Maintainer only ──────────────────────────────────────────────────────────
images-webp: ## Regenerate frontend/public/images from assets/product_images (needs: pip install pillow)
	python3 assets/scripts/build_images.py assets/product_images frontend/public/images
