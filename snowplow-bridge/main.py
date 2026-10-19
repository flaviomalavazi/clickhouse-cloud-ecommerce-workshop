#!/usr/bin/env python3
"""
Snowplow Micro → ClickHouse bridge.

Polls /micro/good every POLL_INTERVAL seconds, maps enriched events to the
snowplow_events ClickHouse schema, inserts them, then resets Micro.

Connects via HTTP/HTTPS using clickhouse-connect, which supports both local
ClickHouse (http://clickhouse:8123) and ClickHouse Cloud (https://...8443).
"""
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
import clickhouse_connect

from opentelemetry import metrics as otel_metrics, trace as otel_trace
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace import SpanKind, StatusCode

MICRO_URL       = os.environ.get('SNOWPLOW_MICRO_URL',    'http://snowplow-micro:9090')
# Ingest-specific vars take priority; fall back to the shared CLICKHOUSE_* vars
# so local dev (single user) requires no extra configuration.
CLICKHOUSE_URL  = os.environ.get('CLICKHOUSE_INGEST_URL')      or os.environ.get('CLICKHOUSE_URL',      'http://clickhouse:8123')
CH_USER         = os.environ.get('CLICKHOUSE_INGEST_USER')     or os.environ.get('CLICKHOUSE_USER',     'default')
CH_PASSWORD     = os.environ.get('CLICKHOUSE_INGEST_PASSWORD') or os.environ.get('CLICKHOUSE_PASSWORD', '')
CH_DB           = os.environ.get('CLICKHOUSE_DB',         'retail_analytics')
POLL_INTERVAL   = float(os.environ.get('POLL_INTERVAL_SECONDS', '2'))
OTEL_ENDPOINT   = os.environ.get('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector:4318')

_parsed  = urlparse(CLICKHOUSE_URL)
_CH_HOST   = _parsed.hostname or 'clickhouse'
_CH_PORT   = _parsed.port or (8443 if _parsed.scheme == 'https' else 8123)
_CH_SECURE = _parsed.scheme == 'https'

# The bridge flushes every POLL_INTERVAL seconds (2s by default), which meant one
# new part roughly every 2 seconds - ~30 parts a minute for the background merger
# to clean up, forever. async_insert hands the batching to the server, which
# coalesces these small writes into far fewer parts.
#
# wait_for_async_insert=1 keeps the existing at-least-once behaviour intact: the
# call does not return until the server has committed the buffer, so a failure
# still raises and Micro is left unreset for the next cycle to retry.
INSERT_SETTINGS = {
    'async_insert':                 1,
    'wait_for_async_insert':        1,
    'async_insert_busy_timeout_ms': int(os.environ.get('CH_BUSY_TIMEOUT_MS', '1000')),
}

COLUMN_NAMES = [
    'event_id', 'collector_tstamp', 'dvce_created_tstamp',
    'app_id', 'platform',
    'domain_userid', 'domain_sessionid', 'user_id', 'user_ipaddress',
    'event', 'event_name',
    'page_url', 'page_urlpath', 'page_title', 'refr_urlpath',
    'se_category', 'se_action', 'se_label', 'se_property', 'se_value',
    'unstruct_event',
    'useragent', 'br_family', 'os_family', 'dvce_type',
    'geo_country', 'geo_city',
    'ctx_product_id', 'ctx_category_slug', 'ctx_search_query', 'ctx_search_type',
]


def wait_for_micro() -> None:
    for _ in range(30):
        try:
            r = requests.get(f'{MICRO_URL}/micro/all', timeout=3)
            if r.status_code == 200:
                print('[bridge] Snowplow Micro is ready')
                return
        except Exception:
            pass
        print('[bridge] Waiting for Snowplow Micro…')
        time.sleep(3)
    raise RuntimeError('Snowplow Micro did not become reachable')


def connect_clickhouse() -> clickhouse_connect.driver.Client:
    for attempt in range(15):
        try:
            client = clickhouse_connect.get_client(
                host=_CH_HOST,
                port=_CH_PORT,
                username=CH_USER,
                password=CH_PASSWORD,
                database=CH_DB,
                secure=_CH_SECURE,
            )
            client.ping()
            print(f'[bridge] Connected to ClickHouse at {CLICKHOUSE_URL}')
            return client
        except Exception as e:
            print(f'[bridge] ClickHouse not ready ({e}), retrying…')
            time.sleep(3)
    raise RuntimeError('Could not connect to ClickHouse')


