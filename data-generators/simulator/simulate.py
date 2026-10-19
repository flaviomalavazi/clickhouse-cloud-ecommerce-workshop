#!/usr/bin/env python3
"""
ClickShop traffic simulator
============================

Simulates realistic e-commerce user sessions against a running ClickShop
instance by driving a real headless Chromium browser via Playwright: the JS
tracker in the page fires the Snowplow events itself, and the page's HyperDX
SDK emits the browser telemetry. The frontend must be reachable at --url.

Sessions arrive as a Poisson process and follow the funnel defined in
traffic_profile.py — the same file the producers read, so both generators
emit the same funnel.

Diurnal arrival rate
--------------------
By default `--arrivals-per-minute` is the *daily average*. The instantaneous
rate is scaled by the hour-of-day curve in traffic_profile.HOURLY_WEIGHTS, so a
long-running simulation produces ~0.10× that rate at the 04:00 trough and
~2.94× at the 20:00 peak (UTC-03), averaging out to the configured value over a
full day. Pass --no-diurnal for a flat rate.

Throughput
----------
A session holds a concurrency slot for its whole duration (~186 s of dwell by
default), so sustained arrivals need `--sessions` ≈ arrivals/s × duration.
`--dwell-scale` compresses every dwell time: at 0.05 a session finishes in ~9 s
and the same concurrency drives ~20× the sessions. Every concurrent session is
a browser context, so keep `--sessions` small. The simulator prints the
concurrency it needs at startup and warns if `--sessions` is short.

Usage examples
--------------
  # Quick test against a local stack
  python simulate.py --url http://localhost:3000 --duration 120 --sessions 4

  # Run forever with a realistic diurnal curve
  python simulate.py --url http://localhost:3000 \\
      --duration 0 --sessions 4 --arrivals-per-minute 6
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

# session_browser imports Playwright at module scope, so it is loaded lazily.
# (Importing it here made the "playwright is not installed" check in main()
# unreachable — the import crashed first.)


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
        s = self._data
        sessions   = s.get("sessions_started", 0)
        completed  = s.get("sessions_completed", 0)
        page_views = s.get("page_views", 0)
        bounces    = s.get("bounces", 0)
        searches   = s.get("searches", 0)
        scrolls    = s.get("scrolls", 0)
        clicks     = s.get("product_clicks", 0)
        carts      = s.get("add_to_cart", 0)
        checkouts  = s.get("checkout_starts", 0)
        purchases  = s.get("purchases", 0)
        sent       = s.get("events_sent", 0)
        failed     = s.get("events_failed", 0)
        dropped    = s.get("arrivals_dropped", 0)

        def pct(n: int) -> str:
            return f"{n / sessions * 100:.1f}%" if sessions else "n/a"

        print("\n" + "─" * 56)
        print(f"  Simulation complete  ({elapsed:.0f}s)")
        print("─" * 56)
        print(f"  Sessions started     {sessions:>10,}")
        print(f"  Sessions completed   {completed:>10,}")
        print(f"  Bounce rate          {pct(bounces):>10}")
        print(f"  Page views           {page_views:>10,}")
        print(f"  Scroll events        {scrolls:>10,}")
        print(f"  Searches             {searches:>10,}")
        print(f"  Product clicks       {clicks:>10,}")
        print(f"  Add-to-cart          {carts:>10,}")
        print(f"  Checkouts started    {checkouts:>10,}")
        print(f"  Purchases            {purchases:>10,}")
        print(f"  Conversion rate      {pct(purchases):>10}")
        print("─" * 56)
        print(f"  Events sent          {sent:>10,}")
        if failed:
            print(f"  Events failed        {failed:>10,}")
        if elapsed > 0:
            print(f"  Throughput           {sent / elapsed:>10,.1f} events/s")
        if dropped:
            print(f"  Arrivals dropped     {dropped:>10,}  (raise --sessions)")
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
    last_sent, last_t = 0, time.monotonic()
    while True:
        await asyncio.sleep(interval)
        now     = time.monotonic()
        elapsed = now - start
        sent    = stats.get("events_sent")
        rate    = (sent - last_sent) / max(1e-9, now - last_t)
        last_sent, last_t = sent, now

        mult = config.hour_multiplier() if args.diurnal else 1.0
        print(
            f"[sim] t+{elapsed:>6.0f}s  active={len(tasks):<6} "
            f"x{mult:.2f} ({args.arrivals_per_minute * mult:>7,.0f}/min)  "
            f"started={stats.get('sessions_started'):<9,} "
            f"views={stats.get('page_views'):<9,} "
            f"purch={stats.get('purchases'):<7,} "
            f"{rate:>7,.0f} ev/s",
            flush=True,
        )


# ── Session runner ────────────────────────────────────────────────────────────

async def _run_browser(args: argparse.Namespace, stats: Stats) -> None:
    from session_browser import BrowserSession

    session = BrowserSession(args.url, stats)
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
) -> None:
    async with semaphore:
        await _run_browser(args, stats)


# ── Capacity estimate ─────────────────────────────────────────────────────────

def _report_capacity(args: argparse.Namespace) -> None:
    """
    Estimate the concurrency the configured arrival rate needs and warn if
    --sessions is short. Little's law: in-flight = arrival rate × service time.
    """
    durations = [config.plan_session().duration_s for _ in range(2_000)]
    avg = statistics.mean(durations)
    peak_mult = config.PEAK_MULTIPLIER if args.diurnal else 1.0
    needed = (args.arrivals_per_minute / 60.0) * avg * peak_mult

    print(
        f"[sim] Mean session duration {avg:.1f}s (dwell scale {args.dwell_scale:g}) → "
        f"peak concurrency ≈ {needed:,.0f} sessions"
        + ("  — sessions finish instantly, so the frontend, not concurrency, is the limit"
           if needed < 1 else ""),
        flush=True,
    )
    if needed > args.sessions:
        print(
            f"[sim] WARNING: --sessions {args.sessions:,} is below the ≈{needed:,.0f} needed at "
            f"{args.arrivals_per_minute:,.0f} arrivals/min"
            f"{f' × {peak_mult:.2f} peak' if args.diurnal else ''}.\n"
            f"[sim]          Arrivals will queue and eventually be dropped. Either raise "
            f"--sessions to ~{needed * 1.2:,.0f}, lower --arrivals-per-minute to "
            f"{args.sessions / max(avg * peak_mult, 1e-9) * 60:,.0f}, or shorten sessions with "
            f"--dwell-scale.",
            flush=True,
        )


# ── Main simulation loop (Poisson arrivals) ───────────────────────────────────

async def run_simulation(args: argparse.Namespace) -> None:
    _setup_telemetry(args.url)

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
        f"\n[sim] Starting  url={args.url}  sessions={args.sessions:,}  "
        f"duration={args.duration or 'unlimited'}  "
        f"rate={args.arrivals_per_minute:,.1f}/min"
        f"{' (diurnal)' if args.diurnal else ' (flat)'}\n",
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
                task = asyncio.create_task(_spawn(args, semaphore, stats))
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
        default=5,
        help="Maximum number of concurrent sessions (default: 5)",
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
        default=10.0,
        dest="arrivals_per_minute",
        help="Mean new-session arrival rate (Poisson). With --diurnal this is the "
             "daily average, not the instantaneous rate (default: 10)",
    )
    p.add_argument(
        "--diurnal",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Scale the arrival rate by the hour-of-day curve "
             "(0.10× at 04:00 to 2.94× at 20:00 UTC-03). Use --no-diurnal for a "
             "flat rate (default: enabled)",
    )
    p.add_argument(
        "--dwell-scale",
        type=float,
        default=1.0,
        dest="dwell_scale",
        help="Multiplier on every dwell time. 1.0 = realistic (~186 s sessions); "
             "0.05 = ~20× more sessions per concurrency slot; 0 = no dwell "
             "(default: 1.0)",
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

    # Must happen before any session is planned: plan_session() bakes the dwell
    # times into the plan at creation time.
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
