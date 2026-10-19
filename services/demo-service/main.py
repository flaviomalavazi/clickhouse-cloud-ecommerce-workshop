"""One FastAPI runtime, configured into each service in the demo graph."""

import asyncio
import logging
import os
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from topology import TOPOLOGY


ROLE = os.getenv("DEMO_ROLE", "storefront-bff")
if ROLE not in TOPOLOGY:
    raise RuntimeError(f"DEMO_ROLE must be one of: {', '.join(TOPOLOGY)}")

CARD_GATEWAY_ERROR = {"error": "card_gateway_unavailable", "retryable": True}
logger = logging.getLogger("demo-service")


class TraceContextFilter(logging.Filter):
    """Add trace identifiers to stdout logs as a useful local fallback."""

    def filter(self, record: logging.LogRecord) -> bool:
        context = trace.get_current_span().get_span_context()
        record.trace_id = f"{context.trace_id:032x}" if context.is_valid else "-"
        record.span_id = f"{context.span_id:016x}" if context.is_valid else "-"
        return True


class DownstreamFailure(Exception):
    """The exact HTTP failure a required downstream returned."""

    def __init__(self, status_code: int, body: bytes, content_type: str, retry_after: str | None = None):
        self.status_code = status_code
        self.body = body
        self.content_type = content_type
        self.retry_after = retry_after


def configure_observability() -> None:
    service_name = os.environ.setdefault("OTEL_SERVICE_NAME", f"demo-{ROLE}")
    resource = Resource.create({SERVICE_NAME: service_name})
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    trace_provider = TracerProvider(resource=resource)
    log_provider = LoggerProvider(resource=resource)
    trace_exporter = OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces") if endpoint else OTLPSpanExporter()
    log_exporter = OTLPLogExporter(endpoint=f"{endpoint.rstrip('/')}/v1/logs") if endpoint else OTLPLogExporter()
    trace_provider.add_span_processor(BatchSpanProcessor(trace_exporter))
    log_provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))
    trace.set_tracer_provider(trace_provider)
    set_logger_provider(log_provider)

    # Without a MeterProvider the FastAPI and HTTPX instrumentations record
    # nothing, so the service would have traces and logs but no request-rate,
    # error or duration metrics (RED). It must be set before they instrument.
    metric_exporter = OTLPMetricExporter(endpoint=f"{endpoint.rstrip('/')}/v1/metrics") if endpoint else OTLPMetricExporter()
    metrics.set_meter_provider(MeterProvider(
        resource=resource,
        metric_readers=[PeriodicExportingMetricReader(metric_exporter, export_interval_millis=15_000)],
    ))
    HTTPXClientInstrumentor().instrument()

    stdout_handler = logging.StreamHandler()
    stdout_handler.addFilter(TraceContextFilter())
    stdout_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s trace=%(trace_id)s span=%(span_id)s %(message)s"))
    logger.handlers[:] = [LoggingHandler(logger_provider=log_provider), stdout_handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False


configure_observability()
app = FastAPI(title="ClickShop Demo Service")
# Docker polls this endpoint every few seconds. Keeping those uncorrelated
# server spans would make low-volume services look like isolated nodes when the
# HyperDX service map samples traces. The endpoint remains available; only its
# telemetry is excluded.
FastAPIInstrumentor.instrument_app(app, excluded_urls=r"/health$")


def latency_seconds() -> float:
    return max(0, int(os.getenv("DEMO_LATENCY_MS", "15"))) / 1000


def downstream_timeout_seconds() -> float:
    return max(0.1, float(os.getenv("DEMO_DOWNSTREAM_TIMEOUT_SECONDS", "5")))


def downstream_url(role: str, path: str) -> str:
    override = os.getenv(f"DEMO_{role.upper().replace('-', '_')}_URL")
    return f"{(override or f'http://{role}:8000').rstrip('/')}{path}"


def failure_response(failure: DownstreamFailure) -> Response:
    headers = {"content-type": failure.content_type}
    if failure.retry_after is not None:
        headers["Retry-After"] = failure.retry_after
    return Response(content=failure.body, status_code=failure.status_code, headers=headers)


async def call_downstream(client: httpx.AsyncClient, edge: dict[str, Any], payload: Any) -> dict[str, Any]:
    try:
        response = await client.post(downstream_url(edge["role"], edge["path"]), json=payload)
    except httpx.HTTPError as exc:
        if edge.get("optional"):
            logger.warning("optional downstream %s failed: %s", edge["role"], exc)
            return {"service": edge["role"], "status": "unavailable"}
        raise DownstreamFailure(502, b'{"error":"required_downstream_unavailable"}', "application/json") from exc

    if response.status_code >= 400:
        if edge.get("optional"):
            logger.warning("optional downstream %s returned %s", edge["role"], response.status_code)
            return {"service": edge["role"], "status": "unavailable"}
        raise DownstreamFailure(
            response.status_code,
            response.content,
            response.headers.get("content-type", "application/json"),
            response.headers.get("Retry-After"),
        )
    return {"service": edge["role"], "result": response.json()}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "role": ROLE}


async def run_role(request: Request) -> Response:
    config = TOPOLOGY[ROLE]["routes"][request.url.path]
    try:
        payload = await request.json()
    except ValueError:
        payload = {}
    source = payload.get("source", "storefront") if isinstance(payload, dict) else "storefront"
    span = trace.get_current_span()
    span.set_attribute("clickshop.source", source)
    span.set_attribute("clickshop.role", ROLE)
    # The storefront puts the Postgres order id and payment method in the
    # checkout journeys, so a trace through any service can be found by order.
    if isinstance(payload, dict):
        order_id = payload.get("order_id")
        if isinstance(order_id, (int, str)) and not isinstance(order_id, bool):
            span.set_attribute("clickshop.order_id", order_id)
        if payload.get("method"):
            span.set_attribute("clickshop.payment_method", str(payload["method"]))

    if ROLE == "card-gateway":
        timeout_ms = max(0, int(os.getenv("CARD_GATEWAY_TIMEOUT_MS", "0")))
        is_down = os.getenv("CARD_GATEWAY_DOWN", "false").lower() == "true"
        if is_down:
            await asyncio.sleep(timeout_ms / 1000)
            span.set_status(trace.Status(trace.StatusCode.ERROR, "card gateway unavailable"))
            logger.error("journey failed role=%s route=%s source=%s status=502", ROLE, request.url.path, source)
            return JSONResponse(CARD_GATEWAY_ERROR, status_code=502, headers={"Retry-After": "5"})

    await asyncio.sleep(latency_seconds())

    try:
        async with httpx.AsyncClient(timeout=downstream_timeout_seconds()) as client:
            calls = []
            for stage in config.get("stages") or [config["downstreams"]]:
                calls.extend(await asyncio.gather(*(call_downstream(client, edge, payload) for edge in stage)))
    except DownstreamFailure as failure:
        span.set_status(trace.Status(trace.StatusCode.ERROR, f"downstream returned {failure.status_code}"))
        logger.error(
            "journey failed role=%s route=%s source=%s status=%s",
            ROLE,
            request.url.path,
            source,
            failure.status_code,
        )
        return failure_response(failure)

    body = {"service": ROLE, **config["response"]}
    if calls:
        body["downstreams"] = calls
    logger.info(
        "journey completed role=%s route=%s source=%s downstreams=%s",
        ROLE,
        request.url.path,
        source,
        len(calls),
    )
    return JSONResponse(body)


for _route in TOPOLOGY[ROLE]["routes"]:
    app.add_api_route(_route, run_role, methods=["POST"], include_in_schema=False)
