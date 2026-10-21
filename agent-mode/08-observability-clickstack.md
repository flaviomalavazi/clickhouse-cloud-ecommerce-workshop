# Module 08: Observability with ClickStack (agent playbook)

**Objective:** the participant sees the whole system in ClickStack (traces and the service map, logs with full-text search, session replays, Kubernetes infrastructure), then breaks the card gateway on purpose and finds the cause using only ClickStack.

**Step ids:** `traffic-ready`, `clickstack-sources`, `service-map`, `checkout-trace`, `empty-searches`, `session-replay`, `log-search-index`, `infrastructure`, `break-and-find`, `fix`, `check`.

**Time:** guided about 40 minutes; fast-track tour about 12 (the exercise is the part to keep).

**ClickStack's screens are in the console: you cannot see or drive them.** Your job is to describe where to click, to confirm with SQL on `retail_otel` that the data is there, and to coach the exercise without giving the answer away.

## Preconditions

```bash
make check-07
deploy/bin/kubectl -n clickshop get deploy simulator
```

(`READY 1/1` means the shoppers are running; `NotFound` means they are not.)

`check-07` must pass (or the participant chose to move on), and the simulator must be running: the screens need traffic. If it is not: `make sim-start USERS=4` and wait a few minutes. Nothing needs installing: everything the cluster observes is already flowing.

## Steps

### 1. `traffic-ready` [AGENT RUNS] Is the data there?

```bash
make ch-query Q="SELECT count() AS spans, uniqExact(ServiceName) AS services FROM retail_otel.otel_traces WHERE Timestamp > now() - INTERVAL 15 MINUTE"
make ch-query Q="SELECT count() AS log_lines FROM retail_otel.otel_logs WHERE Timestamp > now() - INTERVAL 15 MINUTE"
make ch-query Q="SELECT count() AS replay_events FROM retail_otel.hyperdx_sessions WHERE TimestampTime > now() - INTERVAL 1 HOUR"
```

Spans from about 15 services, a stream of log lines, and session events. Say: the storefront and the 14 services send traces, logs and metrics to the `otel-gateway`; the browsers send traces and session recordings through the storefront's `/api/otlp`; two collectors from the OpenTelemetry chart send Kubernetes logs, metrics and events. All of it ends in the database `retail_otel`, in the same ClickHouse service as the orders and the clickstream.

### 2. `clickstack-sources` [PARTICIPANT DOES — console] Open ClickStack and create the data sources

ClickStack reads the tables the collector fills; the collector here writes them to **`retail_otel`**, not `default`, so ClickStack must be told where they are.

