# Module 00: Prerequisites

**Goal:** get your machine ready, and download everything once, **before the workshop day**.

**Time:** about 15 minutes of your own time. Most of it is `make prefetch` downloading and building: 4 min 23 s from empty on a fast connection, longer on conference wifi, which is why you do it in advance.

**You'll learn:** how the workshop runs on your laptop. The application, the generators and the simulator run in a small Kubernetes cluster (k3d) on Docker; the database, search and observability run in ClickHouse Cloud.

## Before you start

- A laptop with 8 GB of memory and 4 CPUs to spare for Docker (4 GB of memory is the minimum: with less than 8 the workshop runs with a lighter load, see Troubleshooting), and about 10 GB of free disk (15 GB is comfortable: `make doctor` calls less than that tight).
- A ClickHouse Cloud account where you can create a service and a Managed Postgres instance.
- A browser, and an internet connection.

Tested on macOS (Apple silicon) with OrbStack. Docker Desktop and Colima work the same way, and so should Linux. On Windows use WSL2 (not tested).

## Steps

1. **Install a Docker engine** (Docker Desktop, OrbStack or Colima) and give it **8 GB of memory and 4 CPUs** (at least 4 GB of memory). In Docker Desktop that is *Settings, Resources*. Start it.

2. **Install `make` and `git`.** On macOS, `xcode-select --install` installs both.

   That is all you install. `k3d`, `kubectl` and `helm` run from pinned container images through small wrappers in `deploy/bin/`, so there is nothing to install and your own `~/.kube/config` is never read or changed. (To use them like normal commands, run `export PATH="$PWD/deploy/bin:$PATH"` in the repo.)

3. **Clone the repository** and go into it:

   ```bash
   git clone https://github.com/flaviomalavazi/clickhouse-cloud-ecommerce-workshop.git
   cd clickhouse-cloud-ecommerce-workshop
   ```

4. **Download and build everything:**

   ```bash
   make prefetch
   ```

   It pulls the tool images and the Kubernetes node image, builds the tools image (Python and `psql`, for the database tasks) and the six workshop images (storefront, demo services, Snowplow bridge, OpenTelemetry gateway, generators, simulator), pulls Snowplow Micro and the OpenTelemetry collector, downloads the collector's Helm chart and pulls the ClickHouse client image. It needs the internet **once**. Run it again whenever you like; whatever is already there is skipped.

5. **Check:**

   ```bash
   make check-00
   ```

## Checkpoint

`make check-00` prints a ✓ for each of: Docker running, 4 CPUs and at least 4 GB of memory (under 8 GB it also prints a note: keep the load light), 10 GB of free disk, the tools image built, the tool images downloaded, the six workshop images built, the collector chart downloaded, and port 3000 free. It ends with `All checks passed`.

The workshop needs the internet while it runs too: Snowplow Micro fetches event schemas from Iglu Central, and the Cloud services are, of course, in the cloud.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `the Docker daemon is not running` | Start Docker Desktop or OrbStack, wait for it to say it is running, run the check again. |
| `Docker has less than 4 GB of memory` | Raise it in the Docker settings and restart Docker. |
| `under 8 GB: keep the load light` | It runs, but with half the load: add `SIM_USERS=2`, `SIM_ARRIVALS_PER_MINUTE=3`, `PRODUCE_TARGET_EPS=100` and `CC_TARGET_TPS=10` to `.env` before `make setup` (if the cluster is already up: `make apply-env`, then `make sim-start`). `make check-07` then needs about 20 minutes of shoppers instead of 10. |
| `port 3000 is in use` | Something on your machine uses it (often a local `npm run dev`). Stop it; the storefront needs 3000. |
| `make: command not found` | `xcode-select --install` on macOS, or `apt install make` on Debian and Ubuntu. |
| A pull or build fails halfway | Run `make prefetch` again; finished images are kept. |
| Pods get evicted later, or builds fail with "no space left" | Docker's disk is full. `docker system df` shows what takes the space and `docker builder prune` frees build cache. The three cluster nodes each keep a copy of the images, so keep 10 GB free. |
| `docker: command not found` or it cannot connect | Docker is not installed, not running, or your shell is not pointed at it (`docker context ls`). |

## Going further

- Look in `deploy/versions.env`: every tool version the workshop uses is pinned there.
- `deploy/k3d/cluster.yaml` is the whole cluster definition: one server, two agents, port 3000 mapped to the load balancer.

**Next:** [module 01, Cloud services](../01-cloud-services/README.md).
