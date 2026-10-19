#!/usr/bin/env python3
"""
ClickShop traffic simulator
============================

Simulates realistic e-commerce shoppers against a running ClickShop instance by
driving a real headless Chromium browser via Playwright: the JS tracker in the
page fires the Snowplow events itself, and the page's HyperDX SDK emits the
browser telemetry. The frontend must be reachable at --url. Shoppers that reach
checkout place real orders: they are written to Postgres, decrement stock, and
flow on to ClickHouse through the CDC ClickPipe.

Sessions arrive as a Poisson process and follow the funnel defined in
traffic_profile.py — the same file the producers read, so both generators emit
the same funnel (see config.apply_workshop_funnel for the one difference).

Arrival rate
------------
By default `--arrivals-per-minute` is a flat rate, so the load is predictable.
With --diurnal it is the *daily average* instead, scaled by the hour-of-day curve
in traffic_profile.HOURLY_WEIGHTS: ~0.10× at the 04:00 trough and ~2.94× at the
20:00 peak (UTC-03). That peak needs almost three times the browsers, so it is
meant for a long run on a machine with room for them.

Throughput
----------
A session holds a browser for its whole duration, so sustained arrivals need
`--sessions` ≈ arrivals/s × duration (Little's law). `--dwell-scale` compresses
every dwell time: at 1.0 a session lasts minutes; at the default 0.1 about 35 s
including page loads, which is why 6 arrivals a minute needs about 4 browsers. Each browser costs about
300 MB. The simulator prints the concurrency it needs at startup and warns if
`--sessions` is short.

Usage examples
--------------
  # Quick test against a local stack
  python simulate.py --url http://localhost:3000 --duration 120

  # Run until stopped, with more shoppers
  python simulate.py --url http://localhost:3000 \\
      --duration 0 --sessions 8 --arrivals-per-minute 12
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import os
import random
import signal
import statistics
import sys
import time

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

import config
import identity

# session_browser imports Playwright at module scope, so it is loaded lazily.
# (Importing it here made the "playwright is not installed" check in main()
# unreachable — the import crashed first.)

# Time a session spends loading pages and waiting for responses, on top of its
# dwell times. It does not shrink with --dwell-scale.
NAVIGATION_OVERHEAD_S = 12.0


def _setup_telemetry(frontend_url: str) -> None:
    """Export loadgen traces."""
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or f"{frontend_url.rstrip('/')}/api/otlp"
    provider = TracerProvider(
        resource=Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "loadgen")})
    )
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces"))
    )
    trace.set_tracer_provider(provider)


# ── Stats collector ───────────────────────────────────────────────────────────

@dataclasses.dataclass
class Stats:
    """
    Plain counters. The simulator is single-threaded asyncio, so `inc` needs no
    lock — increments can never interleave between await points.
    """

    _data: dict[str, int] = dataclasses.field(default_factory=dict)

    def inc(self, key: str, n: int = 1) -> None:
        self._data[key] = self._data.get(key, 0) + n

    def get(self, key: str) -> int:
        return self._data.get(key, 0)

    def print_summary(self, elapsed: float) -> None:
        g = self.get
        sessions = g("sessions_started")

        def pct(n: int) -> str:
            return f"{n / sessions * 100:.1f}%" if sessions else "n/a"

        print("\n" + "─" * 56)
        print(f"  Simulation complete  ({elapsed:.0f}s)")
        print("─" * 56)
        print(f"  Sessions started     {sessions:>10,}")
        print(f"  Sessions completed   {g('sessions_completed'):>10,}")
        print(f"  Session errors       {g('session_errors'):>10,}")
        print(f"  Bounce rate          {pct(g('bounces')):>10}")
        print(f"  Page views           {g('page_views'):>10,}")
        print(f"  Searches             {g('searches'):>10,}")
        print(f"  Product views        {g('product_clicks'):>10,}")
        print(f"  Added to cart        {g('cart_adds'):>10,}")
        print("─" * 56)
        print(f"  Orders placed        {g('orders_placed'):>10,}   ({pct(g('orders_placed'))} of sessions)")
        for method in ("credit_card", "pix", "boleto"):
            print(f"    {method:<18} {g('orders_' + method):>10,}")
        print(f"  Orders failed        {g('orders_failed'):>10,}")
        print(f"  Sold out             {g('out_of_stock'):>10,}")
        declined = sum(g(k) for k in ("declined_credit_card", "declined_pix", "declined_boleto"))
        if declined:
            print(f"  Payments declined    {declined:>10,}")
        if g("arrivals_dropped"):
            print(f"  Arrivals dropped     {g('arrivals_dropped'):>10,}  (raise --sessions)")
        print("─" * 56)


# ── Progress heartbeat ─────────────────────────────────────────────────────────

async def _heartbeat(
    stats: Stats,
    tasks: set[asyncio.Task],
    args: argparse.Namespace,
    start: float,
    interval: float = 30.0,
) -> None:
    """Print a live progress line every `interval` seconds until cancelled."""
    while True:
        await asyncio.sleep(interval)
        elapsed = time.monotonic() - start
        mult = config.hour_multiplier() if args.diurnal else 1.0
        print(
            f"[sim] t+{elapsed:>6.0f}s  active={len(tasks):<4} "
            f"x{mult:.2f} ({args.arrivals_per_minute * mult:>6,.1f}/min)  "
            f"sessions={stats.get('sessions_started'):<6,} "
            f"views={stats.get('page_views'):<7,} "
            f"searches={stats.get('searches'):<5,} "
            f"carts={stats.get('cart_adds'):<5,} "
            f"orders={stats.get('orders_placed'):<5,} "
            f"failed={stats.get('orders_failed'):<4,} "
            f"soldout={stats.get('out_of_stock'):<4,}",
            flush=True,
        )


# ── Session runner ────────────────────────────────────────────────────────────

async def _run_browser(
    args: argparse.Namespace, stats: Stats, shoppers: tuple[identity.Shopper, ...]
) -> None:
    from session_browser import BrowserSession

    session = BrowserSession(args.url, stats, shoppers)
    try:
        await session.run()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        print(f"  [browser] session error: {exc}")


async def _spawn(
    args: argparse.Namespace,
    semaphore: asyncio.Semaphore,
    stats: Stats,
    shoppers: tuple[identity.Shopper, ...],
) -> None:
    async with semaphore:
        await _run_browser(args, stats, shoppers)


# ── Capacity estimate ─────────────────────────────────────────────────────────

def _report_capacity(args: argparse.Namespace) -> None:
    """
    Estimate the concurrency the configured arrival rate needs and warn if
    --sessions is short. Little's law: in-flight = arrival rate × service time.
    """
    durations = [config.plan_session().duration_s for _ in range(2_000)]
    avg = statistics.mean(durations) + NAVIGATION_OVERHEAD_S
    peak_mult = config.PEAK_MULTIPLIER if args.diurnal else 1.0
    needed = (args.arrivals_per_minute / 60.0) * avg * peak_mult

    print(
        f"[sim] Mean session ≈ {avg:.0f}s (dwell scale {args.dwell_scale:g}, plus page loads) → "
        f"peak concurrency ≈ {needed:,.1f} browsers",
        flush=True,
    )
    if needed > args.sessions:
        print(
            f"[sim] WARNING: --sessions {args.sessions:,} is below the ≈{needed:,.1f} needed at "
            f"{args.arrivals_per_minute:,.1f} arrivals/min"
            f"{f' × {peak_mult:.2f} peak' if args.diurnal else ''}.\n"
            f"[sim]          Arrivals will queue and eventually be dropped. Either raise "
            f"--sessions to ~{needed * 1.2:,.0f}, lower --arrivals-per-minute to "
            f"{args.sessions / max(avg * peak_mult, 1e-9) * 60:,.1f}, or shorten sessions with "
            f"--dwell-scale.",
            flush=True,
        )


# ── Main simulation loop (Poisson arrivals) ───────────────────────────────────

async def run_simulation(args: argparse.Namespace) -> None:
    _setup_telemetry(args.url)
    shoppers = identity.build_shoppers()

    stats     = Stats()
    semaphore = asyncio.Semaphore(args.sessions)
    start     = time.monotonic()
    deadline  = (start + args.duration) if args.duration > 0 else None
    # A set plus a done-callback keeps this bounded: a forever run must not
    # accumulate one Task object per session for the life of the process.
    tasks: set[asyncio.Task] = set()
    base_rate = args.arrivals_per_minute / 60.0     # arrivals per second
    # Cap the queue of not-yet-started sessions. Without this, an arrival
    # rate above capacity grows the backlog without bound and the process
    # OOMs instead of reporting that it is under-provisioned.
    max_backlog = max(args.sessions * args.max_backlog, args.sessions + 1)

    print(
        f"\n[sim] Starting  url={args.url}  browsers={args.sessions:,}  "
        f"duration={args.duration or 'unlimited'}  "
        f"rate={args.arrivals_per_minute:,.1f}/min"
        f"{' (diurnal)' if args.diurnal else ' (flat)'}  "
        f"funnel={'workshop' if args.workshop_funnel else 'realistic'}\n",
        flush=True,
    )
    _report_capacity(args)

    stopping = asyncio.Event()

    def _request_stop() -> None:
        if not stopping.is_set():
            print("\n[sim] Stop requested — draining…", flush=True)
            stopping.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except (NotImplementedError, RuntimeError):
            pass    # not available on this platform; KeyboardInterrupt still works

    heartbeat = asyncio.create_task(
        _heartbeat(stats, tasks, args, start=start, interval=args.heartbeat)
    )

    try:
        while not stopping.is_set() and (deadline is None or time.monotonic() < deadline):
            if len(tasks) < max_backlog:
                task = asyncio.create_task(_spawn(args, semaphore, stats, shoppers))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
            else:
                stats.inc("arrivals_dropped")

            # Poisson inter-arrival time, scaled by the hour-of-day curve.
            rate = base_rate * (config.hour_multiplier() if args.diurnal else 1.0)
            wait = random.expovariate(rate) if rate > 0 else 1.0
            if deadline is not None:
                wait = min(wait, max(0.0, deadline - time.monotonic()))
            await asyncio.sleep(wait)

    except asyncio.CancelledError:
        pass
    finally:
        heartbeat.cancel()

    # Wait for in-flight sessions, then cancel whatever is left.
    in_flight = [t for t in tasks if not t.done()]
    print(f"\n[sim] {len(in_flight)} in-flight session(s), waiting up to {args.drain}s…",
          flush=True)
    if in_flight:
        _, pending = await asyncio.wait(in_flight, timeout=args.drain)
        for t in pending:
            t.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
            print(f"[sim] Cancelled {len(pending)} session(s) that exceeded the "
                  f"{args.drain}s drain window.")

    from session_browser import close_browser

    await close_browser()

    stats.print_summary(time.monotonic() - start)


# ── CLI ───────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--url",
        default="http://localhost:3000",
        help="Base URL of the ClickShop frontend (default: http://localhost:3000)",
    )
    p.add_argument(
        "--sessions",
        type=int,
        default=4,
        help="Maximum number of concurrent browsers (default: 4)",
    )
    p.add_argument(
        "--duration",
        type=int,
        default=120,
        help="Total simulation duration in seconds; 0 = run until interrupted "
             "(default: 120)",
    )
    p.add_argument(
        "--arrivals-per-minute",
        type=float,
        default=6.0,
        dest="arrivals_per_minute",
        help="Mean new-session arrival rate (Poisson). With --diurnal this is the "
             "daily average, not the instantaneous rate (default: 6)",
    )
    p.add_argument(
        "--diurnal",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Scale the arrival rate by the hour-of-day curve "
             "(0.10× at 04:00 to 2.94× at 20:00 UTC-03); at the peak it needs "
             "~3× the browsers (default: off, a flat rate)",
    )
    p.add_argument(
        "--dwell-scale",
        type=float,
        default=0.1,
        dest="dwell_scale",
        help="Multiplier on every dwell time. 1.0 = realistic (~200 s sessions); "
             "0.1 = ~35 s with page loads, so a few browsers carry a few arrivals "
             "a minute (default: 0.1)",
    )
    p.add_argument(
        "--max-backlog",
        type=float,
        default=4.0,
        dest="max_backlog",
        help="Cap the queue of not-yet-started sessions at this multiple of "
             "--sessions; excess arrivals are dropped and reported instead of "
             "growing memory without bound (default: 4)",
    )
    p.add_argument(
        "--heartbeat",
        type=float,
        default=30.0,
        help="Seconds between progress lines (default: 30)",
    )
    p.add_argument(
        "--drain",
        type=float,
        default=10.0,
        help="Seconds to wait for in-flight sessions on shutdown (default: 10)",
    )
    p.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducible runs (optional)",
    )
    return p


def main() -> None:
    parser = _build_parser()
    args   = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    # Both must happen before any session is planned: plan_session() reads the
    # funnel rates and bakes the dwell times into the plan at creation time.
    args.workshop_funnel = config.apply_workshop_funnel()
    config.set_dwell_scale(args.dwell_scale)

    try:
        import playwright  # noqa: F401
    except ImportError:
        print(
            "ERROR: playwright is not installed.\n"
            "  Run:  pip install playwright && playwright install chromium",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        asyncio.run(run_simulation(args))
    except KeyboardInterrupt:
        print("\n[sim] Interrupted.")


if __name__ == "__main__":
    main()
