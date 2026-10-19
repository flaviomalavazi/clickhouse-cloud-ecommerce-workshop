-- Localised name and description alongside the English ones.
--
-- The storefront translates its own chrome through i18n/, but the product copy
-- comes out of this table, so a Portuguese or Spanish visitor read the whole
-- catalogue in English. Worse than the reading: products_search builds its
-- tokenbf_v1 full-text indexes on these strings, so searching "tênis" or
-- "liderança" matched nothing while "running shoe" and "leadership" returned
-- twenty rows apiece. On a demo whose centrepiece is ClickHouse full-text
-- search, in front of a Latin American audience, that breaks during the pitch.
--
-- Nullable with no default, rather than NOT NULL DEFAULT '': a NULL says "not
-- translated yet" and an empty string would be indistinguishable from "the
-- translation is deliberately blank". The frontend falls back to the English
-- column when the locale column is null, so a partially translated catalogue
-- degrades product by product instead of showing gaps.
--
-- English stays in `name` / `description`. It is the source the translations
-- were made from and the fallback they degrade to, so it is not one locale
-- among three.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS name_pt        VARCHAR(256),
    ADD COLUMN IF NOT EXISTS name_es        VARCHAR(256),
    ADD COLUMN IF NOT EXISTS description_pt TEXT,
    ADD COLUMN IF NOT EXISTS description_es TEXT;
