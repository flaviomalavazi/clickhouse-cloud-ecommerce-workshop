import { Pool, PoolClient } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const pgDatabase = process.env.PGDATABASE;

    // ClickHouse Cloud's PG wire protocol ignores the search_path startup
    // parameter, so we must SET it after each new connection.
    //
    // pool.on('connect', cb) is the WRONG hook: Pool.emit() is synchronous and
    // does not await async listeners, so the connection races into the ready
    // queue before SET completes → intermittent 404s on fresh connections.
    //
    // pg-pool v3 supports onConnect: the pool calls _promiseTry(onConnect(client))
    // and only makes the connection available once the returned Promise resolves.
    // This guarantees SET search_path completes before any application query runs.
    pool = new Pool({
      host:     process.env.PGHOST,
      port:     process.env.PGPORT     ? parseInt(process.env.PGPORT)     : undefined,
      user:     process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: pgDatabase,
      ssl:      process.env.PGHOST && !['localhost', '127.0.0.1', 'postgres'].includes(process.env.PGHOST)
                  ? { rejectUnauthorized: false }
                  : false,
      // A single category page render issues three queries in parallel, and the
      // traffic simulator drives that concurrently with product and API traffic,
      // so 10 connections was reachable as a ceiling. Once the pool is exhausted
      // waiters hit connectionTimeoutMillis and the query throws - which pages
      // used to report as a 404.
      max: process.env.PGPOOL_MAX ? parseInt(process.env.PGPOOL_MAX) : 24,
      // Longer idle keep-alive means fewer reconnects, and every reconnect costs
      // an extra `SET search_path` round trip before the connection is usable.
      idleTimeoutMillis: 60_000,
      keepAlive: true,
      connectionTimeoutMillis: 5_000,
      ...(pgDatabase ? { onConnect: (client: PoolClient) => client.query(`SET search_path TO "${pgDatabase}"`) } as any : {}),
    });
  }
  return pool;
}
