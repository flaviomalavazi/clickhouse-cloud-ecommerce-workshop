CREATE TABLE IF NOT EXISTS retail_analytics.credit_card_transactions
(
    transaction_id        UUID                          DEFAULT generateUUIDv4(),
    timestamp             DateTime64(3, 'UTC'),

    -- Nullable on purpose: NULL is the faulty-transaction (fraud/anomaly) signal.
    merchant_name         Nullable(String),
    card_holder           Nullable(String),

    merchant_type         LowCardinality(String)        DEFAULT '',
    bill_value            Decimal(12, 2)                DEFAULT 0,   -- signed: chargebacks/faulty < 0
    installments          UInt8                         DEFAULT 1,
    card_network          LowCardinality(String)        DEFAULT '',  -- incl. invalid "UCB" for faulty rows
    card_bin              UInt32                        DEFAULT 0,
    card_expiration_date  LowCardinality(String)        DEFAULT '',
    currency              LowCardinality(String)        DEFAULT '',
    type                  LowCardinality(String)        DEFAULT 'expense',

    INDEX idx_card_network card_network TYPE set(16)          GRANULARITY 4,
    INDEX idx_type         type         TYPE set(8)           GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (merchant_type, card_network, toDate(timestamp), transaction_id)
TTL toDateTime(timestamp) + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;
