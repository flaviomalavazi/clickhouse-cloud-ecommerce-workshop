# Module 06: Real-time analytics (agent playbook)

**Objective:** ClickHouse holds a month of clickstream history and a live stream of events and card transactions, a real-time dashboard reads pre-aggregated rollups, and the participant understands incremental materialized views and why the generators insert in large batches.

**Step ids:** `create-rollups`, `backfill`, `start-generators`, `dashboard`, `ask-questions`, `why-batches`, `check`.

**Time:** guided about 30 minutes; fast-track tour about 8.

## Preconditions

```bash
make check-05
```

It must pass, and the cluster must be running.

## Steps

### 1. `create-rollups` [AGENT RUNS] The rollups

```bash
make ch-mvs
```

Four seconds. It applies `sql/clickhouse/30_realtime_mvs.sql`. Say: the dashboard used to aggregate the raw `snowplow_events` table on every refresh, every 5 seconds. Now there are five small tables and five **materialized views** that feed them: each time a batch is inserted into `snowplow_events`, a view aggregates **that batch** and writes the result into a target table. Four targets are `AggregatingMergeTree` (the fifth, a ten-minute window of raw page views for the live feed, is a plain `MergeTree` with a TTL). Show the idea:

```bash
make ch-query Q="SHOW CREATE TABLE retail_analytics.analytics_events_1m"
```

The columns hold **aggregate states**, not numbers (`countMerge(events)`, `uniqMerge(uniq_users)`): a state can be merged with another, so minutes roll up to hours or days exactly. Run it **before** loading data so every insert feeds the rollups; the file also fills any minute that is missing, so running it again later is safe.

### 2. `backfill` [AGENT RUNS] A month of history

```bash
make backfill
```

A Kubernetes **Job** writes 30 days of history: about **5 million events**, plus the card transactions of the purchases among them, in under two minutes. Run it in the background and read its `[flush]` lines: each is one insert of **100,000 rows** (about 98 MB of JSON that travels as about 7 MB), written in 2 to 3 seconds. If the history is already there (the fast track's `make setup` loads it), the command says so and does nothing, because a second load would double every session: **do not run it with `FORCE=1`** unless they ask and understand that.

### 3. `start-generators` [AGENT RUNS] The live generators

(`make traffic-start` starts these and module 07's shoppers together, if they want both.)

```bash
make generators-start
deploy/bin/kubectl -n clickshop logs deploy/producer-web --tail=15
```

Two pods start: `producer-web` generates browsing sessions at about **100 events a second** on average over a day, and `producer-cc` about **10 card transactions a second** (the load in `.env.example`, half the full one). The rate follows an hour-of-day curve (the first log lines show the average and the peak), and sessions follow the same funnel as the backfill. Show a `[flush]` line: a batch every 5 or 6 seconds, of hundreds of rows or more, depending on the hour. The rates are `PRODUCE_TARGET_EPS` and `CC_TARGET_TPS` in `.env`; if they want to change them, **they** edit `.env` and you run `make apply-env`.

### 4. `dashboard` [PARTICIPANT DOES — console] Open the dashboard

"Open <http://localhost:3000/demo/analytics>." It shows live visitors and a live feed, today's numbers, page views by hour, top pages, the funnel, revenue, payment methods, devices, traffic sources and the searches that returned nothing. The **Pipeline** tile is different: it reads the counters of the OpenTelemetry collector (spans, logs and metric points per second), the system module 08 observes. Every tile reads the rollup tables, not the raw events: that is why it refreshes every few seconds over millions of rows.

### 5. `ask-questions` [AGENT RUNS] Ask your own questions

```bash
make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=1
make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2
make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=3
make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=5
make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=6
```

In order: **events per minute**, read from the rollup (coarser buckets are exact because the states merge); **the purchase funnel** with `windowFunnel` (how far each session got, in order, within an hour: page view, product click, add to cart, checkout start, payment initiated, payment confirmed); **searches that returned nothing** (what customers want and the catalogue lacks: they can try `summer dress`); **card transaction anomalies** (a small share have exactly one corrupted field: a missing merchant, a negative amount, zero installments, an unknown card network, a timestamp in the future); and the anomalous rows themselves. Invite them to ask a question of their own and write the SQL together.

### 6. `why-batches` [AGENT RUNS] Why large batches

```bash
make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=4
```

Every insert into a MergeTree table creates a **part** on disk and background merges combine parts. Many small inserts mean many small parts, so merges fall behind and queries read more files; every insert into `snowplow_events` also runs the five materialized views. So the generators never send events one by one: each process has **one writer per table** that collects rows until it has 100,000 or 5 seconds have passed, then sends one insert (about 0.2 inserts a second per table at the live rate, parts of about half a million rows after merges).

### 7. `check` [AGENT RUNS] The checkpoint

```bash
make check-06
```

## Talking points

- **Incremental materialized views:** the work is done at insert time, on each batch, not at read time on the whole table. A dashboard that reads thousands of pre-aggregated rows is fast no matter how many raw events there are.
- **Aggregate states and `AggregatingMergeTree`:** store `countState` / `uniqState`, merge with `countMerge` / `uniqMerge`: exact roll-ups at any coarser granularity, and `uniq` stays correct across batches.
- **Large batches:** one insert is one part; keep inserts big (100,000 rows or five seconds) and ClickHouse stays fast; send rows one by one and you drown it in parts.
- **A funnel with `windowFunnel`:** ordered steps within a time window, per session, in one aggregate function.

## Checkpoint

`make check-06` shows `snowplow_events` holding more than a million events over a week or more, the one-minute rollup equal to the raw events, card transactions present, events arriving now, and the dashboard's endpoints answering. It ends `All checks passed`. The check "events are arriving now" needs the generators running.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| The dashboard tiles are empty or show errors | `make status` (are the rollups growing? are the generators running?) | `make ch-mvs`; wait for the backfill; `make generators-start`. |
| `check-06` says the rollup differs from the raw events | `make check-06` | `make ch-mvs` again: it fills the minutes that are missing. |
| `check-06` says nothing arrives now | `deploy/bin/kubectl get pods -n clickshop` | The generators are stopped: `make generators-start`. |
| `make backfill` fails | `deploy/bin/kubectl -n clickshop logs job/backfill --tail=40`; `make doctor` | Usually ClickHouse credentials or reachability. |
| `make backfill` prints "history is already loaded" | Nothing is wrong | The history is there; leave it. |
| They want the load to stop | n/a | `make generators-stop`, or `make traffic-stop` to stop the shoppers (module 07) too. |

## Fast track

`make setup` created the rollups, loaded the history and started the generators. Skip steps 1 to 3; open the dashboard (step 4) first, then step 5 (let them pick the questions) and step 6.

## Exit criteria

`make check-06` passes. Update the progress file: module `06` `done`; `current` module `07`.
