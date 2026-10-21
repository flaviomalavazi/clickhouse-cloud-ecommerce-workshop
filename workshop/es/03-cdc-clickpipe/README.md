# Módulo 03: CDC con ClickPipes

**Objetivo:** replicar las seis tablas de Postgres en ClickHouse con un **Postgres CDC ClickPipe** y, después, aprender cómo ClickHouse almacena una tabla que cambia continuamente.

**Tiempo:** unos 25 minutos: 10 para configurar el pipe y esperar la primera carga, 15 para el ejercicio.

**Aprenderás:**
- la captura de cambios de datos (change data capture): ClickHouse lee el write-ahead log de Postgres y aplica los cambios, sin triggers y sin código de aplicación;
- por qué las tablas replicadas son `ReplacingMergeTree` y qué son `_peerdb_version` y `_peerdb_is_deleted`;
- cuándo necesitas `FINAL` y cuál es la alternativa;
- qué significa el intervalo de sincronización para la frescura de la copia.

## Antes de empezar

`make check-02` pasa (módulo 02).

## Pasos

> **La forma rápida.** `make clickpipes` crea el pipe descrito más abajo a través de la API de ClickHouse Cloud, y `make setup` lo hace por ti junto con todo lo demás. `make notebook` abre un notebook, `01_create_clickpipes.ipynb`, que hace las mismas llamadas una por una y muestra la solicitud, que es la forma más clara de ver en qué se convierte cada ajuste de la consola. Los tres necesitan la clave de API del [módulo 01](../01-cloud-services/README.md). Los pasos de abajo indican en qué hacer clic si prefieres hacerlo a mano, y dan el mismo pipe (comparamos las tablas que crea con las que crea la consola: mismos nombres, motores, claves de ordenamiento y columnas). Los comandos reconocen un pipe que hayas creado a mano, sea cual sea su nombre, cuando copia la misma base de datos de Postgres en la misma base de datos de ClickHouse, así que ejecutar `make clickpipes` o `make setup` después de los pasos en la consola no crea un segundo pipe.

### 1. Crear el ClickPipe

En la consola de ClickHouse Cloud, abre tu **instancia de Postgres** y haz clic en **Sync to ClickHouse** en su barra lateral, luego en **Replicate data in ClickHouse**.

**Configure the replication service**

| Ajuste | Valor |
|---|---|
| Integration name | `clickshop-cdc` |
| ClickHouse service | tu servicio `clickshop` |
| Postgres database | `clickshop` |
| Replication method | **Initial load + CDC** (copia lo que hay y luego lo mantiene actualizado) |

Haz clic en **Next**.

**Configure replication settings**

| Ajuste | Valor |
|---|---|
| Sync interval (seconds) | `60` (el valor predeterminado) |

Deja el resto de los ajustes con sus valores predeterminados y haz clic en **Next**.

**Select tables to replicate**

| Ajuste | Valor |
|---|---|
| Destination database | `retail_oltp` (lo creó el módulo 01) |
| Prefix default destination table names with schema name | **desactivado**, para que las tablas se llamen `orders` y no `public_orders` |
| Preserve NULL values from source | **desactivado**: un NULL de Postgres se convierte en el valor predeterminado del tipo (una cadena vacía, o 0). Esto no se puede cambiar después |
| Remove deleted rows during merges | **desactivado**: conserva las marcas de borrado, para que puedas verlas más abajo |

Expande el esquema `public` y selecciona las **seis** tablas: `categories`, `products`, `stock`, `customers`, `orders` y `order_items`. Luego haz clic en **Replicate data to ClickHouse**.

El pipe aparece en la lista de integraciones. Haz clic en su nombre para ver su estado. La primera carga es de unas 10,000 filas y tarda uno o dos minutos. (Un pipe creado antes de cargar los datos, que es lo que hace `make setup`, no tiene nada que copiar al principio: las filas llegan como cambios, un intervalo de sincronización después.)

### 2. Ver lo que creó el pipe

Ejecuta SQL en la consola SQL, o desde tu terminal: `make ch-query Q="SHOW TABLES FROM retail_oltp"` ejecuta una sentencia e imprime el resultado (pon el SQL entre comillas dobles, casi siempre tiene comillas simples dentro), y `make ch-client` abre un prompt. Las consultas de `sql/clickhouse/examples/` están numeradas, y `make ch-query FILE=sql/clickhouse/examples/03_cdc_dedup.sql N=1` ejecuta la número 1.

```sql
SHOW TABLES FROM retail_oltp;
SHOW CREATE TABLE retail_oltp.orders;
```

Además de tus seis tablas hay una llamada `_peerdb_raw_mirror_…`: es el área de preparación (staging) propia del pipe. No la toques. En `orders` verás:

```text
ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _peerdb_version)
PRIMARY KEY (id) ORDER BY (id)
```

y tres columnas adicionales:

| Columna | Significado |
|---|---|
| `_peerdb_version` | Un número que crece con cada cambio de una fila; el más alto corresponde a la fila actual |
| `_peerdb_is_deleted` | `1` cuando la fila se borró en Postgres |
| `_peerdb_synced_at` | Cuándo escribió la fila el pipe |

(`SharedReplacingMergeTree` es `ReplacingMergeTree` tal como lo ejecuta ClickHouse Cloud.)

### 3. Cambiar algo en Postgres y ver cómo llega

Abre `make psql` y crea un pedido a mano:

```sql
INSERT INTO orders (customer_id, status, payment_method, total_amount)
VALUES (1, 'pending', 'pix', 10.00) RETURNING id;
```

