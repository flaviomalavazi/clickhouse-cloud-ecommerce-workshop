# Módulo 08: Observabilidad con ClickStack

**Objetivo:** ver todo el sistema en ClickStack, el producto de observabilidad de ClickHouse: trazas y el mapa de servicios, logs con búsqueda de texto completo, reproducciones de sesión e infraestructura de Kubernetes. Después, romper algo a propósito y encontrar la causa.

**Tiempo:** unos 40 minutos.

**Aprenderás:**
- cómo las trazas, los logs y las métricas de cada parte del taller llegan a la misma base de datos de ClickHouse (`retail_otel`) que tus datos de negocio;
- cómo seguir un pago por 6 a 8 servicios (según cómo pague el comprador), hasta el SQL que ejecutó;
- cómo encontrar las búsquedas que no devolvieron nada, a partir de un atributo de la traza;
- que los logs se buscan con el mismo índice `text` que la búsqueda de productos del módulo 04;
- cómo se manifiesta una falla y cómo seguirla hasta su causa.

## Antes de empezar

`make check-07` pasa (módulo 07), y el simulador está en ejecución (`make sim-start`) o ha corrido unos minutos: las pantallas de abajo necesitan tráfico. Todo lo que el clúster observa ya está fluyendo: en este módulo no instalas nada.

## Pasos

### 1. Abre ClickStack y crea las fuentes de datos

> **La vía rápida.** Abre ClickStack una vez desde tu servicio en la consola (eso crea su conexión con tu servicio) y luego ejecuta `make clickstack-setup`. Crea las cuatro fuentes de abajo mediante la API de Cloud, enlazadas entre sí, y deja intacta cualquier fuente que ya exista; `make setup` lo ejecuta por ti. Necesita la clave de API del [módulo 01](../01-cloud-services/README.md). Para ver las fuentes que creó, ejecuta `make clickstack-list`. O hazlo a mano, como sigue.

En la consola de ClickHouse Cloud, abre tu servicio `clickshop` y lanza **ClickStack**. ClickStack lee las tablas que llena el collector de OpenTelemetry; el collector de este taller las escribe en la base de datos **`retail_otel`**, no en `default`, así que tú le indicas a ClickStack dónde están. En los ajustes de ClickStack, crea (o confirma) cuatro **sources**, usando la conexión a tu servicio y lo siguiente:

| Tipo de fuente | Base de datos | Tabla |
|---|---|---|
| Logs | `retail_otel` | `otel_logs` |
| Traces | `retail_otel` | `otel_traces` |
| Metrics | `retail_otel` | las tablas `otel_metrics_*` (gauge, sum, histogram, exponential histogram, summary) |
| Sessions | `retail_otel` | `hyperdx_sessions` |

Cada formulario de fuente también pide un nombre, una columna de timestamp y algunas expresiones para el nombre del servicio, la severidad, etc.; ClickStack sugiere las correctas para las tablas que crea el collector.

Lo que llena esas tablas: la tienda y los 14 servicios envían trazas, logs y métricas al `otel-gateway`; los navegadores envían sus trazas y grabaciones de sesión a través del `/api/otlp` de la tienda; y dos collectors del chart de OpenTelemetry envían logs, métricas y eventos de Kubernetes. Todo termina en `retail_otel`, en el mismo servicio que tus pedidos y tu clickstream.

### 2. El mapa de servicios

En **Search**, con la fuente **Logs**, busca cualquier línea de un servicio demo, por ejemplo `journey completed`, y haz clic en ella. La fila se abre con pestañas: **Overview**, **Column Values**, **Service Map**, **Surrounding Context** e **Infrastructure**. Abre **Service Map**.

Ves el recorrido de un pago: el frontend llama al `storefront-bff`; el bff llama a `checkout-svc`; checkout llama a `pricing-svc` e `inventory-svc`, luego al servicio de pago del método elegido (`payment-card-svc`, `payment-pix-svc` o `payment-boleto-svc`), cada uno de los cuales llama a su pasarela, y después a `order-svc`, que llama a `ledger-svc` y `email-gateway`. En total, 15 servicios.

### 3. Un pago, hasta el SQL

Cambia la fuente a **Traces** y busca el span **`checkout.place_order`**. Tiene los atributos `clickshop.order_id`, `clickshop.payment_method`, `clickshop.order_status` y `clickshop.item_count`: elige un id de pedido del módulo 07 y encontrarás su traza. Ábrela y lee el waterfall:

- `POST /api/checkout/complete` en el frontend es la raíz;
- dentro de ella, los spans `pg.query:` son las **consultas a Postgres** del pedido: `BEGIN`, `SELECT` (los productos), `INSERT` (el cliente, el pedido y sus artículos), `UPDATE` (el inventario, luego el estado) y `COMMIT`, cada una con su sentencia en el `db.statement` del span;
- luego las llamadas HTTP a los servicios, cada uno de los cuales tiene sus propios spans.

Los spans `clickhouse.query` son las consultas del frontend a ClickHouse (la búsqueda y el dashboard), con el SQL y las filas leídas.

### 4. Encuentra las búsquedas que no devolvieron nada

Cada búsqueda que ejecuta la tienda es un span, **`search.products`**, con atributos: `search.query`, `search.locale`, `search.results`, `search.total`, `search.match_mode`, `search.read_rows`, `search.elapsed_ms`. Una búsqueda que no encontró nada tiene `search.results` = `0`. Filtra las trazas por eso. La misma lista, como consulta SQL en la consola:

