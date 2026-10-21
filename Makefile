# ClickShop workshop commands. Every credential comes from the root `.env`
# (copy .env.example). It is handed to containers with `docker run --env-file`
# and never parsed by make: `include .env` would mangle a password that contains
# `$` or `#`, and a `# comment` after a value would become part of the value.

SHELL := /bin/bash

# Pinned versions of the platform tools (shared with the deploy/bin wrappers).
include deploy/versions.env

# k3d, kubectl and helm run from containers (deploy/bin), so nothing needs installing.
K3D     := deploy/bin/k3d
KUBECTL := deploy/bin/kubectl
HELM    := deploy/bin/helm
NS      := clickshop
APP_CHART := deploy/helm/clickshop
OTEL_CHART := .workshop/charts/opentelemetry-collector-$(OTEL_CHART_VERSION).tgz

TOOLS_IMAGE   := clickshop-tools
# Pinned: the version the workshop is built against (text index needs 26.2+).
CLICKHOUSE_IMAGE := clickhouse/clickhouse-server:26.9
CLICKHOUSE_NATIVE_TLS_PORT := 9440

# The repo is mounted read-only so tools see sql/, the catalogue and the images.
TOOLS_RUN := docker run --rm --env-file .env -v "$(CURDIR)":/workspace:ro $(TOOLS_IMAGE)
TOOLS_TTY := docker run --rm -it --env-file .env -v "$(CURDIR)":/workspace:ro $(TOOLS_IMAGE)

.DEFAULT_GOAL := help
.PHONY: help check-env tools-image doctor prefetch cluster images secrets apply-env app otel-k8s setup notebook \
        pg-setup pg-migrate pg-seed pg-reset psql ch-query pg-query clickpipes clickpipes-status clickpipes-wait clickpipes-delete clickstack-setup clickstack-list ch-bootstrap ch-search ch-mvs ch-client \
        need-cluster need-app cloud-ids up start traffic-start generators-start generators-stop backfill backfill-run sim-start sim-stop traffic-stop \
        break-card-gateway fix-card-gateway status logs down nuke-data \
        test images-webp dev-frontend

help: ## List the commands
	@grep -hE '^[a-zA-Z0-9_%-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-20s %s\n", $$1, $$2}'

check-env:
	@test -f .env || { echo "ERROR: .env not found. Run: cp .env.example .env  and fill in the required block."; exit 1; }

tools-image: ## Build the clickshop-tools image (psql + Python database tasks)
	@docker build -q -t $(TOOLS_IMAGE) tools >/dev/null

# ── Postgres (module 02) ─────────────────────────────────────────────────────
pg-setup: check-env tools-image ## Create the database, apply the schema, seed the catalogue (idempotent)
	@$(TOOLS_RUN) python /app/tools/seed_postgres.py

pg-migrate: check-env tools-image ## Create the Postgres database and tables, load no data
	@$(TOOLS_RUN) python /app/tools/seed_postgres.py --schema-only

pg-seed: check-env tools-image ## Load the catalogue, customers, stock and orders (what pg-setup does after the tables exist)
	@$(TOOLS_RUN) python /app/tools/seed_postgres.py

pg-reset: check-env tools-image ## Truncate every Postgres table and reseed (not while the ClickPipe runs)
	@echo "WARNING: TRUNCATE is not replicated by the CDC ClickPipe. If the pipe exists, ClickHouse keeps"
	@echo "the rows this removes. To start over with a pipe running, use: make nuke-data (it empties the mirror too)"
	@if [ "$(CONFIRM)" != "yes" ]; then read -r -p "Type 'reset' to truncate anyway: " a; [ "$$a" = reset ] || { echo "cancelled"; exit 1; }; fi
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

# SQL without a prompt, for a coding agent or a script (psql and ch-client need a terminal):
#   make ch-query Q="SELECT 1"      make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2
# The statement goes in single quotes (an embedded ' is escaped); write $$ for a literal $.
QUERY_ARGS = $(if $(Q),--sql '$(subst ','\'',$(Q))') $(if $(FILE),--file '$(FILE)' $(if $(N),--only $(N)))
QUERY_USAGE = usage: make $@ Q=\"SELECT 1\"   or   make $@ FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2
ch-query: check-env tools-image ## Run SQL on ClickHouse without a prompt: Q="SELECT 1" or FILE=<example.sql> N=<query number>
	@test -n "$(Q)$(FILE)" || { echo "$(QUERY_USAGE)"; exit 2; }
	@$(TOOLS_RUN) python /app/tools/query.py clickhouse $(QUERY_ARGS)