Anota el `id`. En ClickHouse, con ese id en lugar de `ORDER_ID`:

```sql
SELECT id, status, _peerdb_version, _peerdb_is_deleted
FROM retail_oltp.orders WHERE id = ORDER_ID ORDER BY _peerdb_version;
```

La fila aparece después de la siguiente sincronización: con el intervalo de 60 segundos, en cerca de un minuto (medido: un cambio llegó de 38 a 63 segundos después con el intervalo de 60 segundos). Ahora confirma el pedido en Postgres:

```sql
UPDATE orders SET status = 'confirmed', updated_at = now() WHERE id = ORDER_ID;
```

y ejecuta de nuevo la misma consulta de ClickHouse después de la siguiente sincronización. Obtendrás **dos filas**: `pending` y `confirmed`, con versiones distintas. ClickHouse nunca actualiza una fila en el mismo lugar; el pipe inserta la nueva versión y un merge en segundo plano elimina la anterior más tarde. Mientras tanto, un `SELECT` normal ve ambas.

Dos formas de leer solo la versión actual:

```sql
-- FINAL collapses each row to its latest version while reading, and the filter hides deleted rows
SELECT id, status FROM retail_oltp.orders FINAL
WHERE id = ORDER_ID AND _peerdb_is_deleted = 0;

-- the same without FINAL: keep the values of the highest version
SELECT id, argMax(status, _peerdb_version) AS status
FROM retail_oltp.orders WHERE id = ORDER_ID GROUP BY id;
```

Por último, bórralo en Postgres (`DELETE FROM orders WHERE id = ORDER_ID;`) y vuelve a mirar. Aparece una **tercera fila** con `_peerdb_is_deleted = 1` y un `status` vacío (un borrado lleva solo la clave), y la consulta con `FINAL` y el filtro no devuelve nada. Un borrado es una versión más.

### 4. Contar pedidos de la forma incorrecta y de la correcta

`sql/clickhouse/examples/03_cdc_dedup.sql` tiene las consultas para esto. Ejecútalas en orden, de la número 1 a la 5 (`make ch-query FILE=sql/clickhouse/examples/03_cdc_dedup.sql N=1`, luego `N=2`, y así sucesivamente). Los conteos difieren solo por los pedidos que cambiaron de estado, que pueden ser un puñado con los datos iniciales y crecen con cada pedido que confirman los compradores. La que hay que recordar es el conteo por estado: **sin `FINAL`, un pedido que cambió de estado se cuenta una vez por cada versión**, así que todo reporte que lea una tabla replicada necesita `FINAL` y el filtro `_peerdb_is_deleted = 0` (o la forma con `argMax`).

> **Por qué la tienda no te mostrará esto.** Cuando la aplicación hace un pedido, lo inserta como `pending` y lo confirma unos dos segundos después. El pipe toma ambos cambios en un mismo lote y ClickHouse solo llega a tener la fila `confirmed`. Por eso hiciste un pedido a mano.

## Punto de control

```bash
make check-03
```

Las seis tablas están en `retail_oltp`, cada una tiene las columnas `_peerdb_`, y los conteos de filas coinciden con Postgres, leídos con `FINAL`. (El pedido que creaste y borraste ya no está en Postgres, ni en ClickHouse cuando lo lees con `FINAL` y el filtro de borrado: sus tres versiones siguen ahí, la última marcada como borrada.)

## Solución de problemas

| Síntoma | Solución |
|---|---|
| El pipe muestra un error | Haz clic en su nombre y léelo. Las causas habituales: el acceso por IP de la instancia bloquea las direcciones de ClickPipes (módulo 01), o usaste la dirección del pooler. |
| Falta una tabla en `retail_oltp` | La primera carga sigue en curso (comprueba el estado del pipe), o no la seleccionaste: la página del pipe lista las tablas que replica. |
| `check-03` dice que no está sincronizado | El pipe va retrasado. Espera un intervalo de sincronización (hasta un minuto) y vuelve a ejecutarlo. |
| `make clickpipes` muestra `401` o `403` | La clave de API es incorrecta o no es una clave Admin (módulo 01). |
| `make clickpipes` falla por el certificado | `PGSSLROOTCERT` en `.env` debe apuntar al archivo de la CA de Postgres: el pipe verifica tu servidor con él. |
| `Preserve NULL values` estaba activado | Las tablas tienen columnas `Nullable`. Todo sigue funcionando, pero el resto del taller supuso que estaba desactivado. Elimina el pipe en la consola, borra las tablas que creó (`make ch-query Q="DROP DATABASE retail_oltp"`, luego `make ch-bootstrap` vuelve a crear la base de datos vacía) y crea el pipe de nuevo con el ajuste desactivado. |
| Quieres reiniciar los datos | `make nuke-data` trunca Postgres, vacía el mirror, vuelve a cargar los datos iniciales y espera al pipe. `make pg-reset` por sí solo deja ClickHouse desincronizado, porque el pipe ignora TRUNCATE. |

## Para ir más lejos

- La frescura de todo lo que se construye sobre estas tablas es el intervalo de sincronización más unos segundos. Cambia el intervalo en la página del pipe (prueba con 10 segundos) y mídela de nuevo.
- `SELECT count() FROM system.parts WHERE database = 'retail_oltp' AND table = 'orders' AND active` muestra cuántas partes contienen la tabla; los merges colapsan las versiones antiguas a medida que se ejecutan.

**Siguiente:** [módulo 04, Búsqueda de texto completo](../04-full-text-search/README.md).