First see whether the sources exist (the fast track's `make setup` creates them):

```bash
make clickstack-list
```

Four lines (log, trace, session, metric) all reading `retail_otel`: skip to step 3. Otherwise:

- **With an API key (fast):** the participant opens ClickStack from their service in the console **once** (that creates its connection to the service), then you run `make clickstack-setup`. It creates the four sources, linked to each other, and leaves any that exist. Run `make clickstack-list` to show them.
- **By hand (the participant, in ClickStack's settings):** create or confirm four **sources** using the connection to their service: **Logs** (`retail_otel`, `otel_logs`), **Traces** (`retail_otel`, `otel_traces`), **Metrics** (`retail_otel`, the `otel_metrics_*` tables), **Sessions** (`retail_otel`, `hyperdx_sessions`). The form asks for a name, a timestamp column and a few expressions; ClickStack suggests the right ones for the tables the collector creates.

### 3. `service-map` [PARTICIPANT DOES — console] The service map

"In **Search**, with the **Logs** source, find any line from a demo service, for example `journey completed`, and click it. The row opens with tabs: **Overview**, **Column Values**, **Service Map**, **Surrounding Context** and **Infrastructure**. Open **Service Map**." They see a checkout's path: the frontend calls `storefront-bff`; the bff calls `checkout-svc`; checkout calls `pricing-svc` and `inventory-svc`, then the payment service for the method chosen (`payment-card-svc`, `payment-pix-svc` or `payment-boleto-svc`), each calling its gateway, then `order-svc`, which calls `ledger-svc` and `email-gateway`: 15 services in all. Ask what they notice.

### 4. `checkout-trace` [PARTICIPANT DOES — console] One checkout, down to the SQL

"Switch the source to **Traces** and look for the span **`checkout.place_order`**. It has the attributes `clickshop.order_id`, `clickshop.payment_method`, `clickshop.order_status` and `clickshop.item_count`: pick an order id from module 07 and you find its trace." Give them an order id from `make pg-query Q="SELECT id FROM orders ORDER BY id DESC LIMIT 3"`. In the waterfall: `POST /api/checkout/complete` in the frontend is the root; inside it the `pg.query:` spans are the **Postgres queries** of the order (`BEGIN`, `SELECT` the products, `INSERT` the customer, the order and its items, `UPDATE` the stock then the status, `COMMIT`), each with its statement in `db.statement`; then the HTTP calls into the services. The `clickhouse.query` spans are the frontend's ClickHouse queries (search and the dashboard) with the SQL and rows read.

### 5. `empty-searches` [AGENT RUNS] Find the searches that returned nothing

Every storefront search is a span, `search.products`, with `search.query`, `search.locale`, `search.results`, `search.total`, `search.match_mode`, `search.read_rows` and `search.elapsed_ms`. A search that found nothing has `search.results = 0`. They can filter the traces on that in ClickStack; the same list as SQL:

```bash
make ch-query Q="SELECT SpanAttributes['search.query'] AS query, count() AS searches FROM retail_otel.otel_traces WHERE SpanName = 'search.products' AND SpanAttributes['search.results'] = '0' GROUP BY query ORDER BY searches DESC LIMIT 15"
```

Tell them to open one of those traces: the `search.products` span has the `clickhouse.query` span inside it, with the `hasAllTokens` query it ran. (Some English terms like "laptop bag" return nothing by design: the catalogue lacks them.)

### 6. `session-replay` [PARTICIPANT DOES — console] Session replay

"Open the **Sessions** view. Each row is a simulated shopper's browser session, recorded by the browser SDK: click one and play it. You watch the shopper's browsing, and you can jump from the session to its traces and logs."

### 7. `log-search-index` [AGENT RUNS] Log search is the same index as module 04

```bash
make ch-query Q="SHOW CREATE TABLE retail_otel.otel_logs" | grep idx_lower_body
make ch-query Q="SELECT ServiceName, count() FROM retail_otel.otel_logs WHERE hasAllTokens(Body, 'card gateway unavailable') GROUP BY ServiceName"
```

The first shows `INDEX idx_lower_body lower(Body) TYPE text(tokenizer = 'splitByNonAlpha')`: the log search is a full-text search on `Body`, the same technology as `hasAllTokens` on `products_search`. Words split at non-letters, so `card_gateway_unavailable` is searched as `card gateway unavailable` (and `hasToken` with underscores is an error). The second returns nothing yet: that is the exercise.

### 8. `infrastructure` [PARTICIPANT DOES — console] Pods and nodes

"Open any log line from a pod and its **Infrastructure** tab: the pod's CPU and memory over time, and a **pod timeline** of Kubernetes events (such as a container being killed when a deployment rolls out). For the whole cluster open **Dashboards**, **Kubernetes**: the **Pods**, **Nodes** and **Namespaces** tabs list 3 nodes and the pods of `clickshop` and `observability`." The numbers are the kubelet's, collected by the OpenTelemetry DaemonSet; the link to a log line is the pod's identity (`k8s.pod.uid`), which every service adds to its telemetry. If the dashboard is empty: `deploy/bin/kubectl get pods -n observability` should list 4 collectors.

### 9. `break-and-find` [AGENT RUNS] then [PARTICIPANT DOES — console] Break the card gateway, find the cause

This is the part to keep when time is short. **Ask first**: "Ready to break the card gateway on purpose? Card payments will start failing, and you will find out why using only ClickStack." Only on a yes:

```bash
make break-card-gateway
```

Record `notes.card_gateway_broken: true` in the progress file **now**. The gateway answers `502 card_gateway_unavailable` after 1.5 seconds: card payments fail, Pix and Boleto go on (about half the orders pay by card, so give it a minute or two). Tell them: "Find out what happened. Where do you start?" Then coach with a **hint ladder**: give the next hint only when they are stuck, never the answer first.

1. In **Search** on **Logs**, search `card gateway unavailable`. How many services logged it? (Four: `demo-card-gateway`, `demo-payment-card-svc`, `demo-checkout-svc`, `demo-storefront-bff`. The one nearest the cause is the gateway: `journey failed role=card-gateway ... status=502 error=card_gateway_unavailable`.)
2. Open one of the lines and its **Service Map**: where does the failure end?
3. Filter **Traces** on errors: which path are the failing spans on, and how long does each take compared with a normal one? (The card path; about a second longer, because the gateway holds the request before it fails.)
4. On the gateway pod's **Infrastructure** tab, what does the pod timeline show about when this began? (The old container stopping as the deployment rolled out, when you ran the command.)
5. Look at the shoppers: `deploy/bin/kubectl -n clickshop logs deploy/simulator --tail=10`, where `failed` is rising.

When they have the cause, confirm it with SQL:

```bash
make ch-query Q="SELECT ServiceName, count() AS lines FROM retail_otel.otel_logs WHERE hasAllTokens(Body, 'card gateway unavailable') GROUP BY ServiceName ORDER BY lines DESC"
```

### 10. `fix` [AGENT RUNS] Fix it, and watch the errors stop

```bash
make fix-card-gateway
```

Clear `notes.card_gateway_broken` from the progress file. After a minute, show the errors per minute stopping:

```bash
make ch-query Q="SELECT toStartOfMinute(Timestamp) AS minute, count() AS errors FROM retail_otel.otel_logs WHERE hasAllTokens(Body, 'card gateway unavailable') AND Timestamp > now() - INTERVAL 15 MINUTE GROUP BY minute ORDER BY minute"
```

**If the participant stops before this step, run `make fix-card-gateway` anyway before the module ends.**

### 11. `check` [AGENT RUNS] The checkpoint

```bash
make check-08
```

## Talking points

- **One database for business data and telemetry.** Traces, logs and metrics land in `retail_otel`, in the same ClickHouse service as the orders and the clickstream: you can join an error trace to the order it belongs to, with SQL.
- **Following a request:** the service map shows who calls whom; the trace shows the time and the SQL of each hop, down to the Postgres statement; the pod's Infrastructure tab shows what the machine was doing.
- **Logs are searched with the same `text` index** as the product search: `hasAllTokens` with a tokenizer, no `LIKE '%…%'` scans.
- **Failures leave a trail in every layer:** error logs in four services, error spans on one path, a pod timeline entry at the moment of the change, and the shoppers' `failed` counter. Observability is being able to start at any one and reach the cause.
- **Sources:** ClickStack is a UI over tables; a "source" tells it which tables hold which signal.

## Checkpoint

`make check-08` shows traces from all 15 services, frontend traces with `pg.query`, `clickhouse.query` and `search.products` spans, recorded session replays, Kubernetes metrics from 3 nodes, and logs from the demo services. It also reports how many log lines mention `card_gateway_unavailable` (the exercise). It ends `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| ClickStack shows no data | `make clickstack-list`; step 1's queries | The sources must point at `retail_otel` and the right tables; and the tables must be growing (`make status`). |
| `make clickstack-setup` stops and says there is no source | Read its message | The participant opens ClickStack from their service once, then run it again (or they create the sources by hand). |
| The service map is empty or partial | `deploy/bin/kubectl -n clickshop get deploy simulator` | It needs traffic: `make sim-start USERS=4`, wait a few minutes. |
| No session replays | Step 1's third query | They come from the simulator's browsers: `make sim-start USERS=4`. |
| No Kubernetes dashboard data | `deploy/bin/kubectl get pods -n observability` | Should list 4 collectors; if not, `make app`. |
| `make break-card-gateway` seems to do nothing | The simulator log's `failed` counter | Card payments only fail when a shopper pays by card (about half the orders): wait a minute or two. |
| The errors do not stop after the fix | `deploy/bin/kubectl -n clickshop rollout status deploy/card-gateway` | The rollout takes about a minute; give it that, and if the errors continue run `make fix-card-gateway` again. |

## Fast track

`make setup` created the sources (if ClickStack had been opened) and started the shoppers. Do steps 1, 2 (just `make clickstack-list`), then in the console steps 3, 4 and 6 quickly, step 7, and give the time you saved to the exercise (steps 9 and 10).

## Exit criteria

`make check-08` passes, the card gateway is **fixed** (`notes.card_gateway_broken` is not set), and the participant could explain what the failure looked like in logs, traces and on the pod. Update the progress file: module `08` `done`; `current` module `09`.