pg-query: check-env tools-image ## Run SQL on Postgres without a prompt: Q="SELECT 1"
	@test -n "$(Q)$(FILE)" || { echo "$(QUERY_USAGE)"; exit 2; }
	@$(TOOLS_RUN) python /app/tools/query.py postgres $(QUERY_ARGS)

test: tools-image ## Run the Python unit tests (tools, Snowplow bridge, generators)
	@docker run --rm -v "$(CURDIR)":/workspace:ro $(TOOLS_IMAGE) python -m pytest /app/tools -q
	@docker build -q -t clickshop-snowplow-bridge snowplow-bridge >/dev/null
	@docker run --rm -v "$(CURDIR)/snowplow-bridge":/app -w /app clickshop-snowplow-bridge \
	  sh -c 'pip install -q --disable-pip-version-check --root-user-action=ignore pytest && python -m pytest -q'
	@docker build -q -t clickshop-producers -f data-generators/producers/Dockerfile data-generators >/dev/null
	@docker run --rm -v "$(CURDIR)/data-generators":/dg -w /dg clickshop-producers \
	  sh -c 'pip install -q --disable-pip-version-check --root-user-action=ignore pytest && python -m pytest -q tests'

# ── The whole workshop at once, or the Cloud pieces one by one ───────────────
setup: check-env tools-image ## Set EVERYTHING up in one go (ClickPipe, search, rollups, cluster, ClickStack, load); needs a Cloud API key
	@scripts/setup.sh

clickpipes: check-env tools-image ## Create the Postgres CDC ClickPipe through the Cloud API (needs an API key in .env)
	@$(TOOLS_RUN) python /app/tools/clickpipes.py create

clickpipes-status: check-env tools-image ## The ClickPipe's state
	@$(TOOLS_RUN) python /app/tools/clickpipes.py status

clickpipes-wait: check-env tools-image ## Wait until retail_oltp holds what Postgres holds
	@$(TOOLS_RUN) python /app/tools/clickpipes.py wait-sync

clickpipes-delete: check-env tools-image ## Delete the ClickPipe (module 10 does this in the console)
	@$(TOOLS_RUN) python /app/tools/clickpipes.py delete

clickstack-setup: check-env tools-image ## Create the ClickStack sources (logs, traces, metrics, sessions) through the Cloud API
	@$(TOOLS_RUN) python /app/tools/clickstack.py setup

clickstack-list: check-env tools-image ## List the ClickStack sources
	@$(TOOLS_RUN) python /app/tools/clickstack.py list

cloud-ids: check-env tools-image ## Print your Cloud organization id and service id (for the agent's instructions; needs an API key)
	@$(TOOLS_RUN) python /app/tools/cloud_api.py ids

notebook: check-env tools-image ## Open the notebook that creates the ClickPipe (JupyterLab on http://localhost:8888)
	@docker build -q -t clickshop-notebook -f notebooks/Dockerfile notebooks >/dev/null
	@echo "JupyterLab on http://localhost:8888 (Ctrl+C to stop); open 01_create_clickpipes.ipynb"
	@docker run --rm -it -p 127.0.0.1:8888:8888 --env-file .env -v "$(CURDIR)":/workspace:ro \
	  -v "$(CURDIR)/notebooks":/workspace/notebooks clickshop-notebook

# ── Setup (module 05) ────────────────────────────────────────────────────────
doctor: tools-image ## Check Docker, ports, .env and both databases
	@scripts/doctor.sh

prefetch: tools-image ## Download and build everything ahead of the workshop (needs a network once)
	@$(MAKE) --no-print-directory $(OTEL_CHART)
	@for image in $(K3D_IMAGE) $(K3D_TOOLS_IMAGE) $(K3D_PROXY_IMAGE) $(HELM_IMAGE) $(KUBECTL_IMAGE) \
	  $$(awk '/^image:/{print $$2}' deploy/k3d/cluster.yaml) $(CLICKHOUSE_IMAGE); do \
	  docker image inspect $$image >/dev/null 2>&1 || { echo "pulling $$image"; docker pull -q $$image >/dev/null; }; done
	@deploy/images.sh --no-import --all
	@echo "prefetched: the cluster can be created offline"

