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
