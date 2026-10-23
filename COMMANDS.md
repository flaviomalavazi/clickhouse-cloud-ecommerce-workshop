# ClickShop commands

**Language:** English · [Español](COMMANDS.es.md)

The [README](README.md) lists the five commands most people need. This page has all of them: what each one does and what it changes, the parameters they take, and how to turn the load up after the workshop. `make help` prints the same list, one line each.

Run every command from the root of the repository. None of them prints a secret: `make doctor` shows `.env` masked.

## The quick path

1. `make prefetch`: download and build everything, once, before the day (about 5 minutes; it needs the internet).
2. `make doctor`: check Docker, `.env` and both Cloud services.
3. `make setup`: the first time, build everything and start the demo (about 10 minutes; it needs the Cloud API key).
4. `make start`: bring the demo back another day, after `make stop`, `make down` or a reboot.
5. `make down`: remove the local cluster when you are done (your Docker images stay).

## Turning up the load

`.env.example` starts everyone at half the load the workshop was built at, because nobody knows beforehand what their laptop can take. If Docker has 8 GB of memory (`make doctor` says how much it has), you can raise it after the workshop:

| Setting in `.env` | In `.env.example` | Full load | What it is |
|---|---|---|---|
| `SIM_USERS` | 2 | 4 | browsers, about 300 MB of memory each |
| `SIM_ARRIVALS_PER_MINUTE` | 3 | 6 | new shoppers a minute; one browser serves about 1.5 a minute |
| `PRODUCE_TARGET_EPS` | 100 | 200 | web events a second, as a daily average (the evening peak is about three times that) |
| `CC_TARGET_TPS` | 10 | 20 | card transactions a second |

Edit `.env`, then apply it:

```bash
make apply-env    # restarts the pods that read .env
make sim-start    # resizes the simulator to SIM_USERS
```

- Raise it a step at a time and watch `make status` and `docker stats`. With everything at the full load the laptop's containers used about 3.4 GiB.
- More shoppers need more browsers: keep `SIM_ARRIVALS_PER_MINUTE` under about 1.5 times `SIM_USERS`, or the simulator drops the shoppers it cannot serve (its log says `SIM_SESSIONS is short`). Each browser adds about 300 MB.
- The generators cost the laptop mostly CPU, not memory.
- If the machine starts to swap, or pods restart, go back to the values that worked and run `make apply-env` again.
- `make sim-start USERS=6` tries a number of browsers for one run without changing `.env`.
- A setting removed from `.env` falls back to the full load (4 browsers, 6 shoppers a minute, 200 events and 20 transactions a second), not to the values in `.env.example`.

With more shoppers, the module 07 check (`make check-07`) passes sooner: it needs about 20 minutes of shoppers at the load in `.env.example`, and about 10 at the full load.

## Every command

### Get ready and check

| Command | What it does |
|---|---|
| `make prefetch` | Downloads and builds every image and the collector's chart, so the cluster can be created offline. Run it again at any time: what is there is skipped. |
| `make doctor` | Checks Docker (memory, CPUs, disk), port 3000, `.env` (every value masked) and both Cloud services. |
| `make check-NN` | Checks the end of module NN (`make check-05`, for example). Module 09 has none. |
| `make status` | The pods, then the row counts and the freshness of every workshop table. |

### Everything at once

| Command | What it does |
|---|---|
| `make setup` | Builds what modules 01 to 08 build by hand, in order, and starts the load. Safe to repeat: whatever exists is skipped. It needs the Cloud API key. |

### ClickHouse, Postgres and the ClickPipe

