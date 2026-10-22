# Module 00: Prerequisites (agent playbook)

**Objective:** the participant's machine can run the workshop and everything it needs is downloaded, so the later modules do not wait on the network.

**Step ids:** `docker-ready`, `tools-present`, `prefetch`, `check`.

**Time:** 5 minutes if `make prefetch` has been run before; otherwise about 5 minutes of downloading on a fast connection (more on conference wifi). Ideally done **before** the workshop.

## Preconditions

You are in the repository root:

```bash
ls Makefile AGENTS.md agent-mode/README.md
```

If `make check-00` already passes, tell them they are ready, mark the module `done`, and go to module 01.

## Steps

### 1. `docker-ready` [AGENT RUNS] Is Docker running, and big enough?

Say: "The workshop runs the shop, the generators and a small Kubernetes cluster in Docker, so Docker needs room."

```bash
docker version --format '{{.Server.Version}}'
docker info --format 'memory={{.MemTotal}} cpus={{.NCPU}}'
```

It needs **4 CPUs** and at least **4 GB of memory**; 8 GB is comfortable. Docker reports a little under its setting (an 8 GB setting shows about 7.7 GiB, a 4 GB one about 3.8), so do not judge it by hand: `make check-00` passes from 3.75 billion bytes up, and under 7.5 billion it adds the note `under 8 GB: keep the load light`.

If Docker is not running, or is too small: **[PARTICIPANT DOES — console]** start Docker Desktop / OrbStack / Colima, and in its settings (Docker Desktop: *Settings, Resources*) give it 8 GB if the machine has room (4 GB at least) and 4 CPUs, then restart it. Wait until they say it is running, and run the commands again. You do not install Docker for them.

### 2. `tools-present` [AGENT RUNS] Are `make` and `git` there?

```bash
command -v make git docker
```

If `make` or `git` is missing: on macOS the participant runs `xcode-select --install` (Debian and Ubuntu: `apt install make git`). They do it; you do not install software. Nothing else is needed: `k3d`, `kubectl` and `helm` run from containers through wrappers in `deploy/bin/`.

### 3. `prefetch` [AGENT RUNS] Download and build everything

Say what it does: it pulls the tool images and the Kubernetes node image, builds the six workshop images (storefront, demo services, Snowplow bridge, OpenTelemetry gateway, generators, simulator), pulls Snowplow Micro and the OpenTelemetry collector, and downloads the collector's Helm chart. It needs the internet once and skips whatever is already there.

```bash
make prefetch
```

About 5 minutes from empty: run it in the background (see `AGENTS.md`, "Long commands") and use the wait for the talking points below. If it fails halfway, run it again: finished images are kept.

### 4. `check` [AGENT RUNS] The checkpoint

```bash
make check-00
```

## Talking points

- **Everything on the laptop is in containers.** The storefront, its 14 small services, Snowplow, the generators and the shoppers run in a k3d cluster (Kubernetes in Docker: one server, two agents). Nothing is installed besides Docker, `make` and `git`, and their own `~/.kube/config` is never touched.
- **The data and the intelligence are in the cloud.** ClickHouse Cloud holds search, analytics and observability; Managed Postgres holds the orders. Your laptop holds only the application.
- **Why prefetch before the day:** the first run downloads several gigabytes. The workshop also needs the internet while it runs (Snowplow Micro fetches schemas, and the services are in the cloud).

## Checkpoint

`make check-00` prints a `✓` for each of: Docker running, 4 CPUs and at least 4 GB of memory, 10 GB of free disk, the tool images, the six workshop images, the collector chart, and port 3000 free. It ends with `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| `the Docker daemon is not running` | `docker version` | The participant starts Docker and waits until it says it is running. |
| `Docker has less than 4 GB of memory` | `docker info --format '{{.MemTotal}}'` | The participant raises it in Docker's settings and restarts Docker. |
| `under 8 GB: keep the load light` (a note, the check passes) | `docker info --format '{{.MemTotal}}'` | The workshop runs at half the load. When they fill in `.env` in module 01, ask them to add `SIM_USERS=2`, `SIM_ARRIVALS_PER_MINUTE=3`, `PRODUCE_TARGET_EPS=100` and `CC_TARGET_TPS=10` (they edit it, not you). `make doctor` then shows `SIM_USERS=2`, and every command that starts shoppers uses it: never pass `USERS=` yourself. If the machine still swaps, `make sim-stop`. |
| `port 3000 is in use` | `lsof -i :3000` (shows the process) | Something of theirs uses it (often a local `npm run dev`). They stop it. (If the clickshop cluster already exists, this is fine.) |
| A pull or build fails halfway | The last lines of the output | `make prefetch` again. |
| `no space left`, or fewer than 10 GB free | `docker system df` | `docker builder prune -f` frees build cache. Anything more is the participant's decision (their other images may be needed): ask before suggesting `docker image prune`. |
| `make: command not found` | `command -v make` | `xcode-select --install` (macOS) or `apt install make`. |

## Fast track

Nothing changes: `make check-00` should pass before the day. If it does, skip to module 01.

## Exit criteria

`make check-00` ends with `All checks passed`. Update the progress file: module `00` `done`, `current` module `01`.
