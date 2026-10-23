# Módulo 07: Compradores simulados

**Objetivo:** hacer que "compradores" con navegador headless usen la tienda de verdad y hagan pedidos que modifican Postgres y fluyen hacia ClickHouse, y luego unir esos pedidos con el clickstream.

**Tiempo:** unos 30 minutos. La comprobación necesita unos 20 minutos de compradores, así que inícialos primero y sigue los pasos mientras compran. `make sim-start` tarda 16 s.

**Aprenderás:**
- cómo una escritura transaccional (un pedido y su cambio de inventario) llega a una base de datos analítica, y cómo medir el retraso;
- cómo unir en ClickHouse los datos de dos sistemas: los pedidos de Postgres y los eventos del navegador;
- cómo se ve un embudo de compra desde el lado de los pedidos.

## Antes de empezar

`make check-06` pasa (módulo 06). Deja los generadores en ejecución o detenlos: el simulador no los necesita (`make generators-stop`).

## Pasos

### 1. Inicia los compradores

Si ejecutaste `make setup`, ya están en ejecución (dos navegadores): pasa al paso 2. (`make traffic-start` los inicia junto con los generadores del módulo 06.)

```bash
make sim-start
make logs S=simulator
```

Un pod inicia dos navegadores Chromium (unos 300 MB de memoria cada uno; `SIM_USERS` en `.env` define cuántos). Los compradores llegan a un ritmo de unos **tres por minuto**, y cada uno se comporta como una persona en la tienda real: abre una página de inicio, recorre categorías, busca, abre productos, a veces agrega al carrito y paga con tarjeta, Pix o Boleto. Navegan en inglés, portugués o español y buscan en ese idioma. Más o menos una de cada seis sesiones termina en un pedido. Cada clic pasa por la página real, así que el tracker real de Snowplow emite los eventos, la API real escribe el pedido y la instrumentación real de OpenTelemetry registra las trazas.

El log imprime una línea cada 30 segundos:

```text
[sim] t+ 240s  active=3  x1.00 ( 6.0/min)  sessions=29  views=111  searches=5  carts=10  orders=8  failed=0  soldout=0
```

`sessions` es cuántos compradores han llegado, `orders` cuántos hicieron un pedido, `failed` cuántos pedidos fueron rechazados (la falla de la pasarela de tarjeta, en el módulo 08) y `soldout` cuántos encontraron un producto agotado.

### 2. Mira cómo llegan los pedidos

En `make psql` (Postgres):

```sql
SELECT id, status, payment_method, total_amount, created_at FROM orders ORDER BY id DESC LIMIT 5;
```

Aparecen filas nuevas cada minuto más o menos, con ids a partir de 2,000 (el historial inicial). En ClickHouse (consola SQL, o `make ch-query Q="..."`), los mismos pedidos aparecen después de la siguiente sincronización del ClickPipe:

```sql
SELECT id, status, payment_method, total_amount, created_at
FROM retail_oltp.orders FINAL WHERE _peerdb_is_deleted = 0
ORDER BY created_at DESC LIMIT 5;
```

### 3. Mide el retraso

Ejecuta la consulta 4 de `sql/clickhouse/examples/07_simulated_shoppers.sql`:

```sql
SELECT max(created_at) AS newest_order_replicated,
       dateDiff('second', max(created_at), now()) AS seconds_since_newest_order,
       dateDiff('second', max(_peerdb_synced_at), now()) AS seconds_since_last_sync
FROM retail_oltp.orders;
```

Compara `newest_order_replicated` con `SELECT max(created_at) FROM orders` en Postgres: la diferencia es el retraso del CDC, hasta el intervalo de sincronización más unos segundos. `seconds_since_last_sync` muestra cuándo fue la última vez que el ClickPipe trajo algo.

### 4. Observa cómo se mueve el inventario

La consulta 3 del mismo archivo lista los productos que más se vendieron en la última hora frente al inventario que les queda. Treinta productos empezaron con solo 3 a 15 unidades, así que durante la ejecución algunos se agotan, y los compradores que los encuentran agotados cuentan en `soldout`. Postgres rechazó la segunda venta de forma atómica, como viste en el módulo 02.

