import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/postgres';
import { postStorefrontJourney, type StorefrontBffResponse } from '@/lib/storefront-bff';

/**
 * Placing an order.
 *
 * The order is written to Postgres in two transactions with the payment call
 * between them, so the CDC ClickPipe delivers both the insert and the update:
 *
 *   A. upsert the customer, re-price the items from the database, insert the
 *      order as `pending`, insert its items, decrement stock
 *   .  call the payment journey (storefront-bff -> payment service -> gateway)
 *   B. `confirmed`, or `cancelled` with the stock put back
 *
 * Nothing the browser sends about money is trusted: prices come from `products`
 * and an inactive product cannot be bought. Stock is decremented with a guarded
 * UPDATE, so two shoppers racing for the last unit cannot both win.
 */

export type PaymentMethod = 'credit_card' | 'pix' | 'boleto';

const JOURNEY_BY_METHOD: Record<PaymentMethod, string> = {
  pix: '/v1/journeys/checkout/pix',
  boleto: '/v1/journeys/checkout/boleto',
  credit_card: '/v1/journeys/order',
};

/** A failure the shopper should hear about, with the HTTP status to answer with. */
export class OrderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

interface OrderItem { productId: number; quantity: number }

export interface OrderRequest {
  firstName: string;
  lastName: string | null;
  email: string;
  method: PaymentMethod;
  domainUserid: string | null;
  items: OrderItem[];
}

export type PlacedOrder =
  | { ok: true;  orderId: number; status: 'confirmed' }
  | { ok: false; orderId: number; status: 'cancelled'; upstream: StorefrontBffResponse | null };

const MAX_LINES = 50;
const MAX_QUANTITY = 99;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isMethod(v: unknown): v is PaymentMethod {
  return v === 'credit_card' || v === 'pix' || v === 'boleto';
}

/** Validates the browser's request body. Throws a 400 `OrderError`. */
export function parseOrderRequest(body: unknown): OrderRequest {
  const bad = (field: string) => new OrderError(400, 'invalid_request', { field });
  if (typeof body !== 'object' || body === null) throw bad('body');
  const b = body as Record<string, unknown>;

  if (!isMethod(b.method)) throw bad('method');

  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 250) throw bad('name');
  const [first, ...rest] = name.split(' ');

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 256) throw bad('email');

  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_LINES) throw bad('items');
  // The same product on two lines is one line of the combined quantity.
  const merged = new Map<number, number>();
  for (const raw of b.items) {
    const it = raw as { product_id?: unknown; quantity?: unknown };
    if (!Number.isInteger(it?.product_id) || (it.product_id as number) < 1) throw bad('items');
    if (!Number.isInteger(it?.quantity) || (it.quantity as number) < 1 || (it.quantity as number) > MAX_QUANTITY) {
      throw bad('items');
    }
    const id = it.product_id as number;
    merged.set(id, (merged.get(id) ?? 0) + (it.quantity as number));
  }
  if (Array.from(merged.values()).some(q => q > MAX_QUANTITY)) throw bad('items');

  const domainUserid = typeof b.domain_userid === 'string' && b.domain_userid.length <= 64 && b.domain_userid
    ? b.domain_userid
    : null;

  return {
    firstName: first.slice(0, 128),
    lastName: rest.length ? rest.join(' ').slice(0, 128) : null,
    email,
    method: b.method,
    domainUserid,
    items: Array.from(merged.entries()).map(([productId, quantity]) => ({ productId, quantity })),
  };
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

interface PendingOrder {
  id: number;
  totalCents: number;
  items: OrderItem[];
}