| Command | What it does |
|---|---|
| `make ch-bootstrap` | Creates the ClickHouse databases and the clickstream tables. |
| `make pg-setup` | Creates the Postgres tables and loads the catalogue, customers, stock and orders: `make pg-migrate`, then `make pg-seed`. |
| `make clickpipes` | Creates the Postgres CDC ClickPipe through the Cloud API. |
| `make clickpipes-status`, `make clickpipes-wait` | The pipe's state; wait until ClickHouse holds what Postgres holds. |
| `make ch-search` | Builds product search: `products_search`, its text index and the refreshable view that fills it. |
| `make ch-mvs` | Creates the real-time rollups and fills them from what is already there. |
| `make backfill` | Loads 30 days of history (5 million events, about 2 minutes). Skipped when the history is there. |
| `make clickstack-setup`, `make clickstack-list` | Creates the ClickStack sources through the Cloud API; lists them. |
| `make cloud-ids` | Prints your organization and service ids (module 09). |
| `make notebook` | Opens JupyterLab with the notebook that shows the ClickPipe request. |

### The local cluster

| Command | What it does |
|---|---|
| `make up` | Starts the cluster and the application (`make cluster images secrets app`). On a stopped cluster it starts it again, as it was. |
| `make start` | `make up`, then `make traffic-start`. |
| `make stop` | Stops the cluster and keeps it: the application, its images and its settings. |
| `make down` | Deletes the cluster and everything in it. Your Docker images and the Cloud data stay. |
| `make apply-env` | After you edit `.env`: updates the cluster's Secret and restarts the pods that read it. |
| `make cluster`, `make images`, `make secrets`, `make app`, `make otel-k8s` | The steps of `make up`, one by one, as module 05 teaches them. |

### The load

| Command | What it does |
|---|---|
| `make traffic-start`, `make traffic-stop` | Starts or stops the generators and the shoppers together. |
| `make generators-start`, `make generators-stop` | The live web events and card transactions. |
| `make sim-start`, `make sim-stop` | The browser shoppers. |

### Look inside

| Command | What it does |
|---|---|
| `make logs S=<service>` | Follows a service's logs (`S=frontend`, `S=simulator`, or a Job: `S=backfill`). |
| `make ch-query Q="SELECT 1"`, `make pg-query Q="SELECT 1"` | Runs SQL without a prompt. `FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2` runs numbered example query 2 of that file. |
| `make ch-client`, `make psql` | A SQL prompt on ClickHouse, on Postgres. |

### Exercises and resets: read before you run them

| Command | What it does |
|---|---|
| `make break-card-gateway`, `make fix-card-gateway` | Module 08's exercise: card payments fail, then work again. Fix it before you move on. |
| `make nuke-data` | Puts the orders and the stock back to the seed and lets the ClickPipe copy them again; events and telemetry are kept. It asks you to type a word, and it stops the shoppers: afterwards run `make clickpipes-wait`, then `make sim-start`. |
| `make pg-reset` | Empties Postgres and seeds it again, but not ClickHouse's copy: `make nuke-data` is usually what you want. It asks you to type a word. |
| `make backfill FORCE=1` | Loads the history a second time, so every past session counts twice. |
| `make clickpipes-delete` | Deletes the ClickPipe. Module 10 says when. |

### For people changing the workshop

| Command | What it does |
|---|---|
| `make test` | The Python unit tests. |
| `make check-env-contract` | Checks that every environment variable the code reads is defined in `.env.example`, the chart or an image. |
| `make images-webp` | Regenerates the storefront's product images from the source photos (needs Pillow). |
| `make dev-frontend` | Runs the storefront with npm on this machine, reading `.env` (needs Node). |
| `make tools-image` | Builds the tools image (Python and `psql`); the commands that need it build it themselves. |

## Parameters

| Parameter | Used by | What it does |
|---|---|---|
| `USERS=n` | `make sim-start`, `make traffic-start`, `make start`, `make setup` | The browsers for this run only, instead of `SIM_USERS` in `.env`. |
| `SKIP="backfill simulator"` | `make setup` | Leaves those steps out (the step names are in `scripts/setup.sh`). |
| `SETUP_DRY_RUN=1` | `make setup` | Prints the plan and runs nothing. |
| `FORCE=1` | `make backfill` | Loads the history even when it is there. |
| `CONFIRM=yes` | `make pg-reset` | Skips the typed confirmation. |
| `Q`, `FILE`, `N` | `make ch-query`, `make pg-query` | The SQL to run, or an example file and the number of a query in it. |
| `S`, `TAIL` | `make logs` | The service, and how many past lines to show first. |
