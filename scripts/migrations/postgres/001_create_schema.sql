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
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku        ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_brand      ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_is_active  ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_attributes ON products USING GIN(attributes);

-- ── Stock ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock (
    id           SERIAL PRIMARY KEY,
    product_id   INT      NOT NULL REFERENCES products(id) UNIQUE,
    quantity     INT      NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved     INT      NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id);

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

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- ── Orders ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id             SERIAL PRIMARY KEY,
    customer_id    INT          NOT NULL REFERENCES customers(id),
    status         VARCHAR(32)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
    total_amount   NUMERIC(12,2) NOT NULL,
    shipping_addr  JSONB,
    notes          TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer   ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- ── Order Items ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INT           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id  INT           NOT NULL REFERENCES products(id),
    quantity    INT           NOT NULL CHECK (quantity > 0),
    unit_price  NUMERIC(10,2) NOT NULL,
    subtotal    NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