### 5. Une los pedidos con el clickstream

Los pedidos están en `retail_oltp` (vienen de Postgres), y la navegación está en `retail_analytics.snowplow_events` (viene de Snowplow, a través del bridge). Dos claves los conectan:

- el **id del pedido**: el evento `checkout_payment_confirmed` lo lleva en `se_property`;
- el **visitante**: `orders.domain_userid` es el id del navegador.

Consulta 1:

```sql
SELECT o.id AS order_id, o.status, o.payment_method, o.total_amount,
       e.domain_userid, e.domain_sessionid, e.collector_tstamp
FROM retail_oltp.orders AS o FINAL
INNER JOIN retail_analytics.snowplow_events AS e ON toString(o.id) = e.se_property
WHERE e.event_name = 'checkout_payment_confirmed' AND o._peerdb_is_deleted = 0
ORDER BY e.collector_tstamp DESC LIMIT 10;
```

Toma un `order_id` del resultado y ponlo en la consulta 2, que lista **todo lo que hizo ese comprador**, antes y después del pedido. (Los pedidos y los eventos de los generadores no tienen un pedido que coincida, así que el join devuelve solo los reales.)

Esta es la idea central del taller en una sola consulta: una fila escrita por una transacción en Postgres y una fila escrita por un navegador, unidas en ClickHouse unos segundos después.

### 6. Ingresos por método de pago

La consulta 5 suma los pedidos confirmados por `credit_card`, `pix` y `boleto`. Después de unos veinte minutos deberías ver los tres.

**Deja los compradores en ejecución**: el módulo 08 necesita el tráfico. Cuando termines todo el taller: `make sim-stop` (o `make traffic-stop` para detener también los generadores).

## Punto de control

Después de unos veinte minutos de compradores:

```bash
make check-07
```

Hay pedidos confirmados con los tres métodos de pago desde la carga inicial, y los pedidos se unen con sus eventos de pago. (Cuando lo ejecutamos durante diez minutos con la carga completa, el doble de esta: 12 pedidos, tarjeta 5, Pix 5, Boleto 2, 12 clientes distintos, los 12 unidos.)

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `make sim-start` tarda un poco la primera vez | Carga la imagen del navegador de 1.5 GB en el nodo (11 s en nuestra máquina). |
| El pod del simulador está en `Pending`, o `make sim-start` falla con `context deadline exceeded` | Si Docker se reinició o se actualizó con el clúster en marcha, ejecuta `make up` (reinicia los nodos trabados) y luego `make sim-start`. Si no, no hay suficiente memoria: baja `SIM_USERS` en `.env` o dale más a Docker. |
| `failed` sigue subiendo | Se están rechazando pedidos. `make logs S=frontend`; si ejecutaste `make break-card-gateway` en el módulo 08, ejecuta `make fix-card-gateway`. |
| No hay pedidos después de varios minutos | `make logs S=simulator` para ver errores; `make doctor` para las bases de datos. |
| El join no devuelve nada | El ClickPipe aún no se ha puesto al día, o el bridge va atrasado: `make status`. |
| `check-07` pide un pedido de cada método | Deja los compradores en ejecución un poco más: más o menos una de cada seis sesiones hace un pedido, y la tarjeta es la mitad de los pedidos. Con la carga de `.env.example` tarda unos 20 minutos. |

## Para ir más lejos

- `make sim-start USERS=4` duplica los navegadores (y la memoria) por una vez; `SIM_USERS=4` en `.env` lo mantiene. [COMMANDS.es.md](../../../COMMANDS.es.md) dice hasta dónde aguanta la carga una laptop. El ritmo de llegada y lo cortas que son sus pausas vienen de `.env`: `SIM_ARRIVALS_PER_MINUTE` y `SIM_DWELL_SCALE`.
- Ejecuta de nuevo la consulta del embudo del módulo 06 para la última hora y compara la conversión con lo que producen los generadores.
- `data-generators/README.md` describe cómo deciden los compradores qué hacer.

**Siguiente:** [módulo 08, Observabilidad con ClickStack](../08-observability-clickstack/README.md).
