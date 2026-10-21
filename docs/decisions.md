# Decisions log

Decisions for the ClickShop workshop, and findings recorded while building it. Confirmed decisions
are the owner's and are not changed here; a Proposed decision changes only after the owner agrees,
and the change is written down below.

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Single run mode: k3d locally, plus ClickHouse Cloud and Managed Postgres | Confirmed |
| D2 | Delete fraud, ML, Terraform/EC2/Caddy, image search/embeddings, Kafka | Confirmed |
| D3 | Generators use only the ClickHouse sink, with large batches | Confirmed |
| D4 | Simulator runs in browser mode only | Confirmed |
| D5 | Simulated orders write to Postgres and decrement stock | Confirmed |
| D6 | Search uses only ClickHouse full-text search | Confirmed |
| D7 | Drop the fraud-detection-svc hop; keep the pix and boleto gateways | Confirmed |
| D8 | Separate instruction sources for human mode and agent mode | Confirmed |
| D9 | `products_search` is **built from the CDC-replicated Postgres tables** by a refreshable MV that runs **every 5 minutes** (it was every minute; see D46), not by a seed script. Stock levels then show in search, and the catalogue has one source of truth. | Confirmed |
| D10 | Remove the **search journey** (`storefront-bff → search-svc`) and the `search-svc` role. Today it is a telemetry-only call whose result is ignored, so a trace would wrongly suggest search-svc does the searching. Keep the catalog journey. **Every search must emit its own span** (`search.products`, see Phase 3.1), with the ClickHouse query span as its child, so searches stay visible in ClickStack. | Confirmed |
| D11 | Remove persona sign-in (`AuthContext`, `/api/auth/personas`, `/account`) from the workshop. It reads `user_profiles`, which only the fraud generator fills. | Confirmed |
| D12 | The owner adds the source JPEGs at `assets/product_images/` in the workshop repo. Convert them to WebP in `frontend/public/images/` (800 px, quality 85, **about 16 MiB measured** for all 947 images) and serve them from there; no CDN. **Commit only the WebP output.** The JPEGs (437 MB) sit in the working tree but stay gitignored and are never committed. | Confirmed |
| D13 | Postgres uses database `clickshop`, schema `public`. Drop the `retail_db` schema and the `search_path` workaround. | Proposed |
| D14 | Drop the generated column `order_items.subtotal`, because logical replication doesn't publish generated columns by default. Compute `quantity * unit_price` in queries. Nothing reads it today. | Proposed |
| D15 | Orders go `pending` → `confirmed` or `cancelled`. Participants then see inserts *and* updates arrive through CDC, which teaches ReplacingMergeTree and `FINAL`. | Proposed |
| D16 | `CARD_GATEWAY_DOWN` defaults to **false**. Breaking it is an exercise in the observability module. | Confirmed |
| D17 | Tooling: a Makefile, a local Helm chart, and one-shot tasks via `docker run` of a `clickshop-tools` image, so they work before the cluster exists. | Proposed |
| D18 | Collapse the migration history into a clean, numbered SQL set that describes the final schema. | Proposed |
| D19 | k3d cluster with 1 server and 2 agents, so the Kubernetes views show several nodes. | Proposed |
| D20 | Images are built locally and loaded with `k3d image import`. Publishing prebuilt multi-arch images to GHCR is an optional later step that needs the owner's approval, because it publishes externally. | Proposed |
| D21 | **One root `.env` holds every credential and setting.** It covers the ClickHouse service, Managed Postgres and optional tuning. Every component reads it, through the Makefile, `docker run --env-file`, or the k8s Secret built from it. Participants, and the implementer's test setup, fill in that one place only. | Confirmed |
| D22 | The workshop repo starts with a **fresh git history**. The owner clones this repo to a new local folder and points it at a new remote; the history is re-initialised (Phase 0). | Confirmed |
| D23 | The catalogue repeats SKUs across different products (147 SKUs on 479 rows), but `products.sku` is `UNIQUE`. The seed keeps the catalogue SKU for the lowest id and appends `-<id>` to every later duplicate (332 of 978 rows). | Proposed |
| D24 | `retail_oltp` is created by `sql/clickhouse/00_databases.sql`, not by the ClickPipe wizard, so the wizard always finds it. The tables inside it still come from the ClickPipe. | Proposed |
| D25 | Product search folds accents inside the text-index preprocessor (NFD-decompose, drop combining marks), so "tenis" finds "tênis". | Proposed |
| D26 | The `clickshop-tools` image has no ClickHouse client binary (the whole ~800 MB server). `make ch-client` runs the pinned official server image instead. | Proposed |
| D27 | The Makefile never parses `.env`: it hands the file to containers with `docker run --env-file`. `.env.example` keeps comments on their own lines. | Proposed |
| D28 | Postgres TLS: with `PGSSLROOTCERT` (path to the instance's CA bundle, relative to the repo root) every component connects with `verify-full`. Without it the connection is encrypted but the server is not authenticated. `*.pem` is gitignored. | Proposed |
| D29 | The Snowplow bridge resets Micro **before** it inserts and retries failed inserts from memory, instead of resetting after. Measured loss with the plan's order: 3 of the 9 events one browser session sent (a third); with this order: 0 of 81 across 9 sessions. | Proposed |
| D30 | The simulator's shoppers use a **workshop funnel** that converts more than the shared one (`bounce_rate` 0.20, `search_rate` 0.40, `pdp_to_cart` 0.20, `cart_to_checkout` 0.95, `checkout_to_purchase` 0.95), unless `SIM_REALISTIC_FUNNEL=true`. The shared rates give about 2.5% of sessions an order: one every seven minutes at the laptop's 6 sessions a minute. The producers keep the realistic rates. | Proposed |
| D31 | Simulator laptop defaults: 4 concurrent browsers, 6 sessions a minute, dwell scale 0.1, and a **flat** arrival rate (the diurnal curve is opt-in with `SIM_DIURNAL=true`). `.env.example` documents `SIM_SESSIONS` (concurrent browsers) rather than `SIM_MAX_BACKLOG`, which stays an internal queue cap. | Proposed |
| D32 | `k3d`, `kubectl` and `helm` run from pinned container images through wrappers in `deploy/bin/` (versions in `deploy/versions.env`), against a project-scoped kubeconfig at `.workshop/kubeconfig`. Participants install only Docker and `make`, and the participant's own `~/.kube/config` is never read or changed. | Proposed |
| D33 | Images are loaded into the nodes with `docker save --platform` and `ctr images import`, then **checked on every node**, instead of `k3d image import`. With Docker's containerd image store (the default in Docker 29 and recent Docker Desktop) k3d prints "Successfully imported" and exits 0 while every node refused the archive. | Proposed |
| D34 | The kubelets run with `eviction-hard` and image GC thresholds relaxed (`deploy/k3d/cluster.yaml`), and `make doctor` checks for 10 GB of free space in Docker's disk. All three nodes share one disk and each sees the whole of it, so on a disk that is 90% full the defaults taint every node and evict the pods, and at 85% they garbage-collect the images `make images` loaded. | Proposed |
| D35 | Only the pods that connect to a database read the whole `clickshop-secrets` Secret (`envFrom`). The 14 demo services get no credentials; `card-gateway` takes `CARD_GATEWAY_DOWN` from the Secret through an optional `secretKeyRef`. The Postgres CA certificate is a second Secret mounted into the frontend, which replaces the host path in `PGSSLROOTCERT`. | Proposed |
| D36 | The optional keys of `.env` travel in the same Secret as the required ones; there is no second ConfigMap. Chart values never set a variable that `.env` can set, because an explicit `env` entry beats `envFrom`. | Proposed |
| D37 | Helm release state: `make app` uses `--reset-then-reuse-values`, the generators and simulator are `enabled` values (`make generators-start`, `make sim-start`), and the backfill Job is rendered with `helm template` and applied outside the release, so an upgrade never runs it again. | Proposed |
| D38 | The Kubernetes collectors use the guide's collector image **0.123.0** with chart **0.122.5** (the last chart built for that generation). At that version the kubelet metrics have the names HyperDX's Kubernetes dashboard reads (`k8s.pod.cpu.utilization`, `k8s.node.cpu.utilization`); collectors from 0.125 emit `.usage` instead. | Proposed |
| D39 | Logs are de-duplicated by label: pods that send logs over OTLP (frontend, demo services) carry `otel.logs: otlp`, and the node collector drops their stdout after `k8sattributes`. | Proposed |
| D40 | The simulator image is **Chromium only** (1.5 GB, `python:3.12-slim-bookworm` plus `playwright install --with-deps chromium`, Playwright still 1.44.0) instead of the 2.9 GB official image with three browsers. It is loaded onto **one** node, labelled `clickshop/simulator-image`, which the chart's `nodeSelector` asks for. `clickshop-tools` is not loaded into the cluster: it only runs through `docker run`. | Proposed |
| D41 | `.env.example` no longer lists `SIM_SESSIONS` (amends D31): the number of browsers is `make sim-start USERS=n`, because it sets the pod's memory limit as well. | Proposed |
| D42 | `make nuke-data` reseeds Postgres from scratch (TRUNCATE and the seed) and empties the `retail_oltp` mirror tables in ClickHouse, so the ClickPipe ingests the seed again from empty. It **never touches the web analytics events, the card transactions, the rollups built from them or the ClickStack telemetry** (`retail_otel`): they are slow to rebuild. The order matters because the ClickPipe ignores TRUNCATE: wait for the pipe to catch up, empty the mirror (not the pipe's own `_peerdb_` tables), reseed Postgres, wait for the mirror to fill, then refresh `products_search`. Without a ClickPipe only Postgres is reseeded. This is the owner's rule; the first version emptied the events and telemetry and was wrong. | Confirmed |
| D43 | The workshop sells **only the products the catalogue marks active**. `is_active` in the seed is the catalogue's own `is_active` AND NOT `flagged_for_deletion` AND an image exists (the catalogue's `is_active` used to be ignored). The repo carries images **only for those products**: `assets/scripts/build_images.py` converts exactly them (`--prune` removes the rest), and a test fails if an image of a deactivated product, or a missing image of an active one, is in the repo. `assets/catalog_details/catalog.json` is kept untouched as the reference, and every catalogue product is still seeded (so the catalogue ids stay stable), the deactivated ones as inactive rows on the placeholder image. | Confirmed |
| D44 | The ClickPipe and the ClickStack sources are created **through the ClickHouse Cloud API** (`tools/clickpipes.py`, `tools/clickstack.py`), with an optional API key in `.env` (`CLICKHOUSE_CLOUD_API_KEY_ID`, `CLICKHOUSE_CLOUD_API_KEY_SECRET`, and `CLICKHOUSE_CLOUD_ORGANIZATION_ID` only if the key sees several organisations). The console steps stay in the module READMEs for doing it by hand. | Confirmed |
| D45 | `make setup` builds everything at once for the one-hour format, in the order **Postgres migrations, ClickPipe, seed** (the pipe is created against empty tables and the seed reaches ClickHouse as changes). The by-hand path in the modules loads Postgres first (module 01's `make pg-setup`) and creates the pipe after, with an initial load; both end in the same state. `make pg-migrate` and `make pg-seed` are the two halves of `make pg-setup`. | Confirmed |
| D46 | The ClickPipe's sync interval is **60 s** (the console default; the plan suggested 10), and the `products_search` refreshable view refreshes **every 5 minutes** (was every minute, D9). The freshness budget of search is the sync interval plus up to 5 minutes; `SYSTEM REFRESH VIEW` skips the second wait. | Confirmed |
| D47 | Module 02 (the Postgres tour) is **optional**: the steps it needed (create the tables and load the data) are part of module 01. | Confirmed |
| D48 | `notebooks/01_create_clickpipes.ipynb` makes the ClickPipe calls one at a time, in the setup order (migrate, create the pipe, seed). It imports `tools/clickpipes.py`, the code `make clickpipes` runs, so there is one implementation; `make notebook` runs it in JupyterLab in a container. | Confirmed |
| D49 | `make backfill` **skips itself when the history is already there** (`tools/backfill_guard.py`: at least 100,000 events older than two days in `snowplow_events`); `make backfill FORCE=1` loads it anyway. The Job used to run every time, so a second `make setup` would have loaded every session twice, into the one kind of data that must never be emptied to retry. | Confirmed |
| D50 | The ClickPipe commands treat as theirs **any pipe that copies the same Postgres host and database into the same ClickHouse database**, whatever its name (the console names it `clickpipe-<service>`, not `clickshop-cdc`). Without this, `make clickpipes` after module 03 by hand would create a second pipe writing into the same tables. `status` and `delete` without `--name` resolve the same way. | Confirmed |
| D51 | **Agent mode is a separate source** (D8): `AGENTS.md` is the rulebook (read by Claude Code through `CLAUDE.md` → `@AGENTS.md`, and by Codex, Cursor, Copilot) and `agent-mode/NN-*.md` is one lesson plan per module, written for the agent. They share with the human modules only the executable truth: the `make` targets, `scripts/checks/check-NN.sh` and the SQL under `sql/`. A playbook never sends the agent to a `workshop/` README (a test enforces it). | Confirmed |
| D52 | Agent mode has **two tracks**, and the **fast track is the default** (the owner's choice: the agent starts on it without asking, and the participant can ask for the guided one at any time): the **fast track** (the participant does the console steps and the API key, the agent runs `make setup`, then tours modules 02 to 08) and the **guided track** (every module, step by step). Progress is a small gitignored `.workshop/progress.json` (schema in `agent-mode/README.md`), and the commands (`make check-NN`, `make status`) win when they disagree with it. | Confirmed |
| D53 | `make ch-query` and `make pg-query` (`tools/query.py`) run SQL **without a prompt**, because an agent has no terminal and `make psql`, `make ch-client`, `make notebook` and `make logs` (which follows forever) are unusable to it. `FILE=<example.sql> N=<n>` runs the query numbered *n in the file's comments* (not the n-th statement: some numbers hold two), so playbooks refer to the example files instead of copying their SQL. | Confirmed |
| D54 | **Drift control** is a test, `tools/test_agent_mode.py`: every `make` target, `check-NN`, repository path and numbered example query that `AGENTS.md`, the playbooks and the slash command name must exist; every playbook has its sections, numbered and tagged steps and a Step ids line that matches them; none tells the agent to run a command that needs a terminal. It was mutation-tested (a bad target, query number, section and tag are each caught). | Confirmed |
| D55 | **No password-shaped literal in tests, docs or notebooks** (`tools/test_no_credential_literals.py`), after GitGuardian flagged a fixture password in `tools/test_clickpipes.py` (commit `de9c934`). Tests generate fake credentials at run time. That one file is on an accepted list, by the owner's decision, and the list is not to grow. | Confirmed |
| D56 | The agent **asks before anything destructive** and never deletes Cloud resources (the participant does, in the console, in module 10's order). `make nuke-data` waits for a typed word, so the agent hands it to the participant. State an agent leaves behind is written to the progress file's `notes` (`test_order_id`, `card_gateway_broken`) so a later session cleans it up. | Confirmed |
| D57 | A committed **`.claude/settings.json` denies Claude Code reading `.env`** (`Read(./.env)`, `Read(**/.env)`), so the first golden rule is enforced and not only written. It holds in subagents and slash commands and cannot be overridden by an allow rule. Not used: `Read(./.env.*)` (it matches `.env.example`), Bash rules such as `Bash(* .env)` (they would block `cp .env.example .env`, which the playbook has the agent run; the Read rule already covers `cat`, `head`, `tail` and `sed` on that path), and the sandbox (it changes how Bash is prompted for everyone). Limits, from the docs: it applies only when Claude Code starts in the repository root, a script that opens the file itself is not caught, and a participant can edit the file locally. | Confirmed |
| D58 | **`docs/data-dictionary.md` is the one reference** for every table and column across the three databases, the `event_name` catalogue with what each `se_*` field holds, the join keys, and the rules a query must follow. It was checked against live data, and `tools/test_data_dictionary.py` fails if a table or column in `sql/` is not described (mutation-tested). It is the raw material for the agent's instructions. | Confirmed |
| D59 | **Module 09 is a draft written from the ClickHouse documentation, and what the documentation does not say is marked `TODO(owner)` and not assumed**: how an agent reaches the service's data (built-in tool or MCP server), which database role it uses, whether that is read-only, trial availability, and the exact permission label. The agent's instructions and questions are outlines headed `TODO(owner): co-author`; no final prompt was written. | Open: owner verifies in the console |
| D60 | **Prices and order totals are USD** (the catalogue, `orders.total_amount`, `order_items.unit_price`, the checkout events' `se_value`); the storefront only converts for display (`pt` as BRL at 5.4, `es` as MXN at 18). `credit_card_transactions.bill_value` is in the card's own currency and is never summed across currencies. Stated in the dictionary because an agent will otherwise assume BRL. | Confirmed |
| D61 | The module 06 card-anomaly query counts a negative `bill_value` **on expenses only**: chargebacks are negative by design (97 % of them), and counting them gave 68,741 "anomalies" against about 4,450 for every other kind. The background traffic also has a baseline of about 2.6 % negative legitimate expenses, so that column reads a little high; the shop's own `merchant_name = 'ClickShop'` rows are exact. | Confirmed |
| D62 | **One agent, `clickshop-analyst`, covers the four workstreams** (observability, web analytics, payments, retail operations), written from the owner's four example prompts. The instructions are the rules and the discipline; **the data dictionary is attached as file context** and is the source of truth for columns and meanings. It replies in English, Spanish or Brazilian Portuguese (the default when unclear is one standalone line in the LANGUAGE section: Brazilian Portuguese, which the owner will switch to Spanish for the first run of the workshop). It is restricted to a list of tables and to an organization and service id (`<ORG_ID>`, `<SERVICE_ID>`, filled in by the owner). Differences from the examples, all deliberate: the tables that do not exist in the workshop (`funnel_per_second`, `ingestion_throughput`, `pgcdc_retail_db`) are replaced by the real ones (`retail_oltp`, the `analytics_*` rollups); the replicated Postgres data **may** be used for transactional questions (the example said not to unless asked, but revenue and stock need it); the Mastercard BIN range is 51 to 55, not 51 to 54; revenue defaults to orders that are not `pending` or `cancelled`, and every revenue figure carries a remark saying so, in three languages (the owner's request); empty results are checked for staleness before being reported as zero. | Draft: owner reviews |
| D63 | A command that needs the cluster **says so in one line** instead of showing a kubectl error about `localhost:8080`: `need-cluster` and `need-app` guard every Makefile target that uses it, a test fails for a new target that does not, `check-05` and `check-06` stop with the fix when there is no cluster, and `make traffic-stop`, `generators-stop` and `sim-stop` succeed when there is nothing to stop. | Confirmed |
| D64 | `check-03` accepts a difference that the **last two minutes' writes** explain (the pipe's sync interval is 60 s), so it does not flake while the shoppers run; a check that fails while a participant is waiting for something now says what to run, with `hint`. | Confirmed |
| D65 | **Phase 10's dry run was done without a second machine or a second agent**: a fresh clone of GitHub's `main` taken through `make prefetch` (built with no cache), `make setup`, the checks and module 08's exercise, plus two independent read-only readers (one as a first-time participant, one as the guide agent) who saw only the texts. What that cannot replace, and is still the owner's: a clean machine, a fresh organization with new services, and a human timing the console steps. | Confirmed |
| D66 | `workshop/FACILITATOR.md` is the facilitator guide (pre-event checklist, network needs, timings, a rehearsal record, common failures, a light and a full reset). Everything only the owner can answer is a `TODO(owner)` and is listed at its end. The human guide has a drift test like agent mode's, and the shell scripts have a static test for what macOS's bash 3.2 lacks. | Confirmed |
| D67 | **Three short commands for the local stack**, asked for by the owner: `make up` (the cluster, the images, the secrets and the application: the old `make cluster images secrets app`), `make traffic-start` (the live generators and the browser shoppers together, the counterpart of `make traffic-stop`; `USERS=4` sets the shoppers) and `make start` (both). The separate commands stay, because the modules teach them one at a time, and every message that tells a participant what to run now names the short ones. Measured: `make start` from a stopped state 113 s (21 pods); `make traffic-start` 7 s; `make up` on a running cluster 24 s and changes nothing. | Confirmed |

## Bootstrap log (Phases 0 and 1)

### Phase 0: starting point

- **The folder was not a git checkout.** It had no `.git`, and the root dotfiles (`.gitignore`,
  `.dockerignore`, `.env.example`) were missing — what a `cp -r *` copy produces, since the shell
  glob skips root dotfiles but keeps those in subdirectories. So there was no `aa27c3a` to check
  with `git log`, and no history to wipe.
- **Checked against the source instead.** Compared with the tracked tree of `clickhouse-ecommerce-demo`
  at `aa27c3a` (its HEAD, clean): zero content differences in every common file. Only the three
  root dotfiles and `Prompt.md` were absent. The three dotfiles were restored verbatim from the
  tracked blobs (`git show aa27c3a:<file>`), so no untracked or ignored file of the source was read.
  `Prompt.md` is in the Phase 1 delete list anyway.
- **No credential files present** (§2 rule 2). 947 source JPEGs are present under
  `assets/product_images/` and ignored.
- **Deviation from Phase 0 (owner's instruction): no import commit.** The plan makes the raw clone
  the root commit and lands Phase 1 as a reviewable PR. The owner chose to make the first commit
  only once Phase 1 is complete. Consequences: the root commit is the *pruned* tree, so the prune
  is not reviewable as a diff against an import; and there is no Phase 1 branch or PR. History was
  initialised with `git init -b main`, and `origin` is the owner's new GitHub repo.
- **The implementation plan is not committed.** It lives in `base_contents/`, which is explicitly
  gitignored. References to "the plan" and its phase numbers in this file point at that local copy.
- **Baseline on the unpruned tree** (Node 26.0.0, Python 3.14.3):

  | Check | Result |
  |---|---|
  | `npm ci` | passes (87 audit advisories, not addressed) |
  | `npm run build` | exit 0. The log shows `ECONNREFUSED` to ClickHouse/Postgres during static generation (no databases reachable); it does not fail the build |
  | `python -m pytest data-generators` | 3 passed (`test_session_backend.py`, deleted in Phase 1) |
  | `npm run lint` | **fails**: upstream has no ESLint config, so `next lint` stops at an interactive setup prompt |

### Phase 1: findings and judgment calls

- **ESLint config added** (`frontend/.eslintrc.json`, `next/core-web-vitals`, the "Strict" option
  `next lint` offers). The plan requires `npm run lint` to pass, but it could never pass upstream.
  Two `eslint-disable` comments naming `@typescript-eslint/no-explicit-any` were removed from
  `src/lib/postgres.ts` and `src/instrumentation.ts`: that plugin isn't loaded under this config,
  and one comment sat seven lines away from the `as any` it was meant to cover. The
  `next/typescript` preset was tried and rejected: it flags three existing issues
  (`api/search/text/route.ts`, `FlightLayer.tsx`, `instrumentation.ts`), two in code that Phases 3
  and 5 rewrite.
- **Simulator backend-mode removal pulled forward from §4.3.** Phase 1 deletes `session_backend.py`
  and `cc_sink.py`, but `simulate.py` imports both, so the simulator could not start. The plan's
  Phase 1 gate (every Python entry point imports) and its Phase 4 split contradict each other.
  Done now: only the "Remove backend mode" bullet (backend imports and runner, httpx client,
  `--snowplow-url`/`--mode`, `entrypoint.sh` lines, httpx/Kafka requirements, `_report_capacity`
  defaults), plus what that left dead (`--insecure`, `_env_bool`). The rest of §4.3 (follow the
  plan, selectors, identity, stats, laptop defaults) is still Phase 4.
- **`plan_session` fraud `profile` path removed** with no behaviour change: 9,000 sessions across
  3 seeds are identical to the original, including generated order ids.
- **`search.textMode` i18n key also removed.** It is not in the plan's list, but the mode tablist
  that used it is gone. Key parity across en/pt/es was checked.
- **`LatentField.tsx` kept.** It is under `components/home/` (not `components/search/`) and still
  drives the hero. Only the search page's image-mode overlay was removed.
- **`/api/search/text` still calls `/v1/journeys/search`**, which no longer exists in the demo-service
  topology (D10). The call can't break search (`postStorefrontJourney` swallows errors), but it
  will show as a failed span until Phase 3.1 removes it.
- **Root `.env.example` is a deletion-only interim.** It lost every block for a deleted component
  and now defaults `CARD_GATEWAY_DOWN=false` (D16). Phase 5.4 owns the real layout.
- **Phase 1 grep gate.** The pattern in the plan was run over the tree. The remaining hits are not
  all "intentional text", because the plan keeps files through Phase 1 that it rewrites later.
  Each hit falls in one of these groups:

  | Group | Where | Resolution |
  |---|---|---|
  | False positives | CSS/canvas `clip`, GLSL `vec2` (`LatentField.tsx`, `Aurora.tsx`), product text in `assets/catalog_details/catalog.json` | none needed |
  | Kafka producers | `data-generators/kafka/producer/**` | Phase 4 (move and rewrite) |
  | Frontend image config | `frontend/Dockerfile`, `frontend/next.config.js` (Caddy/CloudFront args) | Phase 2.3 |
  | Old seed and migrations | `scripts/seed/**`, `scripts/migrations/clickhouse/{005,007}` | Phase 2 (replaced by `sql/` and `tools/`) |
  | Old docs | `README.md`, `data-generators/README.md` | Phase 7 |

- **Not run, not applicable yet:** `helm lint` / `helm template` (no chart until Phase 5; `helm` and
  `k3d` are not installed on this machine), and Python tests (the only test file was deleted with
  backend mode).

## Phase 2: data layer

### Verify results

- **Refreshable MV, non-APPEND, with a `TO` table.** Each refresh atomically replaces the target:
  its table UUID changes (an `EXCHANGE`), and the text indexes are built on the new data. Checked
  with CDC-style changes (a stock update, a delete, a rename, a new product): after
  `SYSTEM REFRESH VIEW` all four showed up, a new term was found through `idx_search_en`
  (`EXPLAIN indexes = 1` lists it under `Skip`), and the refresh took 33 ms for 978 rows.
- **Text index (ClickHouse 26.9.19.9):** the syntax in the plan works as written.
  `hasAllTokens` and `hasAnyTokens` apply the index preprocessor to the term, so `USB-C`, `RUNNING`
  and `tênis` need no special handling. `system.view_refreshes` has no `refresh_count`; the
  columns are `view, status, last_success_time, last_success_duration_ms, last_refresh_time,
  next_refresh_time, exception, progress, read_rows, written_rows, ...`.
- **Accent folding is possible in the preprocessor** (the plan's condition for doing it):
  `lower(replaceRegexpAll(normalizeUTF8NFD(col), '\\p{M}', ''))`. "tenis" and "tênis" both return
  192 products; "CÁMARA" finds "cámara".
- **`products_search` row count.** `count()` is 978 (every non-deleted product), not the active
  count: the table keeps `is_active` as a column and readers filter on it. Active products: 887.

### Findings and judgment calls

- **Category hero `148` has no source image.** The plan requires `148.webp`, but there is no
  `image_148.jpg` (31 catalogue entries have no photo). IT Accessories now uses **605** ("Voxa
  Webcam", 1408x768 like the other heroes), set in `frontend/src/lib/constants.ts`.
- **Duplicate SKUs** (D23). Dropping `UNIQUE` would have let the data weaken the schema.
- **`is_active`** is `NOT flagged_for_deletion AND image exists`: **887 active** of 978 products.
  61 entries are flagged (60 of them have an image) and 31 have no image; 31 products point at
  `product-placeholder.svg`. Those 61 flagged entries are also the ones with no pt/es text; their
  locale columns are NULL and the frontend falls back to English.
- **Historical orders are never `pending`** unless they are under an hour old (D15). The plan only
  says "weighted statuses"; keeping the old 10% pending would have started the table with ~200
  orders stuck since last year.
- **Seed is deterministic.** Two builds (`pg-setup`, then `pg-reset`) hash identically. Prices,
  stock, customers and orders all derive from `SEED_RANDOM_SEED` (default 42) and the id.
- **Dropped three redundant indexes** from the old schema (`idx_products_sku`, `idx_stock_product`,
  `idx_customers_email`): each duplicated the index behind a `UNIQUE` constraint.
- **`postgres.ts` search_path hook removed here, not in Phase 3.2.** With D13 (database `clickshop`,
  schema `public`) the hook ran `SET search_path TO "clickshop"`, a schema that does not exist, so
  nothing could be read. Phase 2's "images render locally" check needs it gone.
- **`LIVE_FEED_QUERY` never used `FINAL`**: it reads `products_search` with `any(name) ... GROUP BY`.
  Only the text-search route and the web producer's `load_catalog()` had one; both are fixed.
- **`.env` handling** (D27). In the plan's `.env.example` layout, `KEY=   # comment` puts the comment in
  the value for both `docker --env-file` and make, and `include .env` would break a password
  containing `$` or `#`. The final `.env.example` is written to the §5.4 layout with comments on
  their own lines, and Phase 5 should keep reading `.env` as `--env-file` / `--from-env-file`
  rather than through make or a shell `source`.
- **`clickshop-tools` image is 391 MB** (Python 3.12, `psql` 17, pinned libraries). Phase 5.2 lists it
  among the images to `k3d image import`; it is only used through `docker run`, so it probably
  does not need importing.
- **Interim files removed.** `scripts/seed/` and `scripts/migrations/` are gone; `sql/` and `tools/`
  replace them. Old READMEs still point at the old paths until Phase 7.

### What was verified, and how

All of Phase 2's data checks ran against **local test containers** (Postgres 18, ClickHouse 26.9),
because no root `.env` with Cloud credentials exists yet. Local runs covered: `make pg-setup`
(run twice, then `pg-reset`), `make ch-bootstrap` (twice), `make ch-search` (twice), `make ch-mvs`
(twice, with a backfill that did not double count), every statement in `sql/clickhouse/examples/`,
the splitter's unit tests, and the frontend (`npm run dev`) reading the seeded data.

**Not verified yet (needs the owner's Cloud service and Managed Postgres in `.env`):**

- `make pg-setup` and `make ch-bootstrap` against Managed Postgres and ClickHouse Cloud, including
  the direct endpoint on port 5432 and the TLS defaults.
- The columns and types a real Postgres CDC ClickPipe creates in `retail_oltp`. The test used a
  simulation of the documented shape (`ReplacingMergeTree(_peerdb_version)`, `_peerdb_is_deleted`,
  non-nullable types). `10_products_search.sql` casts every column, so small type differences
  should not matter, but run `SHOW CREATE TABLE retail_oltp.products` after the first pipe.
- That the wizard accepts a pre-created `retail_oltp` database (D24).
- `SELECT version()` on a fresh Cloud service is 26.2 or newer.

## Phase 3: application changes

### Verify results

- **ClickHouse Cloud is 26.6.1**, one version behind the 26.9 used for local tests. The `text` index,
  the refreshable MV, and accent folding in the preprocessor all work there (checked in a scratch
  database, then again with the real data).
- **Managed Postgres is 18.6**, TLS 1.3. `verify-full` against the instance's CA bundle works, for
  both the Python tools and the `pg` driver in the frontend; a wrong CA is refused with
  "certificate verify failed". The bundle holds two self-signed roots (5 and 10 years).
- **ClickStack collector `2.41.0`** is what `latest` points at today, and is pinned. Its migration
  creates the ClickStack tables in `retail_otel` on Cloud, and traces and logs sent through it
  land there. `HYPERDX_OTEL_EXPORTER_TIMEOUT` (30 s in the image) is read by 2.41.0 but **not** by
  2.19.0, which hard-codes 5 s. The exporter takes its database from
  `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE`, not `CLICKHOUSE_DATABASE`; `entrypoint.sh` keeps the
  two in step. The `memory_limiter` is 1500 MiB, so the pod needs at least 2 GiB.
- **Snowplow Micro `4.6.1`** (what `latest` is today) is the version to pin in the chart, run with
  `--yauaa`. YAUAA output is in `derived_contexts` (`iglu:nl.basjes/yauaa_context/jsonschema/1-0-5`),
  not `contexts`. Micro validates the atomic schema, so `sid` must be a UUID, and its GET endpoint is
  `/i`.
- **An empty-token needle matches nothing** in `hasAllTokens` / `hasAnyTokens` ("---", "!!!", " "),
  so the search route needs no guard for it.
- **Managed ClickStack (Cloud console):** *not verified.* Which database and sources the UI expects,
  and whether Logs/Traces/Metrics/Sessions sources over `retail_otel` must be created by hand,
  are console questions for the owner (module 08).

### What the checks showed

- **Checkout, through the API against Managed Postgres (38 checks):** pix, boleto and card orders are
  confirmed with the right method; totals are priced from `products`, not the client; the customer
  is upserted by email; a sold-out product returns 409 and rolls everything back; two shoppers
  racing for the last unit give exactly one winner and stock never goes negative; bad input gives
  400/409; a failed payment journey (pix gateway stopped) leaves the order `cancelled` and restores
  stock; the card gateway outage still declines at authorize.
- **Real browser (Chromium, production build):** all three methods complete and the confirmation
  page shows the order number. The order id is in `snowplow_events.se_property` for
  `checkout_payment_confirmed`, with the same visitor id, method and total as the Postgres order.
  One trace carries `clickshop.order_id` from the frontend through bff, checkout, payment, gateway,
  order, ledger and email.
- **Search (against the real catalogue):** `usb-c` now works; `TÊNIS` and `tenis` both return 192;
  `running keyboard` falls back to partial matches; zero results are clean; sold-out products
  sort after in-stock ones and show the badge. Each search is a `search.products` span with the
  planned attributes and its `clickhouse.query` spans nested under it.
- **Device columns** are filled from YAUAA and use the producer's vocabulary: `Chrome`,
  `Mac OS X`, `Computer`.

### Findings and judgment calls

- **The bridge was losing browser events (D29).** The plan accepts that events
  arriving between `GET /micro/good` and `POST /micro/reset` are lost, but it reset *after* the
  insert, and against Cloud the insert takes over a second (async insert, 1 s busy timeout). In the
  one session measured before the fix, the browser sent 9 events and 6 landed (the add-to-cart, the
  cart page view and `payment_initiated` were wiped). Now the bridge fetches, resets at once, holds the
  events in memory and retries the insert; 81 of 81 events landed across 9 overlapping sessions.
  Unit-tested (`snowplow-bridge/test_main.py`).
- **Duplicate `cart_add_to_cart` events.** When a page is left right after a click, the tracker
  re-sends its unconfirmed queue after the next page load, so the same `event_id` can arrive twice
  (8 seen, all add-to-cart, 30-80 ms apart). This is the tracker's at-least-once delivery, not the
  bridge. `snowplow_events` is not deduplicated; counts can be inflated slightly when a session
  clicks and then does a hard page load.
- **`checkout_start` does not fire on a hard load of `/checkout`:** the cart is restored after the
  effect that tracks it. A shopper arrives by client-side navigation, so it fires for real users.
- **Cart is lost on a hard navigation under `next dev`** (React StrictMode runs the persist effect
  before the hydrate effect has read `localStorage`). Production is unaffected, so the check ran on
  the production build. Not changed here; it matters for `make dev-frontend`.
- **Module 08 filter:** use `search.total = 0` to find searches that found nothing. `search.results = 0`
  also matches a page past the end of a search that has results.
- **Frontend and component config now reads the shared variables.** `CLICKHOUSE_URL` became
  `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` (TLS unless the host is local or `CLICKHOUSE_SECURE=false`),
  the bridge's `CLICKHOUSE_DB` became `CLICKHOUSE_DATABASE`, and `OTEL_AUTH_HEADER`,
  `OTEL_MIGRATION_USER` / `PASSWORD` and `SKIP_MIGRATION` are gone (one user, no auth header). The
  other variables the plan listed for removal were already gone with Phase 1.
- **Chart-internal variables** (set by Helm in Phase 5, not in `.env.example`): `CLICKHOUSE_DATABASE`,
  `STOREFRONT_BFF_URL`, `SNOWPLOW_MICRO_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_COLLECTOR_METRICS_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SNOWPLOW_APP_ID`, `PGPOOL_MAX`,
  `POLL_INTERVAL_SECONDS`, `CLICKHOUSE_TTL_DAYS`, `HYPERDX_OTEL_EXPORTER_*`, `DEMO_*`,
  `CARD_GATEWAY_*`. `HOSTNAME=0.0.0.0` for the frontend pod is also Phase 5.
- **Demo-service** now has a `MeterProvider` (FastAPI request metrics reach ClickStack) and sets
  `clickshop.order_id` and `clickshop.payment_method` from the payload.
- **The search hint text** said "skip indexes"; it now says "full-text index" in all three locales.

### Carried into Phase 4

- The simulator waits for `**/checkout/confirmation`, which no longer matches: the URL is
  `/checkout/confirmation?order=<id>`.
- The simulator should reach `/checkout` by clicking through from the cart, not by loading it, so
  `checkout_start` fires and the cart survives.

### Not verified yet

- **CDC end to end with a real ClickPipe.** None exists yet, so `products_search` on Cloud, search
  freshness after an order, and `make ch-search` on real CDC tables are untested. Search was checked
  against a scratch copy of the real Postgres data built with the real `10_products_search.sql`.
- Managed ClickStack in the console (above).

## Phase 4: generators and simulator

### Phase 2 and 3 follow-ups, now verified on the real pipe

- **Real ClickPipe tables** match what the tests simulated: non-nullable types (so "Preserve NULLs"
  off works), `Bool`, `Decimal`, `DateTime64(6)` without a timezone, `_peerdb_is_deleted UInt8`,
  `_peerdb_version UInt64`, engine `SharedReplacingMergeTree`. `make ch-search` ran twice on them:
  978 products (887 active), text index used, refresh scheduled.
- **CDC lag is about 31 s** each way on the pipe as the owner created it. The plan suggests a 10 s
  sync interval for module 03; that is a pipe setting. A row's `_peerdb_version` is `0` after the
  initial load and a large LSN-derived number after a CDC change; `count()` is 2 without `FINAL`
  and 1 with it for a row that changed once.
- **Managed ClickStack:** the owner launched it and chose `retail_otel`. The collector writes the
  standard ClickStack tables there, and both OTLP ports (4317 gRPC, 4318 HTTP) are served by the
  image with no extra configuration.
- **Browser telemetry works.** The HyperDX SDK logs "apiKey is empty string, telemetry will not be
  saved", but with no auth on the collector it does save: a simulator run produced browser spans
  (`HTTP GET`/`POST`, `click`, `resourceFetch`) and 7,910 session-replay rows across 72 sessions.
  The demo-service request metrics from Phase 3 arrive too.

### What the checks showed (against the owner's Cloud service)

- **Web producer, default live rate:** 11 inserts into `snowplow_events` in 42 s (about one every
  4-5 s, well inside "about 1 per second per table"), ~900 rows each, 14x smaller on the wire,
  ~350 ms each, and the server's `written_rows` matched.
- **Backfill** (`EVENT_MODE=mixed`, 30 days, process mode, 2 workers, flat out): **1,002,158 events in
  22 s** (about 40k events/s) as **12 inserts, median 100,000 rows**. The plan's 5M events would take
  under two minutes. The card producer flat out: 403,000 transactions in 6 s as four 100k inserts.
- **The generated data holds together:** 31 days of history; purchases split card 2,087 / pix 1,249
  / boleto 822; every card purchase joins to a card transaction by `toUUID(se_property)` and no pix
  or boleto purchase does; all 887 products referenced exist in `products_search`; anomalies are
  present in the card data.
- **`make ch-mvs` on 1,010,588 real events:** the rollups equal the raw counts exactly.
- **Simulator, 10 minutes, laptop defaults** (second run, after the fixes below): 49 sessions,
  **16 orders (card 7, pix 4, boleto 5), none failed.** Across both runs the simulator placed 18
  orders, every one `confirmed` with a browser id, from 18 distinct customers. **Stock fell by
  exactly the units ordered** (20 units on 16 products), CDC was in sync (2,018 orders both sides),
  and all 18 orders joined to their `checkout_payment_confirmed` event by `toString(o.id) =
  se_property` with the same method, visitor and total. The device columns carry real mobile and
  desktop browsers.
- **The dashboard moved:** the payments tile gained +7 card, +4 pix, +5 boleto confirmations since a
  mid-run snapshot, funnel completions went 2,131 to 2,147, and the 17:00 revenue bucket showed the
  simulator's 17 orders.
- **The simulator image** (2.84 GB, the Playwright Python base) ran for 90 s in a container.
- **`make test`:** 40 tests (8 tools, 11 bridge, 21 generators), run in their own images.

### Bugs the live run found

- **Every card payment was counted as declined.** The simulator waited for the confirm button *or*
  `[role='alert']`, but Next.js keeps a hidden `role="alert"` route announcer on every page, which
  matched at once while the card was still being authorised. Only boleto and pix, which show the
  confirm button immediately, went through. The checkout's own error messages now carry
  `data-testid="checkout-error"`.
- **The same search twice in a row hung the session.** The plan can pick the same term twice; the
  header bar then submits the URL it is already on, so no search response ever arrives. The
  simulator skips a repeated term. Session errors now say which step failed.

### Findings and judgment calls

- **Workshop funnel (D30).** The acceptance test (all three payment methods within 10 minutes) cannot
  pass at the shared funnel's 2.5% conversion. About one session in six now ends in an order.
- **Capacity (D31).** The simulator estimates its own need (Little's law, plus ~12 s of page loads).
  At dwell scale 0.2 a session took ~60 s, so 6 a minute needed ~6 browsers; at 0.1 it is ~35 s and
  ~3.6 browsers, which makes "4 browsers, 6 a minute" true. The diurnal curve's 2.94x evening peak
  would need ~17 browsers, so it is off by default.
- **Catalogue coverage.** A category page shows the 12 cheapest products, so shoppers that only
  pick visible products would buy the same dozen forever. The simulator pages deeper (45% of
  product picks come from page 2 or beyond). The items bought have a median price of $86.94
  against a catalogue median of $250.29, and reach $450.
- **Language.** Sessions use en-US / pt-BR / es-MX (40/40/20) and search in that language (the 20
  planned terms are translated by position). An English term on a Portuguese page mostly finds
  nothing. 5,000 deterministic shoppers (the email carries the pool index) make the `customers`
  table grow like a store's: new people at first, more repeat customers over time.
- **Sold out** is detected by the absence of the `add-to-cart` button (the sold-out button is a
  different, disabled one); a 409 from checkout is read from the API response, not a URL wait.
- **Reaching the cart and checkout by clicking** keeps the cart and makes `checkout_start` fire (the
  Phase 3 findings); the simulator also waits for `/checkout/confirmation?order=<id>`.
- **One writer per table per process** (D3 in the plan). Threads in a process share it; each worker
  process has its own. Synchronous inserts by default; `CH_ASYNC_INSERT=1` opts in to async.
- **Payment method weights** are card 0.50, pix 0.30, boleto 0.20 (`PURCHASE_PIX_SHARE` is gone).
- **Producers' defaults:** 200 events/s and 20 transactions/s, 2 worker threads, `PRODUCE_SITE_URL`
  `http://localhost:3000`. They read `CLICKHOUSE_USER` (not `_USERNAME`) with the same TLS rule as
  the other components. `python-dotenv`, `confluent-kafka` and `boto3` are gone.
- **`make pg-reset` must not be used once the ClickPipe exists.** TRUNCATE is not replicated, so
  ClickHouse would keep the removed rows. To clean up after a test, delete the extra rows and
  restore the stock with UPDATE (both replicate). (Phase 5's `nuke-data` was meant to clear the
  ClickHouse side as well; the owner ruled that out, see D42.)
- **Not done:** bumping the Playwright base image from 1.44 (it works), and running any of this in
  k3d (Phase 5).

### Carried into Phase 5

- Backfill Job: `EVENT_MODE=mixed BACKFILL_DAYS=30 PRODUCE_MAX_EVENTS=5000000
  PRODUCE_WORKER_MODE=process PRODUCE_WORKERS=<n> PRODUCE_TARGET_EPS=0`; the card producer needs
  `CC_WORKER_MODE=process CC_TARGET_TPS=0 CC_WORKERS=<n>`. Set the worker counts explicitly: pods
  see the node's CPU count.
- Generator variables set by Helm, not in `.env.example`: `PRODUCE_*`, `CC_*`, `CH_*`, `EVENT_MODE`,
  `BACKFILL_*`, `SIM_URL`, `SIM_DURATION`, `SIM_DIURNAL`, `SIM_REALISTIC_FUNNEL`, `SIM_HEARTBEAT`,
  `SIM_DRAIN`, `SIM_SEED`. (`PRODUCE_TARGET_EPS`, `CC_TARGET_TPS`, `SIM_SESSIONS`,
  `SIM_ARRIVALS_PER_MINUTE` and `SIM_DWELL_SCALE` are in `.env.example`.)
- The simulator needs about 300 MB per browser plus the Chromium base, and its image is 2.8 GB, so
  `k3d image import` of it is slow; the producers image is 260 MB.

## Phase 5: k3d platform

D32 to D41 above are the decisions. This section records what was checked on the real services
(the owner's ClickHouse Cloud 26.6.1 and Managed Postgres 18.6) and what went wrong on the way.

### Tools and versions

- **k3d 5.8.3, Helm 3.19.0, kubectl 1.33.9, k3s v1.33.5-k3s1**, all run from containers
  (`deploy/bin/{k3d,helm,kubectl}`, pins in `deploy/versions.env`). The answer to "do we install k3d
  and helm?" is no: Docker and `make` are the only prerequisites. k3d needs the Docker socket; helm
  and kubectl join the `k3d-clickshop` network and reach the API server at
  `https://k3d-clickshop-serverlb:6443`, whose certificate is valid for that name.
- k3d's two helper images (`k3d-tools`, `k3d-proxy`) default to `latest`; the wrapper pins them to
  5.8.3 through `K3D_IMAGE_TOOLS` and `K3D_IMAGE_LOADBALANCER`.
- **Collector 0.123.0 and chart 0.122.5.** The ClickStack guide pins the image and leaves the chart
  unpinned (so it installs today's chart, 0.176.0, built for collector 0.162). 0.122.5 is the last
  chart built for the 0.123 generation. The guide's own values files are the basis of
  `deploy/helm/otel-k8s/*.values.yaml`.
- `clickhouse/clickstack-otel-collector:2.41.0` (the gateway) is what `latest` pointed to when it
  was pinned.

### Verified, from a fresh cluster

- `make cluster images secrets app` on a fresh cluster took **2 minutes 23 seconds** with Docker's
  layer cache warm; 18 pods Ready (14 demo services, frontend, Micro, bridge, gateway) plus the
  node collector on each of 3 nodes and the cluster collector. `make check-05` passes: Traefik
  serves the storefront on `localhost:3000`, `/api/categories` comes from Postgres, search comes
  from ClickHouse, Micro answers through the storefront.
- **Kubernetes attributes (5.6).** Every span from the 14 demo services carries `k8s.pod.uid`,
  `k8s.node.name`, `k8s.namespace.name`, `k8s.deployment.name` and `k8s.pod.name`; so do the
  frontend's server spans and the bridge's. A checkout trace crosses 8 services: frontend,
  storefront-bff, checkout-svc, a payment service, its gateway, order-svc, ledger and email.
- **The Verify item on metric names is settled.** At collector 0.123.0 the kubelet receiver emits
  `k8s.pod.cpu.utilization`, `k8s.node.cpu.utilization`, `k8s.pod.memory.usage`,
  `k8s.node.memory.usage`, `k8s.pod.filesystem.available`, `k8s.node.filesystem.available`, and the
  `*_limit_utilization` / `*_request_utilization` family: exactly the names in HyperDX's Kubernetes
  dashboard (`KubernetesDashboardPage.tsx`) and its infrastructure panel. The panel also matches
  the newer `.usage` names (`otelSemanticConventions.ts` maps both, threshold 0.125.0), but the
  dashboard queries the old ones, which is why the collector is not newer. All of them landed in
  `retail_otel.otel_metrics_gauge` from all 3 nodes. `k8s.pod.cpu_limit_utilization` is absent
  because the pods have a memory limit but no CPU limit (the dashboard's CPU-limit column stays empty).
- **`service.name` from the pod label** reaches the metrics (pod metrics are stored under
  `demo-<role>`, `retail-demo-frontend`, `snowplow-micro`, `otel-gateway`, ...) and the stdout logs
  of the pods that only print (producers, bridge, Micro, gateway, simulator as `loadgen`, backfill).
- **No duplicate logs.** Frontend and demo-service logs arrive over OTLP only (0 stdout copies out
  of 70 rows); the node collector's filelog still carries the pods that only print.
- **Backfill Job:** 5,001,949 events (847,800 sessions, 20,412 orders, 10,027 card transactions) in
  1 min 43 s, as 100,000-row inserts of ~7 MB on the wire, 48,000 to 77,000 events/s.
- **Live generators** start and run (200 events/s, 20 transactions/s): `make generators-start` takes 3 s.
- **Resource budget:** all four containers (3 nodes and the load balancer) together use **3.3 GiB**
  with the generators and the simulator running, so the plan's 4 GB holds. Largest pods: Snowplow
  Micro 474 MiB, simulator 269 to 626 MiB (4 browsers), frontend 90 MiB, the gateway 73 MiB, each
  node collector 60 to 90 MiB, a demo service 40 to 50 MiB.
- **Fault exercise:** `make break-card-gateway` makes the gateway answer
  `502 {"error":"card_gateway_unavailable","retryable":true}` after 1.5 s; the span is an error and the
  log line `journey failed role=card-gateway ... status=502` is in `otel_logs` as `demo-card-gateway`.
  `make fix-card-gateway` brings it back. The failure shows in four services on the path (card-gateway,
  payment-card-svc, checkout-svc, storefront-bff) as error logs and error spans, and the simulator's
  `failed` counter rises only while the gateway is down.
- **The plan's check "log search finds `card_gateway_unavailable`" did not hold at first**: the logs said
  only `status=502`, the code was in no log body. The demo services now log `error=<the downstream's
  answer>`, so the code is in the logs of all four services. Note for module 08: `_` is a separator for
  ClickHouse's tokenizer, so `hasToken(Body, 'card_gateway_unavailable')` is an error and the text
  index search is `hasAllTokens(Body, 'card gateway unavailable')` (4 rows in the check run); a
  substring `ILIKE` finds it too.
- **`make nuke-data`** (final version, D42), against the real pipe: it waited for the pipe to be in
  step, emptied the 6 `retail_oltp` tables, reseeded Postgres, and the pipe re-ingested all of it
  from empty (orders 0 of 2,000 at the first check, in step about 30 s later) in **53 s in total**,
  then rebuilt `products_search` (978 rows). Row counts of all six tables and the total stock match
  Postgres; the pipe's own `_peerdb_raw_mirror_...` table was kept. The first version had restored
  Postgres with DELETE and UPDATE and emptied 17 ClickHouse tables, including the events and telemetry;
  see the mistake below.

### Bugs the live run found

- **`k3d image import` reports success when it failed.** Every node answered `ctr: content digest
  sha256:... not found`, and k3d still printed "Successfully imported" and exited 0, so the pods sat
  in ImagePullBackOff (D33). It is the containerd image store (Docker 29, OrbStack, and Docker
  Desktop's current default): `docker save` writes a multi-platform index whose other platforms are
  not in the archive. The fix is `docker save --platform linux/<arch>` and a check on every node.
- **A full Docker disk takes the whole cluster down (D34).** The Docker VM's disk was 96% full (most
  of it other projects' images); all three kubelets reported DiskPressure, tainted their nodes and
  evicted pods (one Deployment left 40 Evicted pods behind). At 85% they also garbage-collect
  the imported images. `make doctor` now checks free disk, and `make images` refuses to start an
  import that cannot fit.
- **Helm turned `5000000` into `5e+06`** in the backfill Job; the producer's `int()` rejects that and
  would have run forever (`PRODUCE_MAX_EVENTS=0`). The values go through `int64`.
- **The Job went to the `default` namespace:** `helm template` does not stamp a namespace and
  `kubectl apply` needs `-n`.
- **`kubectl set env` and `helm upgrade` cannot share an env var.** The chart declared
  `CARD_GATEWAY_DOWN` with a `secretKeyRef`; after `kubectl set env` made it a plain value, the next
  `helm upgrade` failed (`valueFrom may not be specified when value is not empty`), which would have
  broken `generators-stop`, `sim-stop` and `app` for anyone who had broken the gateway. The switch is
  now a chart value (`cardGatewayDown`), set by `make break-card-gateway` through
  `helm upgrade --reset-then-reuse-values`; an unrelated upgrade afterwards keeps it.
- **The frontend's readiness probe took the storefront down with Postgres.** It queried
  `/api/categories`; whenever Postgres was slow the single pod left the Service, and a Service with no
  endpoints refuses every request, static pages included. The simulator saw it as
  `ERR_CONNECTION_REFUSED` on `http://frontend:3000`. Readiness is now a TCP check; the database path
  is what `make check-05` checks.
- **A cached rebuild gets a new image ID** on the containerd image store (the config carries the
  build time), so comparing IDs re-imported and restarted everything on every `make images`. Layers
  plus config identify an image.
- Smaller: `trap` on a function's local variable, `docker pull` takes one image per call,
  zsh treats `=====` as a command.

### Findings and judgment calls

- **Why Chromium only (D40).** The Playwright image holds Chromium 556 MB, Firefox 218 MB and WebKit
  222 MB, and every node would hold its own copy of the 2.9 GB image (about 3 GB unpacked each).
  The new image is 1.5 GB, runs Chromium 125 (Playwright 1.44.0's build), and is loaded onto one node.
  The plan's "consider bumping 1.44" stays open: it works.
- **`clickshop-tools` is not loaded into the cluster.** Nothing in the cluster runs it; the plan
  listed it.
- **The simulator reaches the storefront as `http://frontend:3000`.** The pages use paths relative to
  their own origin (the category hero images go through `proxyImageUrl`), so the build-time
  `NEXT_PUBLIC_BASE_URL=http://localhost:3000` does not break a browser inside the cluster.
- **Deviation from the plan on the fault exercise:** `break-card-gateway` is a Helm value, not
  `kubectl set env` (see the bug above).
- **Deviation from the plan on the Secret:** the 14 demo services do not read the Secret (D35); the
  plan says all pods use `envFrom`.
- **`make doctor` and `.env`.** It reads the file as written, never sources it, and flags a scheme
  or port in a host, a quoted or commented value, CRLF line endings and the pooler port. A host is
  shown as its first three characters plus the domain; a password only as its length.
- **Postgres latency from where the owner works:** a connection takes about 0.9 s (TLS) and a query
  about 275 ms. The frontend's 5 s connection timeout is therefore not generous, and a participant
  far from the Postgres region will see slower pages.
- **A network outage mid-run.** For several minutes TCP connections to the Cloud endpoints from this
  machine took 7.6 s (ClickHouse) or timed out (Postgres), while other hosts answered in 40 ms.
  The frontend logged `pg-pool.connect` timeouts and some simulator page waits timed out. Postgres
  answered again shortly after the simulator was stopped, and showed 17 of 500 connections in use, so
  it was not a limit on the service. Whether the simulator's load had anything to do with it, and what
  was wrong on the network path, was not found out.
- **`make nuke-data` and TRUNCATE.** The ClickPipe FAQ says "TRUNCATE operations are ignored by
  ClickPipes and won't be replicated to ClickHouse": no error, but no effect either. That is why
  `make pg-reset` is unsafe with a live pipe and why `make nuke-data` empties the mirror itself, in
  an order that leaves no row behind (D42). `products_search` replaces its whole table every minute, so
  with an empty mirror search returns nothing; `nuke-data` waits for the mirror and refreshes the view.

### A mistake, and what it cost

The first `make nuke-data`, and the cleanup I ran by hand after it, emptied `snowplow_events`,
`credit_card_transactions`, the `analytics_*` rollups and every table in `retail_otel`. Earlier phases
did the same to clean up after tests. The owner's rule is that events and telemetry are tougher to
populate than orders, so a reset leaves them alone (D42). The rows are gone: `make backfill` (about
two minutes) and `make generators-start` rebuild the events, and traffic through the cluster rebuilds
the telemetry, but the history that was there before is not recoverable from here. The first fix
removed only orders and inventory from Postgres (DELETE/UPDATE) and left ClickHouse alone; the owner
then asked for the `retail_oltp` mirror to be emptied as well, since the pipe re-ingests a reseed.

## Phase 6: end-to-end acceptance

### Catalogue: only active products (D43)

- **What changed.** The catalogue (978 products) marks 211 `is_active: false` and flags 61 for deletion
  (the two overlap), and 31 products have no photo. The seed used to ignore `is_active`, so 887 products
  were active; it now honours it, so **691 are active and 287 are not**. The 256 WebPs of deactivated
  products that had one were removed from `frontend/public/images/` (947 images, 16.6 MiB, became 691 images,
  10.1 MiB), and `make images-webp` no longer recreates them. The source JPEGs in `assets/product_images/`
  are gitignored and local, so they were not touched.
- **Still seeded.** The 287 deactivated products stay in Postgres as rows with `is_active = false` and the
  placeholder image, so the catalogue ids do not shift and module 02 can show a soft-delete flag. Dropping
  them from the seed altogether would be a small change in `seed_products`; it would turn the 978-row tables
  into 691-row ones.
- **Seed output changes.** The seed is deterministic, but the products that orders and low stock are drawn from
  changed: `order_items` went from 6,041 to 5,989 rows, and the 30 low-stock products are different ones.
  Orders (2,000), customers (500) and stock rows (978) keep their counts.
- **Checked against the real services** (after `make nuke-data` reseeded them): `products_search` holds 978
  rows, 691 active; active products per category are books 157, clothing 151, electronics 147, IT accessories 177
  and **shoes 59** (the catalogue deactivated most shoes: 192 became 59, five pages of 12; the simulator pages
  "as far as it goes", so a shorter listing is fine). No deactivated row has a real image, no active row is on
  the placeholder, and no seeded order contains a deactivated product. The five category hero photos
  (ids 127, 144, 1, 605, 501) are all active.
- **Search did not lose coverage.** For the simulator's 20 terms in en, pt and es, no term that had results
  before has none now. The terms with no results are the same ones as before (eight in English, for example
  "laptop bag", "yoga mat", "smartwatch"), which module 08's "searches that returned nothing" can use.
- **The storefront**, the production image run against the real databases: the five hero images answer 200,
  `/images/101.webp` (a deactivated product) answers 404, shoes page 1 has 12 items, page 5 has 11 and page 6
  none, "sneakers" finds 2 and "hoodie" 35. A deactivated product's page renders Next.js's not-found view
  (no add-to-cart, `noindex`) with HTTP 200, because the response streams; checkout rejects it either way.
- **Not changed: git history.** The removed images are still in the history of the earlier phases. Removing
  them from history would mean rewriting merged commits, which I did not do.
- **Tests.** `make test` now mounts the repo and runs five catalogue tests (57 in all): the activity rule,
  images only for active products, no unknown image files, the hero ids exist, and every category keeps at
  least 36 active products. Putting one deactivated product's image back makes it fail.

### Acceptance run

Run on the owner's current ClickHouse Cloud 26.6.1 service and Managed Postgres 18.6 (not fresh ones, at
the owner's request), against a cluster built from scratch on OrbStack (arm64, 14 CPUs, 11.7 GiB). The
parts of the plan that need ClickStack's UI are the owner's and are listed under "Not checked".

1. **Prune.** The Phase 1 grep matches only intentional text: CSS and shader code ("clip", `vec2`),
   product wording in the catalogue, `docs/decisions.md`, one comment in `LatentField.tsx`, and the two
   READMEs that still describe the old demo (the plan rewrites them in Phase 7).
2. **OLTP.** `make pg-setup`: 978 products (691 active), 5 categories, 500 customers, 2,000 orders (5,989
   items), 978 stock rows.
3. **CDC.** All 6 tables replicate into `retail_oltp`. A change takes **30 to 32 s** to arrive (the same
   for an insert, an update and a delete). A manual SQL order shows `pending`, then `confirmed` as a second
   version: two rows without `FINAL`, one with it; a delete arrives as a row with `_peerdb_is_deleted = 1`
   and an empty status. **A storefront order cannot show `pending` first**: it is settled about 2 s later,
   the pipe delivers both changes in one batch, and ClickHouse only ever has the `confirmed` row. Module 03
   should show the two versions with a hand-made order in `make psql`, not with the storefront.
   The plan's budget is "sync interval + 15 s"; 30 s fits if the pipe's sync interval is 30 s, not the 10 s
   the plan suggests (the interval is a console setting that I cannot read).
4. **Search.** `running shoes` (5 results), `usb-c` (38), `livro` in pt (47) and `zapatillas` in es (44)
   answer without errors; a nonsense term answers 0. `EXPLAIN indexes = 1` shows the text index
   (`idx_search_en`, mode All, tokens `running` and `shoes`). `system.view_refreshes` shows
   `products_search_refresh` succeeding every 60.0 s in about 230 ms. An order's stock reached ClickHouse in
   35 s and `products_search` after `SYSTEM REFRESH VIEW` (0.6 s). `search.products` spans carry
   `search.query`, `.locale`, `.category`, `.page`, `.index`, `.match_mode`, `.partial`, `.results`, `.total`,
   `.read_rows` and `.elapsed_ms`, with nested `clickhouse.query` spans (26 in the check), and a zero-result
   search is found by `search.results = 0` (the attribute is stored as the string `'0'`).
5. **Analytics.** `make ch-mvs` 3.9 s, then the backfill: **5,001,505 events in 1 min 34 s** as 100,000-row
   inserts (50 per worker pair and two remainders). The rollups equal the raw events exactly (5,029,278 and
   2,541,597 page views, both sides). Live generators: **0.17 to 0.20 inserts a second per table**, never
   more than one in any second (the card table has two writers, so about 0.4 in total). All 15 dashboard
   charts answer for 24 h and 7 d, and the Pipeline tile reads the gateway's metrics (about 5 spans and 128
   metric points a second, none refused or failed).
6. **Simulator.** 10 minutes, 4 browsers: **12 orders (card 5, pix 5, boleto 2), none failed**, 12 distinct
   customers, 14 units sold. The join `retail_oltp.orders` x `snowplow_events` on `toString(o.id) =
   e.se_property` returns all 12, each with a visitor id and a real device's user agent.
7. **ClickStack data.** The caller-to-callee edges show 15 services and every edge of the checkout path
   (frontend, storefront-bff, catalog and checkout, pricing and inventory, the three payment services,
   their gateways, order-svc, ledger and email) and no fraud, search or embedding service. Frontend traces
   carry `pg.connect`, `pg.query:SELECT clickshop` and `clickhouse.query` spans (see the bug below).
   Session replays: 9,485 rows over the first 20 sessions. After `make break-card-gateway` (5 s), the
   error text is in the logs of four services within a minute (`hasAllTokens(Body, 'card gateway
   unavailable')` finds it) with error spans on each; `make fix-card-gateway` 4 s. Zero duplicated log lines;
   0 stdout copies of demo-service and frontend logs. Infrastructure data: 3 nodes, 45 pods, the frontend
   pod's CPU, memory and filesystem metrics, and 136 Kubernetes events.
8. **Hygiene.** None of the owner's real secret values or hosts appears anywhere in git history; the
   committed values are placeholders. `assets/product_images/` has 0 tracked files.
9. **One `.env`.** `.env.example` is the only env file tracked. `make check-env-contract` (new) lists every
   variable the code reads that is in none of `.env.example`, the chart and images, or a commented list: 84
   read, none unaccounted for. Without a `.env`, `make doctor` fails with "`.env` not found: run `cp
   .env.example .env` and fill in the required block". Setting `PRODUCE_TARGET_EPS=50` and running `make
   apply-env` (13 s) changed the producer from 200 to 50 events/s; reverted afterwards.

#### Bugs the run found

- **No `pg.query` spans.** Only `pg-pool.connect` appeared, so a trace showed connections but not queries.
  Next.js resolved `pg` (it is in `serverComponentsExternalPackages`) to its absolute file path, and the
  OpenTelemetry hook matches modules by name: it patched `pg-pool`, which `pg` requires by name, and never
  `pg`. The same packages under plain Node produced query spans, which located the cause. A rule placed
  before Next's in `next.config.js` makes the server `require('pg')`.
- **`make status` showed a future "newest" time** for `credit_card_transactions`. The rows are meant to be
  there: the card data's anomaly signal includes a "timestamp" fault dated 1 to 5 hours ahead. Freshness now
  ignores rows dated in the future.

#### Timings, for the Phase 10 dry run

Cold means Docker held nothing (its images and build cache had been cleaned out): the 4:23 below includes
every pull and every build.

| Module | Command | Time |
|---|---|---|
| 00 Prerequisites | `make prefetch`, cold | **4 min 23 s** (the simulator image alone 65 s) |
| 01 Cloud services | `make doctor` | 6 s (about 3 min the first time, which builds the tools image); `make ch-bootstrap` 3.3 s |
| 02 Postgres | `make pg-setup`, first time on an empty database | 13 s; 8 s when already seeded |
| 03 CDC ClickPipe | a change reaching `retail_oltp` | 30 to 32 s; the pipe itself is the owner's console step |
| 04 Search | `make ch-search` | 1.8 s, plus up to 60 s for the first refresh |
| 05 Run the app | `make cluster` 33 s, `make images` 51 s, `make secrets` 3 s, `make app` 24 s, `make check-05` 5 s | **about 2 min** with the images already built |
| 06 Real-time analytics | `make ch-mvs` 3.9 s, `make backfill` 1 min 34 s, `make generators-start` 3 s | about 1 min 45 s |
| 07 Simulated shoppers | `make sim-start` 16 s (it loads the 1.5 GB image), then a 10-minute run | 10 min 16 s |
| 08 Observability | `make break-card-gateway` 5 s, `make fix-card-gateway` 4 s, up to a minute for logs to show | about 1.5 min |
| 10 Cleanup | `make down` | 9.5 s |
| Any time | `make nuke-data` (waits for the pipe twice) | 53 to 77 s; `make apply-env` 13 s |

**Resource budget (for module 00).** With the generators and the simulator (4 browsers) running, the four
k3d containers use **3.4 GiB** of memory (1.6, 1.2, 0.5 and 0.01 GiB) and under 1 CPU. Docker needs 8 GB
and about 10 GB of free disk (`make doctor` checks both).

#### Not checked here (the owner's, in the ClickStack console)

The data for each is confirmed above; the UI is not. Open Dashboards, Kubernetes (the Pods, Nodes and
Namespaces tabs); a frontend pod's Infrastructure tab from a trace; the service map; a session replay of a
simulated shopper; a log search for `card_gateway_unavailable` after `make break-card-gateway`; and create
or confirm the ClickStack sources (module 08 depends on them).

#### Findings about the environment

- **A full disk, twice.** The Docker VM's disk (Phase 5) and then the Mac's own (100% used, 0.7 GiB free):
  OrbStack stopped by itself and the acceptance run waited until space was freed. After that, Docker's
  unused images and build cache were gone, which is where the cold timings come from.
- **The Docker CLI had no configuration afterwards** (`~/.docker` empty, `/var/run/docker.sock` pointing at
  a Docker Desktop that was not running), so the work used `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock`
  explicitly. Nothing outside the repo was changed.
- **Intermittent connection timeouts to the Cloud endpoints** (Postgres and ClickHouse; a TCP connect that
  took 7.6 s or never completed, while other hosts answered in 40 ms) happened three times, each cleared
  within minutes. The owner's older `producer` container (not this workshop's) pushes about 2,600 events a
  second to another ClickHouse host all the time, which is a plausible contributor to an uplink that is
  busy; this was not proven and the container was not touched.
- **The Docker legacy builder** printed a deprecation notice because buildx was no longer installed; the
  images built either way. Docker Desktop ships buildx, so participants will not see it.

## Phase 7: human-mode modules

### What was written

- `workshop/00-prerequisites` to `workshop/10-cleanup`: the same skeleton in each (goal, time, what you will
  learn, before you start, steps, checkpoint, troubleshooting, going further). Module 09 is a marked
  placeholder: it comes with the agent prompts in Phase 9.
- The root `README.md` (overview, architecture, module index with times, commands, layout) and a rewrite of
  `data-generators/README.md` for ClickHouse-only, browser-only operation: no Kafka, no backend mode, no
  fraud generator, no `run.sh`, no `PURCHASE_PIX_SHARE`. It is written from the code, not from the old text:
  the funnels (realistic for the producers, the workshop's for the simulator), the payment mix (card 50,
  Pix 30, Boleto 20), what `se_property` holds (a UUID for a generated purchase, the Postgres order id for
  a real one), the sink, every variable with its default, and how to run a generator without the cluster.
- `make check-NN` for modules 00 to 04, 06, 07, 08 and 10 (05 existed). The database side is
  `tools/module_checks.py`, run in the tools container through `scripts/checks/lib.sh`; the shell side
  covers Docker, images and the cluster. Each failing line says what to do.
- All 29 statements in `sql/clickhouse/examples/` were run against the live service: none errors.

### Where the console steps come from

I cannot click through the Cloud console, so the steps in modules 01, 03 and 08 use ClickHouse's own
documentation, and the labels below are the documented ones:

- **Managed Postgres:** the instance's **Connect** view (**Username**, **Password**, **Server**, **Port**, the
  **via PgBouncer** toggle, direct is the default and ClickPipes is not supported through the pooler) and the
  **Settings** tab for the CA certificate.
- **ClickPipe:** the instance's **Sync to ClickHouse**, then **Replicate data in ClickHouse**, with
  **Integration name**, **ClickHouse service**, **Postgres database**, **Replication method** ("Initial load +
  CDC"), **Sync interval (seconds)** (default 60), **Destination database**, **Prefix default destination table
  names with schema name**, **Preserve NULL values from source** and **Remove deleted rows during merges**,
  then **Replicate data to ClickHouse**.
- **ClickStack:** the source form's fields (**Name**, **Source Data Type**, **Server Connection**,
  **Database**, **Table**, **Timestamp Column**, ...), **Dashboards, Kubernetes** (Pods, Nodes, Namespaces),
  and, from the owner's own screenshot, the log row's tabs (**Overview**, **Column Values**, **Service Map**,
  **Surrounding Context**, **Infrastructure**).

**Not documented, written from what is likely, and flagged in the PR for the owner to confirm:** the ClickHouse
service creation and **Connect** labels; the Postgres instance's IP-access setting (module 01 describes the
setting without naming a label); that the console accepts a 10 s sync interval (the plan suggests 10, the
default is 60); how ClickStack is launched from the service and where its source settings live (the docs do
not cover a custom database); the name of the sessions view ("client sessions"); and that a pipe's table list
can be changed after creation.

### Findings while writing

- **Module 03 uses an order made by hand**, not a storefront order: the storefront settles an order in about
  2 s, so ClickHouse never has a `pending` version (Phase 6). The module walks one order through insert,
  update and delete in `make psql`, and shows the rows with and without `FINAL`.
- **`hasToken` is the wrong function for a search term.** `_` and `-` are separators, and `hasToken` raises
  `Needle must not contain whitespace or separator characters`; `hasAllTokens` splits the term itself (`USB-C`
  and `usb c` both find 38 products). `FINAL` on `products_search` raises `Storage SharedMergeTree doesn't
  support FINAL`. Both are in the module 04 troubleshooting.
- **ClickStack's log search is the same index as module 04.** `retail_otel.otel_logs` has
  `INDEX idx_lower_body lower(Body) TYPE text(tokenizer = 'splitByNonAlpha')`, and module 08 uses that to tie
  the two together.
- **Span names for module 08:** `checkout.place_order` (attributes `clickshop.order_id`,
  `clickshop.payment_method`, `clickshop.order_status`, `clickshop.item_count`), `search.products`,
  `pg.query:SELECT|INSERT|UPDATE|BEGIN|COMMIT clickshop`, `clickhouse.query`.
- **The checks are state checks, so some fail by design:** `check-06` needs events from the last five
  minutes (it fails once the generators are stopped), `check-07` needs ten minutes of shoppers, and
  `check-10` fails while the cluster is up.
- **Times.** The command times in the modules are measured (Phase 6); the module totals add an estimate of
  reading and console time. Module 01's time is mostly waiting for the services to start and was not measured.
- **Agent mode** is not mentioned in the root README yet: the plan puts a pointer to `AGENTS.md` there, and
  Phase 8 creates the file.

### Changes after the Phase 7 review

The owner's answers to the review: the console labels in modules 01 to 03 and 08 are right; the sync interval
is 60 s; the search view refreshes every 5 minutes; the console steps and the API calls should both exist; and
module 02 is optional (D44 to D48).

- **The Cloud API has more than its documentation page says.** The ClickStack API page lists sources as
  list-only, but the live OpenAPI document (`https://api.clickhouse.cloud/v1`, which is the spec itself) has
  `POST`, `PUT` and `DELETE` for ClickStack sources (a beta endpoint, permission
  `control-plane:service:manage-clickstack-api`), and for dashboards, saved searches, alerts, roles and
  webhooks. The ClickPipes endpoints need `control-plane:service:manage-clickpipes`. The Postgres API
  even has `GET .../postgres/{id}/caCertificates`, which this workshop does not use (the participant
  downloads the certificate once, module 01).
- **Where the Postgres ClickPipe's settings live in the request** (they differ from the names in the console and
  from what one would guess): `tableMappings`, `settings.syncIntervalSeconds`, `settings.allowNullableColumns`
  ("Preserve NULL values from source") and `settings.deleteOnMerge` ("Remove deleted rows during merges") are
  all under `source.postgres`; `destination` holds only the database. `replicationMode: "cdc"` is "Initial load
  + CDC". A pipe goes Provisioning, Setup, Snapshot, Running.
- **A ClickStack source needs a `connection` id, and no endpoint lists connections.** It is read from a
  source that exists. On a service where ClickStack has never been opened there is none, so `make
  clickstack-setup` stops with the instruction to open ClickStack once. `make setup` treats that one step as
  non-fatal, carries on, and says at the end what is left to do. This is untested on a fresh service.
- **`clickstack.py setup` leaves existing sources alone** (same kind, same table) and creates the missing ones,
  linked to each other; `--force` overwrites. The column expressions come from the tables the collector creates
  (`otel_logs` has no `TimestampTime`; `hyperdx_sessions` does).
- **`ALTER TABLE ... MODIFY REFRESH`** works on a refreshable view in ClickHouse Cloud 26.6, so
  `10_products_search.sql` states the schedule twice (`CREATE ... IF NOT EXISTS` would leave a view created
  with the old one): a service that had the one-minute view now has the five-minute one after `make ch-search`.
- **The notebook was run headless** against the real services without a key: setup, the migration cell, the
  masked request and the ClickHouse listing work; the first API cell stops with the "no API key" message.
  Tests keep it in step with the code it calls (`tools/test_notebook.py`).

### Validated against the live service (with a Cloud API key)

Run on the owner's service, on scratch resources, with the owner's pipe and sources untouched throughout.

- **`make doctor`** accepts the key and finds the service by its host.
- **ClickStack sources.** The four existing sources (made in the console) are recognised by `matches()`, so `make clickstack-setup` is a no-op there. A throwaway set was created on a database name that does not exist (`zz_apitest`), read back, and deleted: the four kinds create, link to each other **exactly as the console links them** (traces to logs, metrics and sessions; logs to traces and metrics; sessions to traces; metrics to logs), every field round-trips, and a second run changes nothing.
- **A real bug the unit tests could not find:** the live API rejects a metric source without `from.tableName` (`Required`), although the published schema lists only `databaseName`. The console sends `""`, and so do we now. We also mirror what the console-made sources set: the `as service` / `as level` / `as duration` aliases in the default columns, `displayedTimestampValueExpression` and `spanLinksValueExpression` on traces, `serviceNameExpression` on metrics, and a blank exponential-histogram table (the table exists, ClickStack does not read it). We do **not** set `metadataMaterializedViews` (the `otel_*_kv_rollup_15m` tables): nothing in this repo creates them, so whether a fresh service has them is unknown, and they only speed up attribute suggestions.
- **ClickPipe.** A scratch pipe (`clickshop-apitest`, a scratch Postgres database with the schema, a scratch ClickHouse database): **26 s** from the request to Running; the tables it created are identical to the console-made pipe's (names, `SharedReplacingMergeTree`, sorting keys, columns and types); the snapshot loaded the 5 seeded categories; a change in Postgres reached ClickHouse in **63 s**, with the sync interval at 60 s. Deleting the pipe removes it from the list at once and its replication slot and publication from Postgres within about a minute; the owner's slot was never touched.
- **Two gaps found by reading and fixed** (D49, D50): the backfill had no guard, and the pipe was recognised by name only (the owner's pipe is `clickpipe-workshop-devops-days`).
- **`make setup` on a populated service** (everything but the two load-starting steps): **52 s**, exit 0, every step said it found what it needed: the pipe and the four sources "exist", the seed skipped, the history skipped, no pod restarted. This proves it can be repeated; it is **not** a first-run time. A first run needs an empty Cloud service, which has not been available. The "about ten minutes" in modules 01 and the README is the sum of parts measured earlier (cluster, images and application 2 min 23 s, backfill 1 min 34 s to 1 min 43 s, a pipe reaching Running 26 s plus one 60 s sync) with the images already built; building them from scratch (`make prefetch`) is separate and long.
- **Still untested:** a first-ever `make setup` on an empty service; the ClickStack `connection` id on a service where ClickStack has never been opened; the notebook with a key.

## Phase 8: agent mode

### What was written

- `AGENTS.md` (the rulebook: role, how to start or resume, ten golden rules, the ask-first table, how to run things, and a short section for agents that are working on the repository and not guiding) and `CLAUDE.md` (one line, `@AGENTS.md`).
- `agent-mode/README.md` (the tracks, how to read a playbook, the tags, the progress file, how to talk to the participant, how to handle a failure, what maintainers must keep in step) and eleven playbooks, `00-prerequisites.md` to `10-cleanup.md`. Each has the sections Preconditions, Steps (numbered, with a step id and a tag), Talking points, Checkpoint, Failure playbook, **Fast track** and Exit criteria. The fast-track section is ours, not the plan's: it says what changes after `make setup`.
- `.claude/commands/workshop.md` (`/workshop [module|fast|guided]`), `.claude/settings.json` (D57: Claude Code may not read `.env`) and a pointer to agent mode in the root README. `.claude/settings.local.json` is gitignored.
- `make ch-query` and `make pg-query` (D53), `tools/test_agent_mode.py` (D54) and `tools/test_no_credential_literals.py` (D55).

### Verified

- Every read-only `make ch-query` / `make pg-query` line in the playbooks (40) was run against the live service and answered; the `SHOW CREATE` lines too.
- **Module 03's exercise was run exactly as its playbook gives it** (insert, update, delete a test order, polling ClickHouse): `pending`, then two versions, then a third row with `_peerdb_is_deleted = 1` and an empty status, `FINAL` empty after the delete; each sync arrived in about 38 s; the test order was deleted afterwards and `make check-03` passes.
- The drift test and the credential guard each fail on a deliberate breakage and pass again when it is undone. `make test`: 212 + 11 + 21.

### Findings while writing

- **`assets/certs/` was not in the repository.** Module 01 says "the folder exists", but only the gitignored `.pem` was in it, so a fresh clone had no such folder. It now holds a `.gitkeep`, and the playbook runs `mkdir -p` as well.
- **Statement numbers are not query numbers.** In two of the example files a numbered query is a pair of statements, so `--only N` means "what sits under the comment numbered N".
- **A pod label is `deployment=<name>`, not `app=<name>`**, and the producers and the simulator exist as deployments only while they run.

### Not done

- **The `clickhousectl` recovery path** the plan marks as optional ("ask the owner first"): not built, and the owner said they do not want it, so do not offer it again. `make setup` already is the recovery path for a participant short of time, and the console flow stays the teaching one.
- **Nothing was run by an actual agent in guide mode.** The playbooks were checked against the system, not followed by one. That is Phase 10's dry run, with Claude Code and, if possible, a second agent.
- **ClickHouse Agents (module 09)** stays a placeholder in both modes: Phase 9, with the owner.

## Phase 9: ClickHouse Agents

### What was written

- **`docs/data-dictionary.md`** (D58): the three databases and how fresh each is; eleven rules every query must follow; the shop's vocabulary (order lifecycle, funnel, zero-result searches, low stock, the seven card anomalies); every table and column of `retail_oltp`, `retail_analytics` (with the event catalogue) and `retail_otel` (services, span names and attributes, metrics); the join keys; and how to tell real data from generated.
- **`workshop/09-clickhouse-agents/README.md`**: the human module, from the documentation (launch, **Create New Agent** and its fields, **Capabilities**, asking questions, checking an answer against SQL, improving the instructions, sharing and memory). A banner and `TODO(owner)` notes say what is not verified.
- **`workshop/09-clickhouse-agents/agents/clickshop-analyst/instructions.md` and `questions.md`**: outlines with `TODO(owner): co-author` headers (D59). The questions are ten candidates, easy to hard, each with where its answer lives, a check that was run against a live service, and what a wrong answer tends to look like.
- **`agent-mode/09-clickhouse-agents.md`**: the playbook, replacing the placeholder, with a fallback (`fallback-sql`) if the Beta feature is unavailable or cannot reach the data.
- **`tools/test_data_dictionary.py`**; the drift test of agent mode now allows the shared agent assets under `workshop/09-clickhouse-agents/agents/` and still forbids the human READMEs.

### What the documentation says, and what it does not

From the quickstart, the overview and the sharing and memory pages (2026-10-21):

- **Launch:** the left sidebar item **ClickHouse agents** (Beta), then **Launch ClickHouse agents**, which opens the Agent Builder; also at `ai.clickhouse.cloud`.
- **Create:** **Create New Agent**; fields **Name**, **Description**, **Category** (`General`), **Instructions**, **Model**. **Capabilities** are toggles: Run Code, Web Search, File Context, Artifacts, MCP Servers, Skills. **Add Tools** opens a catalogue of third-party integrations; subagents are under **Advanced settings**.
- **Models:** "every Cloud customer gets Claude models (Sonnet and Haiku) wired in as the default model" (launch post).
- **Availability:** "available to all ClickHouse Cloud customers in public beta" (launch post); the documentation says Beta.
- **Sharing:** Viewer, Editor, Owner; the Share dialog; **Save Changes**; an organization-wide switch.
- **Memory:** per user, key-value, the **Memories** icon, a **Use memory** checkbox, keys of lowercase letters and underscores.
- **Managed Postgres:** an announcement says agents can link directly to a Managed Postgres instance, with access "read-only by default", and combine it with ClickHouse in one question. It gives no setup steps.

**Not stated anywhere I could find** (so left as `TODO(owner)`): how an agent reaches the service's data and with which role; whether that is read-only for ClickHouse; trial availability; the name and place of the permission to create agents (the quickstart says "Admin Settings", the sharing page does not use that name); whose credentials a shared agent uses to read data; the contents of the **Prompts** library; the model dropdown's real options.

### Findings while writing

- **Prices are USD, not BRL** (D60): a comment in the frontend says so, and `i18n/config.ts` converts for display. Assuming the shop's currency from the Brazilian cards would have been wrong.
- **The module 06 anomaly example overcounted** (D61), and the generator has a seventh anomaly kind the example never counted (a `card_bin` that contradicts the network). A future-dated anomaly stops being detectable once its time has passed.
- **Real browser searches have an empty `se_property`**; generated ones have `text`. In `checkout_payment_confirmed`, a numeric `se_property` is a real order and a UUID a generated purchase. Only 85 of the 2,086 orders have a `domain_userid`, and only they join to the clickstream.
- **`toUUID(se_property)` fails on the live service** (`CANNOT_PARSE_UUID`): `se_property` holds a category slug or a count on other events, and ClickHouse may evaluate the conversion before the `WHERE`. Two examples in `data-generators/README.md` and a comment in `20_clickstream.sql` used it and were wrong as written; they now use `toUUIDOrNull` (a test keeps it that way). The generator's own docstring still shows the old form: left alone, it is a code comment in an image's source.
- **The shop's own card rows are labelled `BRL` but carry the order total in USD** (`bill_value` equals the purchase's `se_value` for about 96 % of them), and a frontend comment says `bill_value` is USD. The label is the inconsistency; the dictionary says not to convert. Whether to relabel them `USD` in the generator is the owner's call (not changed here: Phase 4).
- **Seeded orders have a partial `shipping_addr`, storefront orders none.**
- **Replicated JSON columns are text** (`attributes`, `address`, `shipping_addr`), and NULLs became `''` / `0`.
- **A card gateway outage leaves no order, cancelled or otherwise** (found in Phase 10): the card payment is authorized at `/api/checkout/authorize` before the order is written, so a refused card payment stops the checkout there. Only a refused Pix or Boleto payment leaves a `cancelled` order, and nearly all the `cancelled` orders in the data are seed history. The dictionary, the analyst's instructions and candidate question 9 said otherwise and were corrected: question 9 is now "were card payments failing, and where does it start?", answered from `retail_otel`.

### For the owner: what to check in the console

1. Is **ClickHouse agents** available in a trial organization, and on which plans?
2. What is the exact permission that lets someone create agents, what is it called, and where does an admin grant it?
3. **How does the agent reach the service's data?** A built-in tool, or a ClickHouse MCP server that has to be attached (under **MCP Servers** or **Add Tools**)? Note what has to be switched on.
4. Which database user or role do the agent's queries run as, and does a shared agent run as its owner or as the person using it?
5. Is the access read-only? (Ask an agent to create and drop a scratch table.)
6. Where in a conversation can you see the SQL the agent ran?
7. Which models does the dropdown offer, and which would you pick for this?
8. Which **Capabilities** does the analyst need, and is **Web Search** off right?
9. The exact labels of the Share dialog, including the organization-wide switch; is the marketplace worth mentioning?
10. Is the **Prompts** library worth a step?
11. Managed Postgres: how is the agent integration enabled, and does it belong in this module?
12. How long does the module take, and how long may the Instructions be (or should the dictionary be attached as **File Context**)?

### Not done

- **The final instructions and questions**: a first draft of the instructions was written from the owner's example prompts (D62) and awaits review; the questions are still candidates (D59).
- **Any step beyond the documentation**: nothing was run in the console.
- **A check for this module**: there is none; the agent lives in the console.

## Phase 10: dry run and polish

### How it was done (D65)

A fresh `git clone` of GitHub's `main` in `/tmp`, with the owner's `.env` and certificate copied in for the run and deleted after, and the owner's Cloud service. `make prefetch` (and a separate cold build with no cache), `make setup` with the cluster created from nothing, `make check-00` to `check-08`, module 08's exercise. Two readers, each given only the texts a participant or a guide would have and told to change nothing: they found what a reader gets stuck on. Their findings were verified against the code before anything was changed.

### Bugs a fresh machine found

- **The first command failed on a Mac.** `deploy/bin/helm` and `kubectl` expanded `net_flags`, an empty array until the cluster's network exists, under `set -u`, which macOS's bash 3.2 treats as an error. `make prefetch` died on it on every first run; it was hidden for months by a cached chart and an existing network. Fixed with the 3.2-safe expansion, and a static test (`tools/test_scripts.py`) reads the scripts for it and for bash 4 features, since the unit tests run on a modern bash.
- **`make prefetch` did not build the tools image**, so the first `make doctor` needed the internet again, against "internet once". It now does, and `check-00` checks for it.
- **Nine commands failed with a raw kubectl error before a cluster existed**, and `make traffic-stop` failed when there was nothing to stop (D63).
- **`SYSTEM REFRESH VIEW` is asynchronous**: refreshing and re-querying at once shows the old data. Every instruction now pairs it with `SYSTEM WAIT VIEW` (the tooling already did).
- **A card gateway outage leaves no order at all** (and the dictionary, the analyst's instructions and question 9 said it left a cancelled one). The card payment is authorized before the order is written, so the shopper never gets to an order; only a refused Pix or Boleto payment leaves a `cancelled` order. Corrected, and question 9 is now about the telemetry.
- **`make logs S=backfill` failed** because the backfill is a Job, not a Deployment. `make logs` now falls back to the Job.
- **`make doctor` said "Next: make cluster images secrets app"**, which skips the ClickPipe and search on the slow path. It now says what module 01 does next.
- **`check-03` failed whenever a shopper had just ordered** (D64).
- **A stray `CARD_GATEWAY_DOWN=true` in `.env` breaks every card payment on every new cluster**, and the owner's `.env` has it: a fresh cluster built from it had every card checkout fail (`failed` above `orders` in the simulator log). `make doctor` now warns about it. The `.env` was not changed.
- **Module 01's `cp .env.example .env` replaced an existing `.env`** (with the passwords in it); it is `cp -n` now, and the playbook checks first.

### What readers found, fixed

The first-run path (above); the human guide: a glossary, the order lookup in module 05 by order number (the shoppers make "the newest" useless after `make setup`), `make ch-query` where the SQL console was the only way, module 07 now says to leave the shoppers running for module 08, module 10 deletes the Admin API key, the disk and time numbers agree with the commands, the "8 services" and "15 services" of module 08 are explained (a checkout crosses 6 to 8; the map shows all 15); the agent guide: one rule for Cloud deletion (the agent never does it, including `make clickpipes-delete`), the literal background command with its completion marker, how to quote SQL, how to resume when the cluster is down or a module has no check, the one-hour budget that now adds up, module 09's single path (print the text in the chat, fill in the two ids, attach the dictionary), and module 10 in an order that works. `make cloud-ids` prints the two ids the analyst needs.

### Verified on the fresh clone

- **A cold build of the six images** (`docker build --no-cache`, base images already local): **3 min 57 s** (frontend 2 min, simulator 1 min 24 s, the other four under 15 s each). A normal `make prefetch` from the fresh clone took 5.8 s, every layer a cache hit: the build contexts in git are byte-identical to what produced the images, so nothing the images need is missing from the repository.
- **`make setup` from the fresh clone, the cluster created from nothing**: **2 min 39 s** (cluster and application 1 min 37 s, the browser image 17 s), 21 pods running. The services and data already existed, so the ClickPipe, the seed and the history were recognised and skipped: this is **not** a time from empty services.
- **`make check-00` to `check-08` pass** (`check-08` first failed only because the shoppers had run for one minute and no Boleto order existed yet, with a message that said so; `check-07` passed after about nine minutes of shoppers: Boleto 20, card 46, Pix 28 orders).
- **Module 08's exercise, with numbers.** The owner's stray `CARD_GATEWAY_DOWN=true` made every card checkout fail from the start (`failed` above `orders`). `make fix-card-gateway` (3 s): `failed` stayed at 12 over 200 s while orders rose from 11 to 14, and a card order confirmed. `make break-card-gateway` (3 s): in 180 s `failed` rose from 12 to 16 and **no card order appeared, confirmed or cancelled**; error spans in five services (`demo-storefront-bff` 12, `demo-checkout-svc` 12, `demo-payment-card-svc` 12, `retail-demo-frontend` 8, `demo-card-gateway` 8); the log search found exactly the four services the module names, four lines each. After the second fix (4 s): two card orders confirmed in 140 s, `failed` flat at 16, **zero error spans** in the last 90 s.
- **Module 10:** `make traffic-stop`, `make down` (4 s) and `make check-10` pass.
- **`make doctor` with four deliberate `.env` mistakes** (a URL as host, the pooler port, quotes, a trailing comment): each caught with its own fix, values masked.
- **Before a cluster exists**, each of the nine cluster commands now fails with one line that says what to run, and the three stop commands succeed. `make logs` works for a Deployment and a Job, and says "not found" otherwise.
- **`make test` 307 + 11 + 21**, with the new tests each broken on purpose to see them fail (a bash 3.2 expansion, a Makefile target without its guard, a bad `make` target, a dead link, a time mismatch, a missing file in a module).

### Left for the owner

- **A rehearsal on a second machine and a fresh organization**, with new services: the creation of the two services, the ClickPipe created for the first time, Postgres seeded through it, and `make setup` from empty. The facilitator guide has the table to fill in.
- **The console walk-throughs**: modules 01, 03 and 08's by-hand steps, and module 09 (twelve questions in "Phase 9"). The readers also asked for: the Postgres size and tier, how the ClickPipe authenticates in the console flow, ClickStack's settings path and that the four sources must be linked.
- **Module 09 is still a draft** and cannot be finished from these texts: it is up to the owner whether to run it as a demo and keep it out of the time total.
- **`CARD_GATEWAY_DOWN=true` in the owner's `.env`**: remove that line.
- **Small things I did not change**: only Docker Desktop's settings path is given in module 00; the storefront's button labels in module 05 are English (the page follows the browser's language); a few claims in modules 03 and 08 (timings, "ClickStack suggests the right ones") come from earlier phases and have not been re-timed.
