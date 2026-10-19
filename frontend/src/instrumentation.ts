export async function register() {
  // Only run on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { NodeSDK }                    = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter }          = await import('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter }         = await import('@opentelemetry/exporter-metrics-otlp-http');
  const { OTLPLogExporter }            = await import('@opentelemetry/exporter-logs-otlp-http');
  const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
  const { BatchLogRecordProcessor }    = await import('@opentelemetry/sdk-logs');
  const { logs: otelLogs, SeverityNumber } = await import('@opentelemetry/api-logs');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  const { Resource }                   = await import('@opentelemetry/resources');
  const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } = await import('@opentelemetry/semantic-conventions');

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

  const sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]:    'retail-demo-frontend',
      [SEMRESATTRS_SERVICE_VERSION]: '1.0.0',
      'deployment.environment':      process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exportIntervalMillis: 60_000,
      exporter: new OTLPMetricExporter({
        url: `${otlpEndpoint}/v1/metrics`,
      }),
    }) as any,
    logRecordProcessor: new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${otlpEndpoint}/v1/logs`,
      })
    ),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs':  { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log('[OTel] SDK started, exporting to', otlpEndpoint);

  // Bridge console.{log,warn,error} to OTel log records so server-side
  // Next.js output appears in HyperDX logs.
  // getLogger MUST be called after sdk.start() — before that, the global
  // LoggerProvider is a no-op and any logger obtained from it emits nothing.
  const otelLogger = otelLogs.getLogger('console');
  const _origLog   = console.log.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);
  let _emitting = false; // prevent re-entrant loops

  function _emit(severity: number, severityText: string, args: unknown[]) {
    if (_emitting) return;
    _emitting = true;
    try {
      otelLogger.emit({
        body: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
        severityNumber: severity,
        severityText,
      });
    } finally {
      _emitting = false;
    }
  }

  console.log   = (...args) => { _origLog(...args);   _emit(SeverityNumber.INFO,  'INFO',  args); };
  console.warn  = (...args) => { _origWarn(...args);  _emit(SeverityNumber.WARN,  'WARN',  args); };
  console.error = (...args) => { _origError(...args); _emit(SeverityNumber.ERROR, 'ERROR', args); };
}
