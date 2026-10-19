-- ClickShop OLTP schema (Postgres, database `clickshop`, schema `public`).
--
-- Idempotent: every statement is IF NOT EXISTS, so `make pg-setup` can be run
-- again safely. Nothing here alters an existing table.
--
-- Every table keeps a single-column SERIAL PRIMARY KEY on purpose: the
-- Postgres CDC ClickPipe replicates by primary key, so a table without one
-- would not replicate its updates and deletes.

-- ── Categories ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    slug        VARCHAR(64)   NOT NULL UNIQUE,
    name        VARCHAR(128)  NOT NULL,
    description TEXT,
    banner_url  TEXT,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Products ─────────────────────────────────────────────────────────────────
-- English lives in `name` / `description`: it is the source the translations
-- were made from and the fallback they degrade to, so it is not one locale
-- among three. The pt/es columns are nullable rather than NOT NULL DEFAULT '':
-- NULL says "not translated yet", and the frontend falls back to the English
-- column, so a partially translated catalogue degrades product by product.
CREATE TABLE IF NOT EXISTS products (
    id              SERIAL PRIMARY KEY,
    category_id     INT           NOT NULL REFERENCES categories(id),
    sku             VARCHAR(64)   NOT NULL UNIQUE,
    name            VARCHAR(256)  NOT NULL,
    description     TEXT,
    brand           VARCHAR(128),
    price           NUMERIC(10,2) NOT NULL,
    original_price  NUMERIC(10,2),
    image_url       TEXT,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    attributes      JSONB,
    name_pt         VARCHAR(256),
    name_es         VARCHAR(256),
    description_pt  TEXT,
    description_es  TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand      ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_is_active  ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_attributes ON products USING GIN(attributes);

-- ── Stock ─────────────────────────────────────────────────────────────────────
-- `product_id UNIQUE` is also what lets the checkout decrement a single row
-- with `UPDATE stock SET quantity = quantity - n WHERE quantity >= n`.
CREATE TABLE IF NOT EXISTS stock (
    id           SERIAL PRIMARY KEY,
    product_id   INT      NOT NULL REFERENCES products(id) UNIQUE,
    quantity     INT      NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved     INT      NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Customers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
    id           SERIAL PRIMARY KEY,
    email        VARCHAR(256) NOT NULL UNIQUE,
    first_name   VARCHAR(128),
    last_name    VARCHAR(128),
    phone        VARCHAR(32),
    address      JSONB,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Orders ───────────────────────────────────────────────────────────────────
-- `status` moves pending -> confirmed | cancelled when the checkout runs, so
-- the CDC ClickPipe delivers both the insert and the update.
--
-- `domain_userid` is the Snowplow browser id of the shopper, so an order joins
-- to the clickstream by visitor as well as by order id (`orders.id` is the
-- `se_property` of the `checkout_payment_confirmed` event).
CREATE TABLE IF NOT EXISTS orders (
    id             SERIAL PRIMARY KEY,
    customer_id    INT          NOT NULL REFERENCES customers(id),
    status         VARCHAR(32)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
    payment_method VARCHAR(16)  NOT NULL
                       CHECK (payment_method IN ('credit_card','pix','boleto')),
    domain_userid  VARCHAR(64),
    total_amount   NUMERIC(12,2) NOT NULL,
    shipping_addr  JSONB,
    notes          TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer   ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- ── Order items ──────────────────────────────────────────────────────────────
-- No `subtotal` column: logical replication does not publish generated columns
-- by default, so it would not reach ClickHouse. Compute quantity * unit_price
-- in queries instead.
CREATE TABLE IF NOT EXISTS order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INT           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id  INT           NOT NULL REFERENCES products(id),
    quantity    INT           NOT NULL CHECK (quantity > 0),
    unit_price  NUMERIC(10,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
