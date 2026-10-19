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
.PHONY: help check-env tools-image doctor prefetch cluster images secrets apply-env app otel-k8s \
        pg-setup pg-reset psql ch-bootstrap ch-search ch-mvs ch-client \
        generators-start generators-stop backfill sim-start sim-stop \
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

pg-reset: check-env tools-image ## Truncate every Postgres table and reseed (not while the ClickPipe runs)
	@echo "WARNING: TRUNCATE is not replicated by the CDC ClickPipe. If the pipe exists, ClickHouse keeps"
	@echo "the rows this removes. To start over with a pipe running, use: make nuke-data"
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

test: tools-image ## Run the Python unit tests (tools, Snowplow bridge, generators)
	@docker run --rm $(TOOLS_IMAGE) python -m pytest /app/tools -q
	@docker build -q -t clickshop-snowplow-bridge snowplow-bridge >/dev/null
	@docker run --rm -v "$(CURDIR)/snowplow-bridge":/app -w /app clickshop-snowplow-bridge \
	  sh -c 'pip install -q --disable-pip-version-check --root-user-action=ignore pytest && python -m pytest -q'
	@docker build -q -t clickshop-producers -f data-generators/producers/Dockerfile data-generators >/dev/null
	@docker run --rm -v "$(CURDIR)/data-generators":/dg -w /dg clickshop-producers \
	  sh -c 'pip install -q --disable-pip-version-check --root-user-action=ignore pytest && python -m pytest -q tests'

# ── Setup (module 05) ────────────────────────────────────────────────────────
doctor: tools-image ## Check Docker, ports, .env and both databases
	@scripts/doctor.sh

prefetch: ## Download and build everything ahead of the workshop (needs a network once)
	@$(MAKE) --no-print-directory $(OTEL_CHART)
	@for image in $(K3D_IMAGE) $(K3D_TOOLS_IMAGE) $(K3D_PROXY_IMAGE) $(HELM_IMAGE) $(KUBECTL_IMAGE) \
	  $$(awk '/^image:/{print $$2}' deploy/k3d/cluster.yaml) $(CLICKHOUSE_IMAGE); do \
	  docker image inspect $$image >/dev/null 2>&1 || { echo "pulling $$image"; docker pull -q $$image >/dev/null; }; done
	@deploy/images.sh --no-import --all
	@echo "prefetched: the cluster can be created offline"

cluster: ## Create the k3d cluster (1 server, 2 agents; the storefront is on localhost:3000)
	@deploy/cluster.sh up

images: ## Build the images and load them into the cluster (only what changed)
	@deploy/images.sh

secrets: check-env ## Put .env into the cluster (Secret clickshop-secrets, plus the Postgres certificate)
	@deploy/secrets.sh

ENV_DEPLOYMENTS := frontend|snowplow-bridge|otel-gateway|card-gateway|producer-web|producer-cc|simulator
apply-env: secrets ## After editing .env: update the Secret and restart the pods that read it
	@$(KUBECTL) -n $(NS) get deploy -o name | grep -E '/($(ENV_DEPLOYMENTS))$$' | xargs $(KUBECTL) -n $(NS) rollout restart
	@$(KUBECTL) -n $(NS) rollout status deploy --timeout=5m

$(OTEL_CHART):
	@mkdir -p .workshop/charts
	@$(HELM) pull opentelemetry-collector --repo $(OTEL_CHART_REPO) --version $(OTEL_CHART_VERSION) \
	  --destination /workspace/.workshop/charts >/dev/null

otel-k8s: $(OTEL_CHART) ## Install the two Kubernetes collectors (node + cluster) into ClickStack
	@$(HELM) upgrade --install k8s-otel-daemonset $(OTEL_CHART) -f deploy/helm/otel-k8s/node.values.yaml \
	  -n observability --create-namespace --wait --timeout 5m >/dev/null
	@$(HELM) upgrade --install k8s-otel-deployment $(OTEL_CHART) -f deploy/helm/otel-k8s/cluster.values.yaml \
	  -n observability --wait --timeout 5m >/dev/null
	@echo "Kubernetes collectors running in namespace observability"

app: ## Install or upgrade the application and the Kubernetes collectors
	@$(HELM) upgrade --install clickshop $(APP_CHART) -n $(NS) --create-namespace \
	  --reset-then-reuse-values --wait --timeout 10m >/dev/null
	@$(MAKE) --no-print-directory otel-k8s
	@echo "ClickShop is running: http://localhost:3000"

