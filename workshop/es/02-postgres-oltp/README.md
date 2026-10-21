# Módulo 02: Postgres transaccional (opcional)

> **Puedes saltarte este módulo.** Los datos que revisa los cargó `make pg-setup` en el [módulo 01](../01-cloud-services/README.md), y nada posterior depende de haberlo leído. Está aquí para los curiosos: un recorrido por el lado transaccional, y por qué vive en Postgres y no en ClickHouse.

**Objetivo:** revisar el catálogo de ClickShop, los clientes, el inventario y el historial de pedidos en Postgres, y entender por qué los datos transaccionales viven ahí.

**Tiempo:** unos 10 minutos.

**Aprenderás:**
- cómo se ve un esquema OLTP para una tienda: tablas normalizadas, restricciones, transacciones de una fila a la vez;
- cómo el proceso de pago descuenta el inventario sin sobrevender nunca;
- las reglas del esquema que importan para la replicación (cada tabla tiene una clave primaria de una sola columna), en las que se apoya el módulo 03.

## Antes de empezar

`make check-01` y `make check-02` pasan (el módulo 01 cargó los datos).

## Pasos

### 1. Qué se cargó

El `make pg-setup` del módulo 01 creó la base de datos `clickshop` si no existía, aplicó `sql/postgres/*.sql` y la pobló con el catálogo de `assets/catalog_details/catalog.json`. La carga inicial es determinista, así que todos obtienen los mismos datos, e idempotente. Deberías tener:

```
  categories        5
  products        978   active 691, on placeholder image 287
  stock           978   low (<=15 units) 30
  customers       500
  orders        2,000
  order_items   5,989
```

El catálogo tiene 978 productos, y 691 están **activos**: los que sus dueños no desactivaron ni marcaron para eliminación y que tienen foto. Los otros 287 quedan en la tabla como filas inactivas (un borrado lógico), y la tienda nunca los muestra. 30 productos activos empiezan con solo 3 a 15 unidades, así que se agotan mientras el simulador corre en el módulo 07. Los 2,000 pedidos son historial de los últimos dos años. (`make pg-setup` es `make pg-migrate`, que crea las tablas, seguido de `make pg-seed`, que carga los datos.)

### 2. Recorrer el esquema

```bash
make psql
```

Esto abre `psql` en la base de datos del taller, sobre TLS. Prueba:

```sql
\dt
\d orders
```

Ves seis tablas: `categories`, `products`, `stock`, `customers`, `orders` y `order_items`. Mira cómo se relacionan:

```sql
-- the catalogue by category, active products only
SELECT c.name AS category, count(*) AS active_products
FROM products p JOIN categories c ON c.id = p.category_id
WHERE p.is_active
GROUP BY c.name ORDER BY active_products DESC;

-- the products closest to selling out
SELECT p.id, p.name, s.quantity
FROM stock s JOIN products p ON p.id = s.product_id
WHERE p.is_active ORDER BY s.quantity, p.id LIMIT 5;

-- orders by status and payment method
SELECT status, payment_method, count(*) FROM orders GROUP BY 1, 2 ORDER BY 1, 2;
```

### 3. Ver por qué esto es trabajo para Postgres

Mira cómo el proceso de pago toma una unidad de inventario. Es una sola sentencia:

```sql
UPDATE stock SET quantity = quantity - 2, updated_at = now()
WHERE product_id = 3 AND quantity >= 2;
```

Si dos compradores compran la última unidad en el mismo instante, Postgres bloquea la fila, la primera actualización tiene éxito, y la segunda encuentra que `quantity >= 2` es falso y no cambia nada, de modo que el proceso de pago puede decirle a ese comprador que el artículo se agotó. El `CHECK (quantity >= 0)` de la tabla es una segunda protección. Pruébalo sin conservar el cambio:

```sql
BEGIN;
UPDATE stock SET quantity = quantity - 2 WHERE product_id = 3 AND quantity >= 2 RETURNING product_id, quantity;
ROLLBACK;
```

Para eso sirve una base de datos transaccional: escrituras pequeñas y concurrentes que deben ser correctas. No es donde quieres ejecutar un dashboard, que lee millones de filas para responder una sola pregunta. Eso es trabajo de ClickHouse, y el siguiente módulo une a los dos.

Sal de `psql` con `\q`.

### 4. Leer el archivo de esquema una vez

Abre `sql/postgres/001_schema.sql`. Dos detalles importan más adelante:

- **Cada tabla tiene un `SERIAL PRIMARY KEY` de una sola columna.** El ClickPipe replica los cambios por clave primaria; una tabla sin ella no replicaría sus actualizaciones ni sus eliminaciones.
- **`order_items` no tiene columna `subtotal`.** La replicación lógica no publica las columnas generadas por defecto, así que nunca llegaría a ClickHouse. Calcula `quantity * unit_price` en las consultas en su lugar.

## Punto de control

```bash
make check-02
```

Ves 5 categorías, 978 productos (691 activos), una fila de inventario para cada producto, al menos 500 clientes y 2,000 pedidos.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `products already seeded` | No pasa nada: la carga ya se ejecutó antes. |
| `make psql` dice que no puede conectarse | `make doctor` dice por qué; normalmente es el ajuste de IP access o la contraseña. |
| `the input device is not a TTY` | `make psql` es interactivo; ejecútalo en una terminal, no a través de un pipe. |
| Quieres empezar los datos de cero | `make pg-reset` trunca cada tabla y vuelve a cargar los datos. **No una vez que exista el ClickPipe del módulo 03**: ignora TRUNCATE, así que ClickHouse conservaría las filas. Usa entonces `make nuke-data`. |

## Para ir más lejos

- `products.attributes` es una columna `JSONB` con un índice GIN. Prueba `SELECT name, attributes FROM products WHERE attributes ? 'color' LIMIT 5;`.
- `orders.domain_userid` es el id del navegador del comprador. En el módulo 07 es lo que une un pedido con el clickstream.

**Siguiente:** [módulo 03, CDC con ClickPipes](../03-cdc-clickpipe/README.md).
