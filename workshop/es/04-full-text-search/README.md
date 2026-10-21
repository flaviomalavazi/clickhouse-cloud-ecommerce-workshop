# Módulo 04: Búsqueda de texto completo

**Objetivo:** construir la búsqueda de productos de la tienda sobre ClickHouse, a partir del catálogo de Postgres que replica el ClickPipe.

**Tiempo:** unos 20 minutos. `make ch-search` tarda 2 s.

**Aprenderás:**
- el índice `text` (con disponibilidad general en ClickHouse 26.2 y posteriores): tokenizadores y preprocesadores;
- `hasAllTokens` y `hasAnyTokens`, y por qué no necesitas `lower()` ni manejo de acentos en las consultas;
- una **vista materializada actualizable** que reconstruye una tabla de forma programada;
- cómo comprobar que se usa un índice y cuál es el presupuesto de frescura de la búsqueda.

## Antes de empezar

`make check-03` pasa (módulo 03): la búsqueda se construye **a partir de** `retail_oltp`, así que esas tablas deben existir y estar llenas.

## Pasos

### 1. Construir la tabla de búsqueda

```bash
make ch-search
```

Esto aplica `sql/clickhouse/10_products_search.sql`. Ábrelo y léelo; las partes importantes:

- **`products_search`** es una tabla `MergeTree` simple: una fila por producto, con el nombre, la marca, la descripción, el precio y el inventario.
- **Tres cadenas de búsqueda**, `search_en`, `search_pt` y `search_es`, una por idioma. Cada una es el nombre, la marca y la descripción del producto en ese idioma, con el inglés como respaldo cuando falta una traducción.
- **Un índice `text` en cada una**, por ejemplo:

  ```sql
  INDEX idx_search_en search_en TYPE text(
      tokenizer    = splitByNonAlpha,
      preprocessor = lower(replaceRegexpAll(normalizeUTF8NFD(search_en), '\\p{M}', '')))
  ```

  El tokenizador divide el texto en palabras en cualquier carácter que no sea una letra. El **preprocesador** se ejecuta sobre el texto *y sobre cada término de búsqueda*: pasa a minúsculas y elimina los acentos (descompone la letra y luego descarta la marca combinante). Así, `TÊNIS`, `tênis` y `tenis` son la misma palabra.
- **`products_search_refresh`** es una vista materializada actualizable:

  ```sql
  CREATE MATERIALIZED VIEW ... REFRESH EVERY 5 MINUTE TO retail_analytics.products_search AS SELECT ... FROM retail_oltp.products FINAL ...
  ```

  Cada cinco minutos vuelve a ejecutar la consulta sobre las tablas de Postgres replicadas y reemplaza el contenido de `products_search` de forma atómica. Postgres sigue siendo la única fuente de verdad del catálogo, y los niveles de inventario aparecen en la búsqueda sin que ningún código nuestro haga la copia.

Fuerza la primera construcción en lugar de esperar hasta cinco minutos (en la consola SQL, o `make ch-query Q="SYSTEM REFRESH VIEW retail_analytics.products_search_refresh; SYSTEM WAIT VIEW retail_analytics.products_search_refresh"`; la primera sentencia solo inicia la actualización, la segunda espera hasta que termine):

```sql
SYSTEM REFRESH VIEW retail_analytics.products_search_refresh;
SYSTEM WAIT VIEW retail_analytics.products_search_refresh;
```

### 2. Buscar

Ejecuta las consultas de `sql/clickhouse/examples/04_full_text_search.sql` en la consola SQL, o una por una desde tu terminal: `make ch-query FILE=sql/clickhouse/examples/04_full_text_search.sql N=1`, luego `N=2`, y así sucesivamente. Las que conviene probar primero:

```sql
-- all of the words must appear
SELECT product_id, name, brand, price, stock_quantity
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_en, 'running shoes')
ORDER BY stock_quantity > 0 DESC, price
LIMIT 10;

-- any of the words: the fallback when "all" finds nothing
SELECT count() FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAnyTokens(search_en, 'running keyboard');

-- the same word with and without the accent, in Portuguese
SELECT count() FROM retail_analytics.products_search WHERE is_active = 1 AND hasAllTokens(search_pt, 'tênis');
SELECT count() FROM retail_analytics.products_search WHERE is_active = 1 AND hasAllTokens(search_pt, 'tenis');
```

`running shoes` encuentra 5 productos, y los dos conteos en portugués son iguales (59 en nuestra ejecución). El cuadro de búsqueda de la tienda ejecuta el mismo tipo de consulta: primero `hasAllTokens`, y `hasAnyTokens` cuando nada coincide.

### 3. Comprobar que se usa el índice

```sql
EXPLAIN indexes = 1
SELECT product_id FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_en, 'running shoes');
```

Busca la sección `Skip`: `Name: idx_search_en`, con los tokens `running` y `shoes`, y los gránulos que dejó fuera del total.

### 4. Observar la actualización

```sql
SELECT view, status, last_success_time, last_success_duration_ms, next_refresh_time, exception
FROM system.view_refreshes WHERE database = 'retail_analytics';
```

`last_success_time` avanza cinco minutos cada vez (una actualización tarda una fracción de segundo, unos 230 ms en nuestra ejecución), y `next_refresh_time` indica cuándo será la siguiente.

### 5. Hacer la aritmética de la frescura

Un cambio en Postgres llega a la búsqueda tras **el intervalo de sincronización del ClickPipe (60 segundos), más hasta cinco minutos** para la siguiente actualización. Para evitar la segunda espera, ejecuta `SYSTEM REFRESH VIEW` como arriba. En el próximo módulo harás un pedido y verás cómo el cambio de inventario recorre exactamente este camino.

> `FINAL` sobre `products_search` es un error: es un `MergeTree` simple, no un `ReplacingMergeTree`. El `FINAL` que usa la consulta de la vista está sobre las tablas *replicadas* que lee.

## Punto de control

```bash
make check-04
```

`products_search` tiene 978 productos (691 activos) y índices de texto, un `EXPLAIN` muestra `idx_search_en`, `running shoes` encuentra productos, y la vista se actualizó en los últimos seis minutos.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `products_search` está vacía | La vista aún no se ha ejecutado: `SYSTEM REFRESH VIEW retail_analytics.products_search_refresh;` y luego `SYSTEM WAIT VIEW retail_analytics.products_search_refresh;`. Si sigue vacía, `retail_oltp.products` está vacía: vuelve al módulo 03. |
| `make ch-search` falla con una tabla desconocida | El ClickPipe aún no ha creado `retail_oltp.products`. Espera a la primera carga. |
| Un error del índice de texto menciona un tipo de índice desconocido | El servicio es anterior a la versión 26.2. |
| `Storage SharedMergeTree doesn't support FINAL` | Usaste `FINAL` en `products_search`; quítalo. |
| `Needle must not contain whitespace or separator characters` | Usaste `hasToken`, que acepta una sola palabra. Usa `hasAllTokens` o `hasAnyTokens`: dividen el término con el tokenizador propio del índice, así que `USB-C` y `usb c` son la misma búsqueda (38 productos). |

## Para ir más lejos

- Agrega una columna a la consulta de la vista y otra equivalente a la tabla, y mira cómo aparece después de la siguiente actualización.
- Prueba `hasAllTokens(search_es, 'zapatillas')`, y compara `hasAllTokens` con `hasAnyTokens` en una frase de tres palabras.

**Siguiente:** [módulo 05, Ejecutar la aplicación](../05-run-the-app/README.md).
