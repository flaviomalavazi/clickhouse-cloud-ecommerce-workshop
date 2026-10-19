import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    // The tables live in the `public` schema of the `clickshop` database, so no
    // search_path is needed. Use the direct Postgres endpoint, not a pooler.
    pool = new Pool({
      host:     process.env.PGHOST,
      port:     process.env.PGPORT     ? parseInt(process.env.PGPORT)     : undefined,
      user:     process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl:      process.env.PGHOST && !['localhost', '127.0.0.1', 'postgres'].includes(process.env.PGHOST)
                  ? { rejectUnauthorized: false }
                  : false,
      // A single category page render issues three queries in parallel, and the
      // traffic simulator drives that concurrently with product and API traffic,
      // so 10 connections was reachable as a ceiling. Once the pool is exhausted
      // waiters hit connectionTimeoutMillis and the query throws - which pages
      // used to report as a 404.
      max: process.env.PGPOOL_MAX ? parseInt(process.env.PGPOOL_MAX) : 24,
      // Longer idle keep-alive means fewer reconnects.
      idleTimeoutMillis: 60_000,
      keepAlive: true,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}