/** Transaction A. Throws `OrderError` 409 when a product is unavailable or sold out. */
function createPendingOrder(req: OrderRequest): Promise<PendingOrder> {
  return withTransaction(async c => {
    const { rows: products } = await c.query<{ id: number; price: string; is_active: boolean }>(
      'SELECT id, price::text AS price, is_active FROM products WHERE id = ANY($1::int[])',
      [req.items.map(i => i.productId)],
    );
    const byId = new Map(products.map(p => [p.id, p]));
    const unavailable = req.items.filter(i => !byId.get(i.productId)?.is_active).map(i => i.productId);
    if (unavailable.length) throw new OrderError(409, 'product_unavailable', { product_ids: unavailable });

    // Money in whole cents, so a total never picks up float error.
    const cents = (id: number) => Math.round(parseFloat(byId.get(id)!.price) * 100);
    const totalCents = req.items.reduce((sum, i) => sum + cents(i.productId) * i.quantity, 0);

    const customer = await c.query<{ id: number }>(
      `INSERT INTO customers (email, first_name, last_name) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
       RETURNING id`,
      [req.email, req.firstName, req.lastName],
    );

    const order = await c.query<{ id: number }>(
      `INSERT INTO orders (customer_id, status, payment_method, domain_userid, total_amount)
       VALUES ($1, 'pending', $2, $3, $4) RETURNING id`,
      [customer.rows[0].id, req.method, req.domainUserid, (totalCents / 100).toFixed(2)],
    );
    const orderId = order.rows[0].id;

    await c.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
       SELECT $1, x.pid, x.qty, x.price
       FROM unnest($2::int[], $3::int[], $4::numeric[]) AS x(pid, qty, price)`,
      [
        orderId,
        req.items.map(i => i.productId),
        req.items.map(i => i.quantity),
        req.items.map(i => (cents(i.productId) / 100).toFixed(2)),
      ],
    );

    // Lowest product id first, so two orders touching the same products take
    // their row locks in the same order and cannot deadlock.
    for (const item of [...req.items].sort((a, b) => a.productId - b.productId)) {
      const res = await c.query(
        'UPDATE stock SET quantity = quantity - $2, updated_at = NOW() WHERE product_id = $1 AND quantity >= $2',
        [item.productId, item.quantity],
      );
      if (res.rowCount === 0) throw new OrderError(409, 'out_of_stock', { product_id: item.productId });
    }

    return { id: orderId, totalCents, items: req.items };
  });
}

/** Transaction B: confirm the order, or cancel it and put the stock back. */
function settleOrder(order: PendingOrder, paid: boolean): Promise<void> {
  return withTransaction(async c => {
    if (paid) {
      await c.query("UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1", [order.id]);
      return;
    }
    await c.query("UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [order.id]);
    await c.query(
      `UPDATE stock SET quantity = stock.quantity + x.qty, updated_at = NOW()
       FROM unnest($1::int[], $2::int[]) AS x(pid, qty)
       WHERE stock.product_id = x.pid`,
      [order.items.map(i => i.productId), order.items.map(i => i.quantity)],
    );
  });
}

export function placeOrder(req: OrderRequest): Promise<PlacedOrder> {
  // The span of the incoming request, so the order id is also on the HTTP span a
  // trace is usually opened from.
  const requestSpan = trace.getActiveSpan();
  requestSpan?.setAttribute('clickshop.payment_method', req.method);

  return trace.getTracer('clickshop-frontend').startActiveSpan(
    'checkout.place_order',
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'clickshop.payment_method': req.method,
        'clickshop.item_count': req.items.length,
      },
    },
    async (span): Promise<PlacedOrder> => {
      try {
        const order = await createPendingOrder(req);
        span.setAttribute('clickshop.order_id', order.id);
        requestSpan?.setAttribute('clickshop.order_id', order.id);

        const upstream = await postStorefrontJourney(JOURNEY_BY_METHOD[req.method], {
          method: req.method,
          amount: order.totalCents / 100,
          item_count: req.items.length,
          order_id: order.id,
        });
        const paid = upstream !== null && upstream.status < 400;

        await settleOrder(order, paid);
        span.setAttribute('clickshop.order_status', paid ? 'confirmed' : 'cancelled');

        return paid
          ? { ok: true, orderId: order.id, status: 'confirmed' }
          : { ok: false, orderId: order.id, status: 'cancelled', upstream };
      } catch (err) {
        if (err instanceof OrderError) {
          // A sold-out product is a business outcome, not a fault.
          span.setAttribute('clickshop.order_error', err.code);
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
          span.recordException(err as Error);
        }
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