```sql
SELECT SpanAttributes['search.query'] AS query, count() AS searches
FROM retail_otel.otel_traces
WHERE SpanName = 'search.products' AND SpanAttributes['search.results'] = '0'
GROUP BY query ORDER BY searches DESC;
```

Abre una de las trazas: el span `search.products` tiene anidado el span `clickhouse.query`, con la consulta `hasAllTokens` que ejecutó.

### 5. Reproducción de sesión

Abre la vista **Sessions** (sesiones de cliente). Cada fila es la sesión de navegador de un comprador simulado, grabada por el SDK del navegador: haz clic en una y reprodúcela. Ves la navegación del comprador, y puedes saltar de la sesión a sus trazas y logs.

### 6. La búsqueda en los logs usa el mismo índice que el módulo 04

Busca en los logs `card gateway unavailable` (no hay coincidencias hasta que hagas el ejercicio de abajo). ClickHouse responde con el índice `text` que usaste en el módulo 04. En la consola:

```sql
SHOW CREATE TABLE retail_otel.otel_logs;
```

Busca `INDEX idx_lower_body lower(Body) TYPE text(tokenizer = 'splitByNonAlpha')`: la búsqueda en los logs es una búsqueda de texto completo sobre `Body`, la misma tecnología que `hasAllTokens` sobre `products_search`. Igual que en el módulo 04, las palabras se separan en los caracteres que no son letras, así que `card_gateway_unavailable` se busca como `card gateway unavailable`:

```sql
SELECT ServiceName, count() FROM retail_otel.otel_logs
WHERE hasAllTokens(Body, 'card gateway unavailable') GROUP BY ServiceName;
```

### 7. Infraestructura: pods y nodos

Abre cualquier línea de log de un pod (un servicio demo, por ejemplo) y su pestaña **Infrastructure**: la CPU y la memoria del pod a lo largo del tiempo, y un **pod timeline** con los eventos de Kubernetes, como un contenedor que se termina cuando se despliega un deployment. Los números son los del kubelet, recopilados por el DaemonSet de OpenTelemetry; el vínculo con esta línea de log es la identidad del pod (`k8s.pod.uid`), que cada servicio agrega a su telemetría.

Para todo el clúster, abre **Dashboards** y **Kubernetes**: las pestañas **Pods**, **Nodes** y **Namespaces** listan 3 nodos y los pods de `clickshop` y `observability`, con CPU, memoria y eventos.

### 8. Ejercicio: rompe la pasarela de tarjeta, encuentra la causa y arréglala

Asegúrate de que el simulador esté en ejecución (`make sim-start`). En una terminal:

```bash
make break-card-gateway
```

La pasarela de tarjeta ahora responde `502 card_gateway_unavailable` después de 1.5 segundos. Los pagos con tarjeta fallan; Pix y Boleto siguen funcionando. Dale un minuto y luego averigua qué pasó **usando solo ClickStack**:

1. En **Search**, sobre **Logs**, busca `card gateway unavailable`. Cuatro servicios lo registraron: `demo-card-gateway`, `demo-payment-card-svc`, `demo-checkout-svc` y `demo-storefront-bff`. El más cercano a la causa es la pasarela: `journey failed role=card-gateway ... status=502 error=card_gateway_unavailable`.
2. Abre una de las líneas y su **Service Map**: la falla termina en `demo-card-gateway`.
3. Filtra **Traces** por errores: los spans que fallan están en la ruta de la tarjeta, y cada uno tarda alrededor de un segundo más que uno normal, porque la pasarela retiene la petición antes de fallar.
4. En la pestaña **Infrastructure** del pod de la pasarela, el pod timeline muestra cómo se detuvo el contenedor anterior al desplegarse el deployment, cuando ejecutaste el comando.
5. Mira el simulador: `make logs S=simulator`, donde `failed` va subiendo.

Ahora arréglalo:

```bash
make fix-card-gateway
```

y observa cómo se detienen los errores.

## Punto de control

```bash
make check-08
```

Trazas de los 15 servicios, trazas del frontend con spans `pg.query`, `clickhouse.query` y `search.products`, reproducciones de sesión grabadas, métricas de Kubernetes de 3 nodos y logs de los servicios demo. (También informa cuántas líneas de log mencionan `card_gateway_unavailable`: ese es el ejercicio.)

## Solución de problemas

| Síntoma | Solución |
|---|---|
| ClickStack no muestra datos | Comprueba que las fuentes apunten a `retail_otel` y a las tablas correctas, y que `make status` muestre `retail_otel.otel_traces` creciendo. |
| El mapa de servicios está vacío o incompleto | Tiene que haber tráfico: `make sim-start`, espera unos minutos. |
| No hay reproducciones de sesión | Vienen de los navegadores del simulador: `make sim-start`. |
| No hay datos en el dashboard de Kubernetes | `kubectl get pods -n observability` debería listar 4 collectors (antes, `export PATH="$PWD/deploy/bin:$PATH"`). |
| `make break-card-gateway` parece no hacer nada | Los pagos con tarjeta solo fallan cuando un comprador paga con tarjeta: cerca de la mitad de los pedidos. Espera un minuto. |

## Para ir más lejos

- Busca en los logs por `deployment` o por las etiquetas del pod: cada pod lleva las etiquetas `service.name` y `deployment`.
- Compara el recuadro Pipeline del dashboard de analítica (módulo 06) con lo que hace el pod de la pasarela en la pestaña Infrastructure.
- Ejecuta el SQL del módulo 08 sobre `retail_otel.otel_traces` para construir tu propia pregunta: los spans `clickhouse.query` más lentos, el `pg.query` más costoso.

**Siguiente:** [módulo 09, ClickHouse Agents](../09-clickhouse-agents/README.md).
