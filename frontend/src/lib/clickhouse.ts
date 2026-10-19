import { createClient } from '@clickhouse/client';
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

type CHClient = ReturnType<typeof createClient>;

let client: CHClient | undefined;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'host.docker.internal'];

/**
 * The service's HTTP(S) endpoint, built from the same CLICKHOUSE_HOST and
 * CLICKHOUSE_PORT every other component reads. TLS is on unless the host is
 * local or CLICKHOUSE_SECURE says otherwise (a local test database).
 */
export function clickhouseUrl(): string {
  const host = process.env.CLICKHOUSE_HOST?.trim() || 'localhost';
  const port = process.env.CLICKHOUSE_PORT?.trim() || '8443';
  const secureEnv = process.env.CLICKHOUSE_SECURE?.trim().toLowerCase();
  const secure = secureEnv ? !['0', 'false', 'no'].includes(secureEnv) : !LOCAL_HOSTS.includes(host);
  return `${secure ? 'https' : 'http'}://${host}:${port}`;
}

export function getClickHouseClient(): CHClient {
  if (!client) {
    const raw = createClient({
      url:      clickhouseUrl(),
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
