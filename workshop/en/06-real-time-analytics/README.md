# Module 06: Real-time analytics

**Goal:** fill ClickHouse with a month of clickstream history and a live stream of events and card transactions, and watch a real-time dashboard that reads it.

**Time:** about 30 minutes. `make ch-mvs` takes 4 s, `make backfill` 1 min 34 s and `make generators-start` 3 s.

**You'll learn:**
- **incremental materialized views** and `AggregatingMergeTree`: pre-aggregating on insert so a dashboard reads thousands of rows, not millions;
- **why large batches matter** to ClickHouse, and how the generators write them;
- analytical SQL on a clickstream: rollups, a purchase funnel, searches that found nothing, anomaly checks.

## Before you start

`make check-05` passes (module 05), and the cluster is running.

## Steps

### 1. Create the rollups

```bash
make ch-mvs
```

This applies `sql/clickhouse/30_realtime_mvs.sql`. Open it. Without rollups the dashboard would aggregate the raw `snowplow_events` table on every refresh, every 5 seconds. The file creates five small tables and five **materialized views** that feed them: each time a batch is inserted into `snowplow_events`, the view aggregates **that batch** and writes the result into a target table.

Four of the target tables are `AggregatingMergeTree` (the fifth, a ten-minute window of raw page views for the live feed, is a plain `MergeTree` with a TTL). Take the first one:

```sql
CREATE TABLE retail_analytics.analytics_events_1m
(
    minute        DateTime('UTC'),
    event_name    LowCardinality(String),
    events        AggregateFunction(count),
    uniq_users    AggregateFunction(uniq, String),
    uniq_sessions AggregateFunction(uniq, String)
) ENGINE = AggregatingMergeTree ORDER BY (minute, event_name);
```

The columns hold **aggregate states**, not numbers. A state can be merged with another, so you can roll minutes up into hours or days on read, exactly (`countMerge(events)`, `uniqMerge(uniq_users)`). Run it **before** loading data, so every insert feeds the rollups as it arrives; the file also backfills any minute that is missing, so running it again later is safe.

### 2. Load a month of history

```bash
make backfill
```

This runs a Kubernetes **Job** that writes 30 days of history: about **5 million events**, plus the card transactions of the purchases among them, in under two minutes. Watch its log: every `[flush]` line is one insert.

If the history is already there (`make setup` loads it), `make backfill` says so and does nothing, because a second load would double every session. `make backfill FORCE=1` loads it anyway.

```text
[flush] snowplow_events rows=100,000 bytes=98,142,336 wire=7,164,196 ms=2,673 server_written_rows=100000
```

Each insert is **100,000 rows**, about 98 MB of JSON that travels as about 7 MB, written in about 2 to 3 seconds. That is on purpose, see step 6.

### 3. Start the live generators

If you ran `make setup` they are already running, and this changes nothing. (`make traffic-start` starts these and module 07's browser shoppers together.)

```bash
make generators-start
make logs S=producer-web
```

Two pods start: `producer-web` generates browsing sessions at about **100 events a second** on average over a day, and `producer-cc` generates about **10 card transactions a second** (the load in `.env.example`, half the full one). The rate follows an hour-of-day curve (the first lines of the log show the average and the peak), and the sessions follow the same funnel as the backfill, and every purchase among them can carry a card transaction. Look at the `[flush]` lines now: a batch every 5 or 6 seconds, of hundreds of rows or more, depending on the hour.

The rates are in `.env`: `PRODUCE_TARGET_EPS` and `CC_TARGET_TPS`. After changing them, run `make apply-env` ([COMMANDS.md](../../../COMMANDS.md) says how far a laptop can take them).

### 4. Open the dashboard

Open <http://localhost:3000/demo/analytics>. It shows live visitors and a live feed of events, today's numbers, page views by hour, top pages, the funnel, revenue, payment methods, devices, traffic sources, and the searches that returned nothing. The **Pipeline** tile is different: it reads the counters of the OpenTelemetry collector (spans, logs and metric points received and written per second), which is the system you will observe in module 08.

Every tile reads the rollup tables, not the raw events: that is why it can refresh every few seconds on millions of rows.

### 5. Ask your own questions

Run `sql/clickhouse/examples/06_real_time_analytics.sql` in the SQL console, or one query at a time with `make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=1` (then `N=2`, and so on). In order:

1. **Events per minute**, from the rollup. The aggregate states merge, so a coarser bucket is exact.
2. **The purchase funnel**, with `windowFunnel`: how far did each session get, in order, within an hour: page view, product click, add to cart, checkout start, payment initiated, payment confirmed.
3. **Searches that returned nothing.** What customers look for and the catalogue lacks. Try `summer dress`.
4. **Rows per part**: the next step.
5. **Card transaction anomalies.** A small share of transactions have exactly one field corrupted (a missing merchant, a negative amount, zero installments, an unknown card network, a timestamp in the future). Each check counts one kind.
6. The anomalous rows themselves.

### 6. Why large batches

Run query 4:

```sql
SELECT table, count() AS active_parts, sum(rows) AS total_rows, round(sum(rows) / count()) AS avg_rows_per_part
FROM system.parts
WHERE database = 'retail_analytics' AND active AND table IN ('snowplow_events', 'credit_card_transactions')
GROUP BY table;
```

Every insert into a MergeTree table creates a **part** on disk, and background merges combine parts. Many small inserts mean many small parts, so merges fall behind and queries read more files. Every insert into `snowplow_events` also runs the five materialized views. So the generators never send events one by one: each process has **one writer per table** that collects rows until it has 100,000 or 5 seconds have passed, and sends them in one insert. The result is about 0.2 inserts a second per table at the live rate, and parts of about half a million rows once merges have run (499,112 on average in our run). The backfill is the extreme case: 100,000-row inserts as fast as ClickHouse takes them.

## Checkpoint

```bash
make check-06
```

`snowplow_events` holds more than a million events over a week or more, the one-minute rollup equals the raw events, there are card transactions, events are arriving now, and the dashboard's endpoints answer. (The last-but-one check needs the generators running.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| The dashboard tiles are empty or show errors | Did you run `make ch-mvs`? Is the backfill done, and the generators running (`make status`)? |
| `check-06` says the rollup differs from the raw events | Run `make ch-mvs` again: it fills the minutes that are missing. |
| `make backfill` fails | `make logs S=backfill` and `make doctor`: usually ClickHouse credentials or reachability. |
| You want the events to stop | `make generators-stop`, or `make traffic-stop` to stop the simulator (module 07) too. |

## Going further

- Raise `PRODUCE_TARGET_EPS` to 1000 in `.env`, run `make apply-env`, and watch the flush lines get bigger instead of more frequent.
- Read `data-generators/README.md` for how the producers shape sessions, the funnel and the anomalies.

**Next:** [module 07, Simulated shoppers](../07-simulated-shoppers/README.md).
