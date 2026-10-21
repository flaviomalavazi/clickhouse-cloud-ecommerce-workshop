# Facilitator guide

For the person who runs ClickShop for a group: what to arrange before the day, how the time goes, what usually breaks and how to fix it, and how to reset between sessions. The participants' own guide is the [README](../README.md) and the modules; agent mode is in [AGENTS.md](../AGENTS.md).

> **Items marked TODO(owner) are things only the workshop's owner can answer** (the organization, the costs, what the Cloud console allows). They are listed together at the end.

## At a glance

| | Fast track (about 1 hour) | Guided track (about 4 hours) |
|---|---|---|
| What the participant does | The console steps of [module 01](01-cloud-services/README.md) (two services, access, an API key, `.env`), then `make setup`, then tours what it built. | Every module by hand, in order. |
| What the facilitator does | Makes sure the services exist and the machines are ready; steers the tours. | Same, and walks the room through the waits. |
| Ends with | Everything running locally and in the Cloud; the checks pass. | Same. |

Both can be done by reading the modules ([human mode](../README.md)) or with a coding agent that guides the participant ([agent mode](../agent-mode/README.md): open the repository in the agent and say "start the workshop"). They end in the same place, because they share the same commands and the same checks.

What the participant builds, in one sentence: an online shop whose **orders live in Postgres and are copied to ClickHouse as they happen**, whose **clicks and card payments go straight to ClickHouse**, whose **traces, logs and replays go to ClickStack on the same service**, and which they can then **question in plain language**.

## Before the event

### The organization and the accounts