# A command that needs the cluster says so in one line, instead of a kubectl error about localhost:8080.
CLUSTER_NODE := k3d-clickshop-server-0
CLUSTER_UP   := docker inspect -f '{{.State.Running}}' $(CLUSTER_NODE) 2>/dev/null | grep -q true
APP_UP       := $(CLUSTER_UP) && $(HELM) status clickshop -n $(NS) >/dev/null 2>&1

need-cluster:
	@$(CLUSTER_UP) || { echo "ERROR: the local cluster is not running. Create it with:  make up  (module 05), or run  make setup"; exit 1; }

need-app: need-cluster
	@$(HELM) status clickshop -n $(NS) >/dev/null 2>&1 || { echo "ERROR: the application is not installed in the cluster. Install it with:  make up  (module 05), or run  make setup"; exit 1; }

cluster: ## Create the k3d cluster (1 server, 2 agents; the storefront is on localhost:3000)
	@deploy/cluster.sh up

images: need-cluster ## Build the images and load them into the cluster (only what changed)
	@deploy/images.sh

secrets: check-env need-cluster ## Put .env into the cluster (Secret clickshop-secrets, plus the Postgres certificate)
	@deploy/secrets.sh

ENV_DEPLOYMENTS := frontend|snowplow-bridge|otel-gateway|card-gateway|producer-web|producer-cc|simulator
apply-env: need-app secrets ## After editing .env: update the Secret and restart the pods that read it
	@$(KUBECTL) -n $(NS) get deploy -o name | grep -E '/($(ENV_DEPLOYMENTS))$$' | xargs $(KUBECTL) -n $(NS) rollout restart
	@$(KUBECTL) -n $(NS) rollout status deploy --timeout=5m

$(OTEL_CHART):
	@mkdir -p .workshop/charts
	@$(HELM) pull opentelemetry-collector --repo $(OTEL_CHART_REPO) --version $(OTEL_CHART_VERSION) \
	  --destination /workspace/.workshop/charts >/dev/null

otel-k8s: need-cluster $(OTEL_CHART) ## Install the two Kubernetes collectors (node + cluster) into ClickStack
	@$(HELM) upgrade --install k8s-otel-daemonset $(OTEL_CHART) -f deploy/helm/otel-k8s/node.values.yaml \
	  -n observability --create-namespace --wait --timeout 5m >/dev/null
	@$(HELM) upgrade --install k8s-otel-deployment $(OTEL_CHART) -f deploy/helm/otel-k8s/cluster.values.yaml \
	  -n observability --wait --timeout 5m >/dev/null
	@echo "Kubernetes collectors running in namespace observability"

up: ## Start the local cluster and the application in one go: cluster, images, secrets, app (module 05)
	@$(MAKE) --no-print-directory cluster images secrets app

app: need-cluster ## Install or upgrade the application and the Kubernetes collectors
	@$(HELM) upgrade --install clickshop $(APP_CHART) -n $(NS) --create-namespace \
	  --reset-then-reuse-values --wait --timeout 10m >/dev/null
	@$(MAKE) --no-print-directory otel-k8s
	@echo "ClickShop is running: http://localhost:3000"

# ── Workloads (modules 06 and 07) ────────────────────────────────────────────
generators-start: need-app ## Start the live traffic generators (web events and card transactions)
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set producers.enabled=true --wait >/dev/null
	@echo "generators running (make logs S=producer-web). Stop them with: make generators-stop"

