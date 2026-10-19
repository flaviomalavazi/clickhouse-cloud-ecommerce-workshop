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