def parse_ts(value) -> datetime:
    if not value:
        return datetime.utcnow()
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        s = str(value).replace('Z', '+00:00')
        dt = datetime.fromisoformat(s)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return datetime.utcnow()


def extract_ctx(se_category: str, se_label: str, se_property: str):
    """
    Structured events encode e-commerce context in se_label / se_property:
      product / cart events → label=product_id, property=category_slug
      search events         → label=search_query, property=search_type
    """
    ctx_product_id    = 0
    ctx_category_slug = ''
    ctx_search_query  = ''
    ctx_search_type   = ''

    if se_category in ('product', 'cart'):
        try:
            ctx_product_id = int(se_label)
        except (ValueError, TypeError):
            pass
        ctx_category_slug = se_property
    elif se_category == 'search':
        ctx_search_query = se_label
        ctx_search_type  = se_property

    return ctx_product_id, ctx_category_slug, ctx_search_query, ctx_search_type


def map_event(micro_event: dict) -> dict:
    # Snowplow Micro wraps the enriched event under the 'event' key
    ev = micro_event.get('event') or {}

    se_category = str(ev.get('se_category') or '')
    se_action   = str(ev.get('se_action')   or '')
    se_label    = str(ev.get('se_label')    or '')
    se_property = str(ev.get('se_property') or '')
    event_type  = str(ev.get('event')       or '')

    # Build a friendly event_name consistent with the existing schema
    if event_type == 'page_view':
        event_name = 'page_view'
    elif event_type == 'struct' and se_category and se_action:
        event_name = f'{se_category}_{se_action}'
    else:
        event_name = event_type or 'unknown'

    try:
        se_value = float(ev.get('se_value') or 0)
    except (ValueError, TypeError):
        se_value = 0.0

    ctx = extract_ctx(se_category, se_label, se_property)

    return {
        'event_id':            str(ev.get('event_id')            or ''),
        'collector_tstamp':    parse_ts(ev.get('collector_tstamp')),
        'dvce_created_tstamp': parse_ts(ev.get('dvce_created_tstamp')),
        'app_id':              str(ev.get('app_id')              or ''),
        'platform':            str(ev.get('platform')            or ''),
        'domain_userid':       str(ev.get('domain_userid')       or ''),
        'domain_sessionid':    str(ev.get('domain_sessionid')    or ''),
        # Snowplow's authenticated-user field, set via setUserId() in the
        # browser tracker (frontend/src/lib/snowplow.ts) or emitted directly
        # by the generators. Empty string = anonymous.
        'user_id':             str(ev.get('user_id')             or ''),
        'user_ipaddress':      str(ev.get('user_ipaddress')      or ''),
        'event':               event_type,
        'event_name':          event_name,
        'page_url':            str(ev.get('page_url')            or ''),
        'page_urlpath':        str(ev.get('page_urlpath')        or ''),
        'page_title':          str(ev.get('page_title')          or ''),
        'refr_urlpath':        str(ev.get('refr_urlpath')        or ''),
        'se_category':         se_category,
        'se_action':           se_action,
        'se_label':            se_label,
        'se_property':         se_property,
        'se_value':            se_value,
        'unstruct_event':      '',
        'useragent':           str(ev.get('useragent')           or ''),
        'br_family':           str(ev.get('br_family')           or ''),
        'os_family':           str(ev.get('os_family')           or ''),
        'dvce_type':           str(ev.get('dvce_type')           or ''),
        'geo_country':         str(ev.get('geo_country')         or ''),
        'geo_city':            str(ev.get('geo_city')            or ''),
        'ctx_product_id':      ctx[0],
        'ctx_category_slug':   ctx[1],
        'ctx_search_query':    ctx[2],
        'ctx_search_type':     ctx[3],
    }