generators-stop: ## Stop the live traffic generators
	@if $(APP_UP); then \
	  $(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values --set producers.enabled=false --wait >/dev/null \
	  && echo "generators stopped"; \
	else echo "nothing to stop: the application is not running"; fi

backfill: check-env tools-image ## Load 30 days of history into ClickHouse (a Kubernetes Job, a few minutes); skipped if it is there, FORCE=1 loads it again
	@if [ -z "$(FORCE)" ] && $(TOOLS_RUN) python /app/tools/backfill_guard.py; then :; else $(MAKE) --no-print-directory backfill-run; fi

backfill-run: need-app
	@$(KUBECTL) -n $(NS) delete job backfill --ignore-not-found >/dev/null
	@$(HELM) template clickshop $(APP_CHART) -n $(NS) --set backfill.enabled=true \
	  --show-only templates/backfill.yaml | $(KUBECTL) apply -n $(NS) -f - >/dev/null
	@$(KUBECTL) -n $(NS) wait --for=condition=Ready pod -l job-name=backfill --timeout=120s >/dev/null || true
	@$(KUBECTL) -n $(NS) logs -f job/backfill
	@$(KUBECTL) -n $(NS) wait --for=condition=complete job/backfill --timeout=60s

USERS ?= 4
sim-start: need-app ## Start simulated shoppers in real browsers: make sim-start USERS=4
	@deploy/images.sh simulator
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set simulator.enabled=true --set simulator.sessions=$(USERS) --wait >/dev/null
	@echo "simulator running with $(USERS) browsers (make logs S=simulator). Stop it with: make sim-stop"

sim-stop: ## Stop the simulated shoppers
	@if $(APP_UP); then \
	  $(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values --set simulator.enabled=false --wait >/dev/null \
	  && echo "simulator stopped"; \
	else echo "nothing to stop: the application is not running"; fi

traffic-start: need-app ## Start all the load at once: the live generators and the simulated shoppers (make traffic-start USERS=4)
	@$(MAKE) --no-print-directory generators-start sim-start

start: ## Everything local in one go: the cluster and the application, then the generators and the shoppers (make start USERS=4)
	@$(MAKE) --no-print-directory up traffic-start

traffic-stop: ## Stop all the load at once: the live generators and the simulated shoppers
	@if $(APP_UP); then \
	  $(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values --set producers.enabled=false --set simulator.enabled=false --wait >/dev/null \
	  && echo "generators and simulator stopped"; \
	else echo "nothing to stop: the application is not running"; fi

# ── Fault exercise (module 08) ───────────────────────────────────────────────
break-card-gateway: need-app ## Make the card gateway fail (502 after 1.5 s)
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set cardGatewayDown=true --wait >/dev/null
	@echo "card-gateway is down: card payments fail with 502 card_gateway_unavailable. Bring it back with: make fix-card-gateway"

fix-card-gateway: need-app ## Bring the card gateway back
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set cardGatewayDown=false --wait >/dev/null
	@echo "card-gateway is up"

# ── Operations ───────────────────────────────────────────────────────────────
status: check-env tools-image ## Pods, then row counts and freshness of the workshop tables
	@$(KUBECTL) get pods -n $(NS) -o wide 2>/dev/null || echo "no cluster: run make up"
	@$(KUBECTL) get pods -n observability 2>/dev/null || true
	@echo
	@$(TOOLS_RUN) python /app/tools/status.py

TAIL ?= 100
logs: need-cluster ## Follow the logs of a service, or of a Job such as backfill: make logs S=frontend
	@test -n "$(S)" || { echo "usage: make logs S=<service>   (frontend, storefront-bff, otel-gateway, producer-web, simulator, ...)"; exit 2; }
	@if $(KUBECTL) -n $(NS) get deploy $(S) >/dev/null 2>&1; then kind=deploy; else kind=job; fi; \
	  $(KUBECTL) -n $(NS) logs -f --tail=$(TAIL) $$kind/$(S)

check-%: ## Check a module's result: make check-05 (see scripts/checks)
	@test -x scripts/checks/check-$*.sh || { echo "no check for module $*"; exit 2; }
	@scripts/checks/check-$*.sh

down: ## Delete the cluster and everything in it (the databases are not touched)
	@deploy/cluster.sh down

nuke-data: check-env tools-image ## Reseed Postgres and let the ClickPipe re-ingest it (events and telemetry are kept)
	@echo "This truncates and reseeds Postgres (the orders and customers added since are gone, the stock is"
	@echo "restored) and empties the retail_oltp mirror tables in ClickHouse, which the ClickPipe then fills"
	@echo "again (a few minutes; products_search is empty until it has). Web analytics events and telemetry"
	@echo "are not touched."
	@read -r -p "Type 'nuke' to continue: " a; [ "$$a" = nuke ] || { echo "cancelled"; exit 1; }
	@if [ -f .workshop/kubeconfig ]; then $(MAKE) --no-print-directory sim-stop; fi
	@$(TOOLS_RUN) python /app/tools/nuke_data.py --yes

# ── Maintainer only ──────────────────────────────────────────────────────────
images-webp: ## Regenerate frontend/public/images from assets/product_images (needs: pip install pillow)
	python3 assets/scripts/build_images.py assets/product_images frontend/public/images --prune

dev-frontend: ## Run the frontend with npm on this machine, reading .env (needs node and npm)
	@scripts/with-env.sh npm --prefix frontend run dev
