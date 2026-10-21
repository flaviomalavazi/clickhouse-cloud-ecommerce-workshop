# Module 10: Cleanup

**Goal:** remove everything the workshop created, locally and in the cloud, so nothing keeps running, or costing money.

**Time:** about 10 minutes. `make down` takes 10 s.

**You'll learn:** what depends on what, and so the order in which to delete it.

## Before you start

You are done with the other modules, or you are stopping.

## Steps

### 1. Stop the load and remove the local cluster

```bash
make traffic-stop      # optional: stops the generators and the simulator
make down
```

`make down` deletes the k3d cluster: the three node containers and the load balancer, their network and their volume, and everything that ran inside them. Nothing in the cloud is touched, and your Docker images are kept (they are what makes the next start two minutes instead of ten). Delete them too if you want the disk back: `docker image prune -a` removes every unused image, so use it only if nothing else of yours needs them.

### 2. Delete the cloud services, in this order

In the ClickHouse Cloud console:

1. **Delete the ClickPipe first.** It holds a replication slot (a bookmark Postgres keeps for the pipe) and a connection to your Postgres instance. If the instance goes first, the pipe is left pointing at nothing.
2. **Delete the Managed Postgres instance.**
3. **Stop, then delete, the ClickHouse service.** ClickStack's sources and connection go with it.
4. **Delete the API key** you created in module 01 (the organization's **API keys** page). It has the Admin role and would outlive your `.env`. (If you built an agent in module 09, delete it from the Agent Builder too.)

### 3. Remove your credentials from this machine

Your `.env` holds both passwords and `assets/certs/` holds the Postgres certificate; both are ignored by git, and neither is needed any more:

```bash
rm .env assets/certs/*.pem
```

## Checkpoint

```bash
make check-10
```

No `k3d-clickshop` container, network or volume is left, and the local kubeconfig is gone. (The check cannot see the cloud: look at the console and confirm the three services are gone.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `make down` says the cluster does not exist | It is already gone: nothing to do. |
| `check-10` finds containers | `make down` again; if Docker was restarted in between, `docker ps -a --filter name=k3d` shows what is left. |
| The console will not delete the Postgres instance | Delete its ClickPipe first. |

**That is the workshop.** If you want to run it again, start at [module 01](../01-cloud-services/README.md) (module 00 again only if you removed the Docker images).