| What | Check | Why |
|---|---|---|
| **Whose organization** | Decide: each participant in their own, or everyone in one shared organization. | In a shared one, every service is named `clickshop` and `clickshop-pg` unless you ask for a prefix (initials work), an Admin API key sees every service, and the generators of one participant write into that participant's service only. |
| **Managed Postgres is available** | In each participant's organization, in the region you choose (confirmed by the owner: available everywhere the participants are). It is a Beta feature. | The workshop depends on it. |
| **Postgres CDC ClickPipes are available** | Same organizations (confirmed by the owner). | Module 03. |
| **Service sizes** | ClickHouse: any size that is allowed to start; it needs version 26.2 or newer (a new service is). Postgres: "a small size is plenty". | TODO(owner): name the tier you tested with. |
| **Region** | One region for both services, close to the venue. | Replication must not cross regions, and the laptops talk to the Cloud over the internet on every query. |
| **An API key with the Admin role** | For the fast track: each participant creates one (organization **API keys** page) and deletes it in module 10. | `make setup` creates the ClickPipe and the ClickStack sources through the Cloud API. If a key sees several organizations, `.env` also needs `CLICKHOUSE_CLOUD_ORGANIZATION_ID`. |
| **ClickStack** | Open it once from the participant's service (it creates its connection). | Otherwise the last step of `make setup` reports `NOT DONE` and tells them to open it and run `make clickstack-setup`. |
| **ClickHouse Agents** (module 09) | A Beta feature, available in the participants' organizations (confirmed by the owner). Creating agents needs the **Create agent** option. | TODO(owner): the permission's name and where an admin grants it, and a console walk-through: module 09 is a draft until then. Decide whether to run it as a demo. |
| **Langfuse Cloud** (module 09's optional final step) | Each participant who does it needs an email address and an **organization admin** role in ClickHouse Cloud, and creates a free Langfuse **Hobby** account (no card) in one region, EU or US. Keys belong to a region and a project. The ClickHouse side is a Public Beta for newly created chats. | TODO(owner): where ClickHouse Agents takes the keys (nothing documents it); whether participants should share one Langfuse project (a trace holds the whole conversation, so probably not); the Hobby plan's current limits. Decide whether to run it as a demo. |
| **Cost** | The ClickHouse service and the Postgres instance bill while they exist, and the **$300 of ClickHouse Cloud trial credits cover the workshop** (confirmed by the owner). [Module 10](10-cleanup/README.md) removes both when it is over. | Nothing to arrange, as long as each participant is on a trial organization. |

If someone is blocked at the console (a service will not start, a feature is missing), have **a spare set of services** ready, created beforehand, so they can continue with `.env` filled from yours (and then delete it).

### The machines

| Need | How to check |
|---|---|
| Docker (Docker Desktop, OrbStack or Colima) with **8 GB of memory and 4 CPUs**, and about **10 GB of free disk** (15 GB is comfortable) | `make check-00` |
| `make`, `git`; also `curl` and `python3`, which macOS and Linux already have | `make check-00` |
| Nothing else is installed: `k3d`, `kubectl` and `helm` run from containers | |

Tested on macOS (Apple silicon) with OrbStack. Docker Desktop and Colima are expected to work the same way. Linux and Windows (WSL2) have not been tried. macOS's own `bash` 3.2 is supported (a first-run failure on it was found and fixed in the dry run).

### The network

Everyone needs, **once** (the day before, `make prefetch`): Docker Hub, `ghcr.io` and `registry.k8s.io` (images), the package registries the image builds use (npm, PyPI, Debian), and `open-telemetry.github.io` (the collector's Helm chart). That is several gigabytes (the browser image alone is 1.5 GB).

And **during** the workshop:

| What | Port | Used by |
|---|---|---|
| The participant's ClickHouse service | 8443 (HTTPS), 9440 for `make ch-client` | everything that reads or writes ClickHouse |
| The participant's Postgres instance (the **direct** endpoint) | 5432 | the application, the seed, `make pg-query` |
| `api.clickhouse.cloud` | 443 | `make setup`, `make clickpipes`, `make clickstack-setup`, `make cloud-ids` |
| Iglu Central (Snowplow Micro fetches event schemas from it) | 443 | the storefront's behaviour events |
| The ClickHouse Cloud console | 443 | the console steps |

Many venue and corporate networks block outbound `5432`: test it from the room (`make doctor` connects to both services). Proxies have not been tried.

### The day before

- **Everyone:** clone the repository, run `make prefetch` (about 4 minutes cold on a fast connection), then `make check-00`. Do not let anyone find out on the day.
- **You:** a full rehearsal on a clean machine, with a stopwatch (the table below), and the spare services.
- **For the one-hour format**, consider creating the services before the session and handing each participant their credentials, so the hour starts at `.env`. Creating them live takes most of module 01's 20 minutes (the services take minutes to start). TODO(owner): decide, and how credentials are handed out safely.

## Rehearsal record

Measured on one machine (macOS, Apple silicon, OrbStack, 14 CPUs, 11.7 GiB for Docker) against one service. The last column is for your rehearsal on a second machine.

| Step | Measured | Your run |
|---|---|---|
| `make prefetch`, six images built with no cache from a fresh clone (base images already local) | 3 min 57 s (frontend 2 min, simulator 1 min 24 s, the rest under 15 s each) | |
| `make setup` from a fresh clone, services and data already existing (the ClickPipe, the seed and the history are recognised and skipped) | 2 min 39 s, of which cluster and application 1 min 37 s and the browser image 17 s | |
| The ClickPipe, from the request to `Running` | 26 s | |
| A change in Postgres reaching ClickHouse | 38 to 63 s (60 s sync interval) | |
| `make backfill` (30 days, about 5 million events) | 1 min 34 s to 1 min 43 s | |
| `make ch-bootstrap`, `make pg-setup`, `make ch-search`, `make ch-mvs` | 3 s, 13 s, 2 s, 4 s | |
| **Creating the two services in the console** | **not measured** | |
| **A first `make setup` from empty services** (the ClickPipe created, Postgres seeded, the history loaded) | **not measured**: the parts add up to about 10 minutes after `make prefetch` | |
| Module 09 | **not measured** | |

## Running the session

### The fast track in an hour

A suggestion, to steer by. It assumes `make check-00` passes for everyone and the services exist (or are created in the first minutes).

| Minutes | What | Notes |
|---|---|---|
| 0 to 10 | Welcome, the architecture, the console steps and `.env` ([module 01](01-cloud-services/README.md)) | `make doctor` is the gate. |
| 10 to 20 | `make setup` | Talk while it runs (below). |
| 20 to 30 | The CDC exercise ([module 03](03-cdc-clickpipe/README.md)) | The best ten minutes of the workshop: an order by hand, then its versions in ClickHouse. |
| 30 to 36 | Search ([module 04](04-full-text-search/README.md)) and the storefront ([module 05](05-run-the-app/README.md)) | Place a real order and follow it. |
| 36 to 44 | The dashboard and the shoppers ([module 06](06-real-time-analytics/README.md), [07](07-simulated-shoppers/README.md)) | The shoppers are already running. |
| 44 to 54 | ClickStack and the break-and-fix exercise ([module 08](08-observability-clickstack/README.md)) | Run it as a demo if the room is behind. |
| 54 to 60 | Agents ([module 09](09-clickhouse-agents/README.md)) and cleanup ([module 10](10-cleanup/README.md)) | Cleanup can be a handout: remind them that the services bill until deleted. |

The guided track is the module times in the README table: about four hours with breaks, and module 02 is optional.

### While `make setup` runs

It prints `[n/13]` lines. Use each wait:

| Step | What to say |
|---|---|
| Migrations, then the ClickPipe | Postgres is the shop's source of truth; the pipe reads its write-ahead log, so nothing in the application knows ClickHouse is copying it. |
| Seed, then "wait for the pipe" | The rows arrive as *changes*, not as a bulk copy: the same path every later order takes. |
| Search | A full-text index and a view that rebuilds a table every five minutes. |
| Rollups | Aggregation at insert time, so the dashboard reads thousands of rows, not millions. |
| Cluster and application | Kubernetes in Docker; the application stays on the laptop, the data in the Cloud. |
| ClickStack sources | The observability data is in the same service as the orders. |
| History, generators, shoppers | Large batches, and traffic that is real (browsers clicking the real page). |

`make setup` leaves the generators and the shoppers running: they write about 200 events and 20 card transactions a second into the participant's service until `make traffic-stop`.

### Seeing who is stuck

- `make doctor` (configuration and both services), `make status` (pods and the freshness of every table), `make check-NN` (a module's result). Each failure says what to do.
- `make setup` is safe to repeat, and `SKIP="backfill simulator" make setup` leaves steps out.
- In agent mode, `.workshop/progress.json` says where the agent and the participant are.

## When something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `make prefetch` or any `make` command fails at once with `net_flags: unbound variable` | An old checkout, on macOS's bash 3.2 | `git pull`: fixed in Phase 10. |
| Pods `Pending` or evicted, "no space left" | Docker's disk is nearly full (the cluster nodes keep their own copy of every image) | `docker system df`; `docker builder prune -f` is safe; keep 10 GB free. |
| `make up` or `make doctor`: port 3000 in use | A local `npm run dev` or another app | Stop it. |
| `make doctor`: `Postgres: could not connect` | The instance is still starting, or **IP access** does not allow the laptop (or the venue's address changed) | Check the instance's **IP access**; test 5432 from the network. |
| `certificate verify failed` or `PGSSLROOTCERT ... was not found` | The wrong file, or a path that is not relative to the repository root | `assets/certs/ca-certificate.pem`. |
| `Cloud API ... 401` or `403` | The API key is wrong or is not an Admin key | Create it again (module 01, step 6). |
| `make setup` ends with `NOT DONE` for ClickStack | ClickStack was never opened for the service | Open it once from the service in the console, then `make clickstack-setup`. |
| `check-03`: not in step with Postgres | The ClickPipe is behind | Wait one sync interval (60 s) and run it again. |
| `check-07` or `check-08`: no order of a payment method, no traces from a service | The shoppers have not run long enough | About ten minutes. |
| **Every card payment fails on a new cluster** | Expected when `CARD_GATEWAY_DOWN=true` is in `.env` (the gateway reads it from there): it is how the demo gives ClickStack errors to show. `make doctor` says so. | To stop it, remove the line and run `make apply-env` if the cluster is running (`make fix-card-gateway` works until the cluster is recreated). |
| Search finds nothing, or shows the old stock | `products_search` is rebuilt every five minutes | `SYSTEM REFRESH VIEW retail_analytics.products_search_refresh` then `SYSTEM WAIT VIEW ...` (the first only starts it). |
| The dashboard's "right now" tiles, or a "last hour" question, are empty | The load is stopped | `make traffic-start`. |
| A "legacy builder is deprecated" notice before every image build | Docker has no buildx plugin (on OrbStack its link in `~/.docker/cli-plugins` is missing) | `make doctor` says how to add it. The images build either way, and faster with it. |
| Events do not arrive in the dashboard, and `make logs S=snowplow-micro` shows schema errors | Snowplow Micro cannot reach Iglu Central (the venue's network) | Allow it, or move network. (Likely cause; not reproduced.) |
| The ClickPipe is in an error state | Usually IP access, or the pooler address was used | Its page in the console shows the message. |

## Between sessions: resetting

**The same services, a new group (light reset).**

1. `make traffic-stop` (it says "nothing to stop" if nothing runs).
2. `make nuke-data`, in the participant's own terminal (it waits for a typed word): Postgres is reseeded, the replica in ClickHouse is emptied and refills through the pipe, and the shoppers stop. **Events and telemetry are not touched on purpose** (they are slow to fill again), so the dashboards still show the previous group's history, and `make backfill` refuses to load it twice.
3. `make down` if the local cluster should go too; `make up` brings it back in about two minutes (`make start` brings back the generators and the shoppers too).
4. Agent mode: delete `.workshop/progress.json`. In the console, delete the agent and its memories from module 09 if you want them gone.

**Fresh services (full reset).** [Module 10](10-cleanup/README.md), in its order: the ClickPipe, then the Postgres instance, then the ClickHouse service, then the API key; then `rm .env assets/certs/*.pem`.

**Local leftovers.** `.workshop/` holds the kubeconfig, the downloaded chart and the agent's progress. It is safe to delete once the cluster is down.

## Open items (TODO(owner))

Settled by the owner: Managed Postgres, Postgres CDC ClickPipes and ClickHouse Agents are available in the participants' organizations; the cost is covered by the $300 trial credits; prebuilt images on GHCR will **not** be published (the images are always built on the participant's machine); `CARD_GATEWAY_DOWN=true` in `.env` is intentional.

1. The tier of the services the workshop was tested with (the Postgres size in particular).
2. ClickHouse Agents: the permission to create agents, where an admin grants it, and the console walk-through of [module 09](09-clickhouse-agents/README.md) (its list of questions is in `docs/decisions.md`, section "Phase 9"), including where the Langfuse credentials are entered (the optional final step: see [the Langfuse page](09-clickhouse-agents/langfuse.md)).
3. Co-authoring and checking the analyst's candidate questions (ten so far) in `agents/clickshop-analyst/questions.md`.
4. Shared organization or one each, and how the services' credentials reach the participants (pre-provisioning for the one-hour format).
5. The console steps of modules 01 and 03, walked through once on a clean organization (the labels were confirmed in the Phase 7 review; the flow has not been timed).
6. A rehearsal on a second machine and a fresh organization, filling in the "Your run" column.