# ── Workloads (modules 06 and 07) ────────────────────────────────────────────
generators-start: ## Start the live traffic generators (web events and card transactions)
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set producers.enabled=true --wait >/dev/null
	@echo "generators running (make logs S=producer-web). Stop them with: make generators-stop"

generators-stop: ## Stop the live traffic generators
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set producers.enabled=false --wait >/dev/null
	@echo "generators stopped"

backfill: ## Load 30 days of history into ClickHouse (a Kubernetes Job, a few minutes)
	@$(KUBECTL) -n $(NS) delete job backfill --ignore-not-found >/dev/null
	@$(HELM) template clickshop $(APP_CHART) -n $(NS) --set backfill.enabled=true \
	  --show-only templates/backfill.yaml | $(KUBECTL) apply -n $(NS) -f - >/dev/null
	@$(KUBECTL) -n $(NS) wait --for=condition=Ready pod -l job-name=backfill --timeout=120s >/dev/null || true
	@$(KUBECTL) -n $(NS) logs -f job/backfill
	@$(KUBECTL) -n $(NS) wait --for=condition=complete job/backfill --timeout=60s

USERS ?= 4
sim-start: ## Start simulated shoppers in real browsers: make sim-start USERS=4
	@deploy/images.sh simulator
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set simulator.enabled=true --set simulator.sessions=$(USERS) --wait >/dev/null
	@echo "simulator running with $(USERS) browsers (make logs S=simulator). Stop it with: make sim-stop"

sim-stop: ## Stop the simulated shoppers
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set simulator.enabled=false --wait >/dev/null
	@echo "simulator stopped"

# ── Fault exercise (module 08) ───────────────────────────────────────────────
break-card-gateway: ## Make the card gateway fail (502 after 1.5 s)
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set cardGatewayDown=true --wait >/dev/null
	@echo "card-gateway is down: card payments fail with 502 card_gateway_unavailable. Bring it back with: make fix-card-gateway"

fix-card-gateway: ## Bring the card gateway back
	@$(HELM) upgrade clickshop $(APP_CHART) -n $(NS) --reset-then-reuse-values \
	  --set cardGatewayDown=false --wait >/dev/null
	@echo "card-gateway is up"

# ── Operations ───────────────────────────────────────────────────────────────
status: check-env tools-image ## Pods, then row counts and freshness of the workshop tables
	@$(KUBECTL) get pods -n $(NS) -o wide 2>/dev/null || echo "no cluster: run make cluster"
	@$(KUBECTL) get pods -n observability 2>/dev/null || true
	@echo
	@$(TOOLS_RUN) python /app/tools/status.py

TAIL ?= 100
logs: ## Follow a service's logs: make logs S=frontend
	@test -n "$(S)" || { echo "usage: make logs S=<service>   (frontend, storefront-bff, otel-gateway, producer-web, simulator, ...)"; exit 2; }
	@$(KUBECTL) -n $(NS) logs -f --tail=$(TAIL) deploy/$(S)

check-%: ## Check a module's result: make check-05 (see scripts/checks)
	@test -x scripts/checks/check-$*.sh || { echo "no check for module $*"; exit 2; }
	@scripts/checks/check-$*.sh

down: ## Delete the cluster and everything in it (the databases are not touched)
	@deploy/cluster.sh down

nuke-data: check-env tools-image ## Back to the starting data: Postgres to the seed, ClickHouse generated tables emptied
	@echo "This restores Postgres to the seed (orders and customers added since are deleted) and empties"
	@echo "snowplow_events, credit_card_transactions, the analytics_* rollups and everything in retail_otel."
	@echo "Tables, views, the ClickPipe and products_search are kept."
	@read -r -p "Type 'nuke' to continue: " a; [ "$$a" = nuke ] || { echo "cancelled"; exit 1; }
	@if [ -f .workshop/kubeconfig ]; then $(MAKE) --no-print-directory generators-stop sim-stop; fi
	@$(TOOLS_RUN) python /app/tools/nuke_data.py --yes

# ── Maintainer only ──────────────────────────────────────────────────────────
images-webp: ## Regenerate frontend/public/images from assets/product_images (needs: pip install pillow)
	python3 assets/scripts/build_images.py assets/product_images frontend/public/images

dev-frontend: ## Run the frontend with npm on this machine, reading .env (needs node and npm)
	@scripts/with-env.sh npm --prefix frontend run dev