def flush(ch: clickhouse_connect.driver.Client, counters: dict) -> None:
    tracer = counters['_tracer']
    with tracer.start_as_current_span('snowplow.bridge.flush', kind=SpanKind.INTERNAL) as span:
        try:
            r = requests.get(f'{MICRO_URL}/micro/good', timeout=5)
            r.raise_for_status()
            raw = r.json()
        except Exception as e:
            span.set_status(StatusCode.ERROR, str(e))
            span.record_exception(e)
            print(f'[bridge] Error fetching events from Micro: {e}')
            return

        if not raw:
            span.set_attribute('snowplow.events.fetched', 0)
            return

        span.set_attribute('snowplow.events.fetched', len(raw))

        rows = []
        for item in raw:
            try:
                rows.append(map_event(item))
            except Exception as ex:
                print(f'[bridge] Skipping malformed event: {ex}')
                counters['events_failed'].add(1)

        if not rows:
            return

        try:
            with tracer.start_as_current_span(
                'clickhouse.insert',
                kind=SpanKind.CLIENT,
                attributes={
                    'db.system':    'clickhouse',
                    'db.name':      CH_DB,
                    'db.statement': f'INSERT INTO snowplow_events ({len(rows)} rows)',
                },
            ) as insert_span:
                data = [[row[col] for col in COLUMN_NAMES] for row in rows]
                ch.insert('snowplow_events', data, column_names=COLUMN_NAMES,
                          settings=INSERT_SETTINGS)
                insert_span.set_attribute('snowplow.events.inserted', len(rows))
            counters['events_inserted'].add(len(rows))
            span.set_attribute('snowplow.events.inserted', len(rows))
            print(f'[bridge] Inserted {len(rows)} event(s)')
        except Exception as e:
            span.set_status(StatusCode.ERROR, str(e))
            span.record_exception(e)
            counters['events_failed'].add(len(rows))
            print(f'[bridge] ClickHouse insert error: {e}')
            return  # Don't reset Micro if insert failed — retry next cycle

        # Only reset after a successful insert so no events are lost
        try:
            requests.post(f'{MICRO_URL}/micro/reset', timeout=5)
        except Exception as e:
            print(f'[bridge] Warning: could not reset Micro ({e})')


def setup_telemetry():
    """Initialise OTel traces + metrics push to the OTLP endpoint."""
    resource = Resource.create({'service.name': 'snowplow-bridge'})

    # Traces
    trace_provider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f'{OTEL_ENDPOINT}/v1/traces'))
    )
    otel_trace.set_tracer_provider(trace_provider)

    # Metrics
    exporter = OTLPMetricExporter(endpoint=f'{OTEL_ENDPOINT}/v1/metrics')
    reader   = PeriodicExportingMetricReader(exporter, export_interval_millis=15_000)
    provider = MeterProvider(resource=resource, metric_readers=[reader])
    otel_metrics.set_meter_provider(provider)

    meter = otel_metrics.get_meter('snowplow.bridge')
    return {
        'events_inserted':  meter.create_counter(
            'snowplow.bridge.events.inserted',
            description='Total Snowplow events successfully inserted into ClickHouse',
        ),
        'events_failed':    meter.create_counter(
            'snowplow.bridge.events.failed',
            description='Total Snowplow events that failed to insert',
        ),
        '_meter':   meter,
        '_tracer':  otel_trace.get_tracer('snowplow.bridge'),
    }


def main() -> None:
    print(f'[bridge] Micro={MICRO_URL}  CH={CLICKHOUSE_URL}/{CH_DB}  poll={POLL_INTERVAL}s')
    counters = setup_telemetry()
    wait_for_micro()
    ch = connect_clickhouse()

    # Re-register observable gauges now that Micro is reachable
    from opentelemetry.sdk.metrics.export import MetricExportResult  # noqa: F401
    from opentelemetry.metrics import Observation
    def _micro_good_cb(opts):
        try:
            r = requests.get(f'{MICRO_URL}/micro/all', timeout=3)
            if r.status_code == 200:
                d = r.json()
                yield Observation(d.get('good', 0))
        except Exception:
            pass

    def _micro_bad_cb(opts):
        try:
            r = requests.get(f'{MICRO_URL}/micro/all', timeout=3)
            if r.status_code == 200:
                d = r.json()
                yield Observation(d.get('bad', 0))
        except Exception:
            pass

    meter = counters['_meter']
    meter.create_observable_gauge(
        'snowplow.micro.events.good.live',
        callbacks=[_micro_good_cb],
        description='Current good event count from Snowplow Micro /micro/all',
    )
    meter.create_observable_gauge(
        'snowplow.micro.events.bad.live',
        callbacks=[_micro_bad_cb],
        description='Current bad event count from Snowplow Micro /micro/all',
    )

    while True:
        flush(ch, counters)
        time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    main()
