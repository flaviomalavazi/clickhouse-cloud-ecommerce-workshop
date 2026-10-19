import { createClient } from '@clickhouse/client';
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

type CHClient = ReturnType<typeof createClient>;

let client: CHClient | undefined;

export function getClickHouseClient(): CHClient {
  if (!client) {
    const raw = createClient({
      url:      process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
      database: process.env.CLICKHOUSE_DATABASE ?? 'retail_analytics',
      username: process.env.CLICKHOUSE_USER ?? 'default',
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
      request_timeout: 30_000,
    });
    client = wrapWithTracing(raw);
  }
  return client;
}

const TRACED_METHODS = ['query', 'insert', 'exec', 'command'] as const;

function wrapWithTracing(ch: CHClient): CHClient {
  const tracer = trace.getTracer('clickhouse-client');
  const dbName = process.env.CLICKHOUSE_DATABASE ?? 'retail_analytics';

  return new Proxy(ch, {
    get(target, prop: string) {
      if (!(TRACED_METHODS as readonly string[]).includes(prop)) {
        return (target as unknown as Record<string, unknown>)[prop];
      }
      return (opts: Record<string, unknown>) => {
        const stmt = typeof opts?.query === 'string'
          ? opts.query.trim().slice(0, 1000)
          : String(prop);

        return tracer.startActiveSpan(
          `clickhouse.${prop}`,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              'db.system':    'clickhouse',
              'db.name':      dbName,
              'db.statement': stmt,
            },
          },
          async (span) => {
            try {
              const result = await (target as unknown as Record<string, (o: unknown) => unknown>)[prop](opts);
              span.setStatus({ code: SpanStatusCode.OK });
              return result;
            } catch (err) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
              span.recordException(err as Error);
              throw err;
            } finally {
              span.end();
            }
          }
        );
      };
    },
  }) as CHClient;
}
