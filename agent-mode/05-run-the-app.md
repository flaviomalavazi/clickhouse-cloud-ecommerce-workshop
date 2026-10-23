# Module 05: Run the app (agent playbook)

**Objective:** the ClickShop storefront and its services run on a local Kubernetes cluster, the participant places an order in the browser and follows it into ClickHouse and into search, and knows how to look around the cluster.

**Step ids:** `start-app`, `check-app`, `use-storefront`, `follow-order`, `follow-stock`, `look-around`, `check`.

**Time:** guided about 25 minutes (starting everything takes about 2 to 3); fast-track tour about 8.

## Preconditions

```bash
make check-04
```

It must pass. Then see whether the cluster is already up (the fast track's `make setup` starts it):

```bash
make status
```

If it lists the pods in `clickshop` as `Running`, skip step 1.

## Steps

### 1. `start-app` [AGENT RUNS] Start the cluster and the application

```bash
make up
```

`make up` is `make cluster images secrets app` in one command. About 2 to 3 minutes; run it in the background and use the wait for the talking points. Say what each part does:

| Command | What it does |
|---|---|
| `make cluster` | Creates a k3d cluster named `clickshop`: one server and two agents (three Docker containers acting as Kubernetes nodes), with port **3000** on their machine mapped to the cluster's ingress. |
| `make images` | Loads the images built in module 00 into the three nodes. Only what changed is loaded again. |
| `make secrets` | Puts `.env` into the cluster as a Secret, and the Postgres certificate as another (you never see their contents). |
| `make app` | Installs the application chart into the namespace `clickshop`, and the two OpenTelemetry collectors into `observability`, then waits until the pods are ready. |

It ends with `ClickShop is running: http://localhost:3000`.

### 2. `check-app` [AGENT RUNS] The first check

```bash
make check-05
```

### 3. `use-storefront` [PARTICIPANT DOES — console] Place an order

They open <http://localhost:3000> (the page follows the browser's language: English, Portuguese or Spanish, and search works in all three) and:

1. type `running shoes` in the search box (these results come from the `products_search` table of module 04, through the full-text index);
2. open a product and **note its name and stock**; they are about to buy one;
3. click **Add to Cart**, open the cart and click **Proceed to checkout**;
4. enter any name and email (nothing is charged), choose **Pix**, click **Continue to payment**, and on the next screen **I have completed the payment**.

They land on a confirmation page with an **order number**: ask for it, and for the product's name.

### 4. `follow-order` [AGENT RUNS] Follow the order into ClickHouse

Say: "The storefront wrote the order to **Postgres**: an `orders` row, its `order_items`, and one less unit in `stock`, in one transaction. It reaches ClickHouse after the ClickPipe's next sync, up to a minute." Poll every 15 seconds:

```bash
make ch-query Q="SELECT id, status, payment_method, total_amount, created_at FROM retail_oltp.orders FINAL WHERE id = ORDER_NUMBER AND _peerdb_is_deleted = 0"
```

With their order number in place of `ORDER_NUMBER`: the shoppers of the fast track are placing orders too, so look it up by number and do not wait for "the newest". The order appears, with status `confirmed` (it was inserted as `pending` and confirmed about two seconds later; the pipe delivered both changes together, so ClickHouse only has the final one: module 03 showed the versions). Then what was in the newest orders:

```bash
make ch-query FILE=sql/clickhouse/examples/05_run_the_app.sql N=2
```

### 5. `follow-stock` [AGENT RUNS] Follow the stock into search

The products of their order only (query 3 of the example file does it for any product, and with the shoppers running its ten rows are other people's):

```bash
make ch-query Q="SELECT s.product_id, s.quantity AS stock_in_replica, ps.stock_quantity AS stock_in_search, s.quantity != ps.stock_quantity AS stale FROM retail_oltp.stock AS s FINAL INNER JOIN retail_analytics.products_search AS ps ON ps.product_id = s.product_id WHERE s._peerdb_is_deleted = 0 AND s.product_id IN (SELECT product_id FROM retail_oltp.order_items FINAL WHERE order_id = ORDER_NUMBER AND _peerdb_is_deleted = 0)"
```

For a while their products show `stale = 1`: the replica has the new stock and search does not, until the refreshable view runs (at most five minutes later). Skip the wait:

```bash
make ch-query Q="SYSTEM REFRESH VIEW retail_analytics.products_search_refresh; SYSTEM WAIT VIEW retail_analytics.products_search_refresh"
```

(`SYSTEM REFRESH VIEW` only starts the refresh; `SYSTEM WAIT VIEW` waits until it is done, so the next query sees the result.) Run the products query again.

`stale` is now `0`; they reload the product page and see the new stock. The whole path, **Postgres, ClickPipe, `retail_oltp`, refreshable view, `products_search`, storefront**, takes the sync interval plus up to five minutes, or only the sync interval if the view is refreshed by hand.

### 6. `look-around` [AGENT RUNS] Look around the cluster

The repo carries wrappers, so nothing is installed:

```bash
deploy/bin/kubectl get nodes
deploy/bin/kubectl get pods -n clickshop -o wide
deploy/bin/kubectl get svc,ingress -n clickshop
deploy/bin/kubectl get pods -n observability
deploy/bin/helm list -A
make status
```

Three nodes, 18 pods in `clickshop` (21 while the generators and the shoppers run), and in `observability` one OpenTelemetry collector per node plus one for the whole cluster. Explain the pods in groups: `frontend` (the Next.js storefront: reads and writes Postgres, reads ClickHouse for search and the dashboard); the 14 small services the checkout calls (`storefront-bff`, `catalog-svc`, `checkout-svc`, pricing, inventory, the three payment services and their gateways, `order-svc`, `ledger-svc`, `email-gateway`: they hold no data, they exist so that traces in module 08 have something to show); `snowplow-micro` and `snowplow-bridge` (behaviour events go to Snowplow Micro, the bridge inserts them into ClickHouse); `otel-gateway` (the ClickStack collector: everything observable lands there, then in `retail_otel`). `make status` also shows the row count and freshness of every table in both databases.

### 7. `check` [AGENT RUNS] The checkpoint

```bash
make check-05
```

## Talking points

- **What runs where:** the application, the generators and the simulator on the laptop (Kubernetes in Docker); the database, search and observability in ClickHouse Cloud. The app talks to both clouds over TLS.
- **One write, three destinations:** a Postgres transaction is the source; ClickHouse gets it through CDC (a minute); search gets it through the refreshable view (up to five more). Each hop has a number, and the participant just measured them.
- **Why the order is `confirmed`:** the app inserts then confirms within seconds; CDC delivers the changes batched, so the analytical side sees the end state. Know which questions can only be answered from the transactional side.
- **Looking around Kubernetes:** nodes, pods, services, ingress. The cluster is disposable: `make down` and `make up` bring it back in minutes, and `make stop` pauses it without deleting anything.

## Checkpoint

`make check-05` shows every pod `Ready`, the storefront answering on port 3000, the catalogue loading from Postgres, search finding `jeans` through ClickHouse, the Kubernetes collectors ready, and Snowplow Micro answering. It ends `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| `make cluster` says port 3000 is in use | `lsof -i :3000` | They stop what uses it; then (with their ok) `make down` and `make up` again. |
| Pods stay `ImagePullBackOff` | `deploy/bin/kubectl get pods -n clickshop` | The images were not loaded: `make images`. |
| `make app` times out | `make status` shows which pods are not ready; `deploy/bin/kubectl -n clickshop logs deploy/<pod> --tail=40` says why | A frontend that cannot reach Postgres or ClickHouse is the usual cause: `make doctor`. |
| The storefront shows an error page | `deploy/bin/kubectl -n clickshop logs deploy/frontend --tail=40` | Read the error; usually the databases (`make doctor`). |
| Search finds nothing | `make ch-query Q="SELECT count() FROM retail_analytics.products_search"` | Empty: module 04, `SYSTEM REFRESH VIEW`. |
| Their order is not in ClickHouse after two minutes | `make clickpipes-status`; `make status` | The pipe is behind or stopped: ask them to look at its page in the console. |
| They changed `.env` | n/a | `make apply-env` updates the Secret and restarts the pods that read it. |
| Pods are evicted, or Docker is slow | `docker system df` | Docker's disk is nearly full: they need about 10 GB free; `docker builder prune -f` is safe. |
| A command fails with `UPGRADE FAILED: context deadline exceeded`, or pods stay `Pending` or `Terminating` (usually after Docker restarted or updated) | `deploy/bin/kubectl get nodes` | A node is `NotReady`: `make up` restarts the stuck nodes. Then run the command that failed again. |

## Fast track

`make setup` started everything. Skip step 1; run step 2, then steps 3 to 5 (the order is the best part: they place a real order and watch the numbers move) and step 6 in two minutes.

## Exit criteria

`make check-05` passes. Update the progress file: module `05` `done`; `current` module `06`.
