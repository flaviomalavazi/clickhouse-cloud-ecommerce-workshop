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
| D9 | `products_search` is **built from the CDC-replicated Postgres tables** by a refreshable MV that runs **every 1 minute**, not by a seed script. Stock levels then show in search, and the catalogue has one source of truth. | Confirmed |
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
| D42 | `make nuke-data` resets **orders and inventory only**: Postgres goes back to the seed through DELETE and UPDATE (which the ClickPipe replicates). It never touches ClickHouse: the web analytics events, the card transactions, the rollups built from them and the ClickStack telemetry in `retail_otel` are slow to rebuild, so no reset removes them. This is the owner's rule; the first version of the command emptied those tables and was wrong. | Confirmed |

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
- **`make nuke-data`** (confirmed with `nuke`): restored Postgres (11 orders, 11 customers, 12 stock
  levels back to the seed); `make status` then showed Postgres at 2,000 orders and 500 customers and
  the CDC copy in step. This first version also emptied 17 ClickHouse tables; see D42 and the mistake below.

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
- **`make nuke-data` does not truncate Postgres** (the ClickPipe does not replicate it): it deletes
  the added orders and customers and restores the stock, and nothing else (D42).

### A mistake, and what it cost

The first `make nuke-data`, and the cleanup I ran by hand after it, emptied `snowplow_events`,
`credit_card_transactions`, the `analytics_*` rollups and every table in `retail_otel`. Earlier phases
did the same to clean up after tests. The owner's rule is that events and telemetry are tougher to
populate than orders, so a reset leaves them alone (D42). The rows are gone: `make backfill` (about
two minutes) and `make generators-start` rebuild the events, and traffic through the cluster rebuilds
the telemetry, but the history that was there before is not recoverable from here.
