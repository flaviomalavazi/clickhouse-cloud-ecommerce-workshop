# Módulo 05: Ejecutar la aplicación

**Objetivo:** ejecutar la tienda ClickShop y sus servicios en un clúster local de Kubernetes, hacer un pedido y seguirlo hasta ClickHouse.

**Tiempo:** unos 25 minutos. Iniciar todo toma unos 2 minutos: `make cluster` 33 s, `make images` 51 s, `make secrets` 3 s y `make app` 24 s.

**Aprenderás:**
- qué se ejecuta dónde: la aplicación en tu computadora, los datos y la búsqueda en la nube;
- cómo una escritura en Postgres se hace visible en ClickHouse y en la búsqueda, y cuánto tarda;
- cómo explorar un clúster de Kubernetes.

## Antes de empezar

`make check-04` pasa (módulo 04).

## Pasos

### 1. Inicia el clúster y la aplicación

```bash
make up
```

`make up` ejecuta cuatro comandos, uno tras otro (escritos completos: `make cluster images secrets app`). Qué hace cada uno:

| Comando | Qué hace |
|---|---|
| `make cluster` | Crea un clúster k3d llamado `clickshop`: un servidor y dos agentes (tres contenedores de Docker que actúan como nodos de Kubernetes), con el puerto **3000** de tu computadora mapeado al ingress del clúster. |
| `make images` | Carga en los tres nodos las imágenes que construiste en el módulo 00 (y las dos de terceros que ejecuta el chart). Solo se vuelve a cargar lo que cambió. |
| `make secrets` | Pone tu `.env` en el clúster como un Secret, y tu certificado de Postgres como otro. |
| `make app` | Instala el chart de la aplicación en el namespace `clickshop`, y los dos OpenTelemetry collectors en `observability`, y luego espera hasta que los pods estén listos. |

Termina con `ClickShop is running: http://localhost:3000`.

```bash
make check-05
```

### 2. Usa la tienda

Abre <http://localhost:3000>. La página sigue el idioma de tu navegador (inglés, portugués o español) y la búsqueda funciona en los tres.

1. Escribe `running shoes` en el cuadro de búsqueda. Estos resultados vienen de la tabla `products_search` que construiste en el módulo 04, a través del índice de texto completo de ClickHouse.
2. Abre un producto. Fíjate en su inventario y en su nombre; estás a punto de comprar uno.
3. Haz clic en **Add to Cart**, luego abre el carrito y haz clic en **Proceed to checkout**.
4. Escribe un nombre y un correo electrónico (no se cobra nada), elige **Pix** y haz clic en **Continue to payment**. En la siguiente pantalla haz clic en **I have completed the payment**.

Llegas a la página de confirmación con tu **número de pedido**.

### 3. Sigue el pedido hasta ClickHouse

La tienda escribió el pedido en **Postgres**: una fila de `orders`, sus `order_items` y una unidad menos en `stock`, todo en una sola transacción. Ahora búscalo en ClickHouse. Llega después de la siguiente sincronización del ClickPipe, así que dale hasta un minuto. Búscalo por el número de pedido de tu página de confirmación (reemplaza `ORDER_NUMBER`; si ejecutaste `make setup`, los compradores simulados también están haciendo pedidos, así que el tuyo es uno entre muchos). En la consola SQL, o con `make ch-query Q="..."`:

```sql
SELECT id, status, payment_method, total_amount, created_at
FROM retail_oltp.orders FINAL
WHERE id = ORDER_NUMBER AND _peerdb_is_deleted = 0;
```

Tu pedido está ahí, con el estado `confirmed`. (Se insertó como `pending` y se confirmó unos dos segundos después; el ClickPipe entregó ambos cambios juntos, así que ClickHouse solo tiene el final. El módulo 03 te mostró las versiones con un pedido hecho a mano.) La consulta 2 del archivo de ejemplo muestra lo que había en los pedidos más recientes (`make ch-query FILE=sql/clickhouse/examples/05_run_the_app.sql N=2`).

### 4. Sigue el inventario hasta la búsqueda

Compara el inventario que tiene la réplica con el que muestra la búsqueda, para los productos de tu pedido (la consulta 3 del archivo de ejemplo lo hace para cualquier producto):

```sql
SELECT s.product_id, s.quantity AS stock_in_replica, ps.stock_quantity AS stock_in_search,
       s.quantity != ps.stock_quantity AS stale
FROM retail_oltp.stock AS s FINAL
INNER JOIN retail_analytics.products_search AS ps ON ps.product_id = s.product_id
WHERE s._peerdb_is_deleted = 0
  AND s.product_id IN (SELECT product_id FROM retail_oltp.order_items FINAL WHERE order_id = ORDER_NUMBER AND _peerdb_is_deleted = 0);
```

Durante un rato tus productos muestran `stale = 1`: la réplica tiene el inventario nuevo y la búsqueda no, hasta que se ejecuta la vista materializada actualizable, como máximo cinco minutos después. Para saltarte la espera:

```sql
SYSTEM REFRESH VIEW retail_analytics.products_search_refresh;
SYSTEM WAIT VIEW retail_analytics.products_search_refresh;
```

Ejecuta la consulta de nuevo: `stale` es 0, y al recargar la página del producto en la tienda se ve el inventario nuevo. Todo el camino, **Postgres, ClickPipe, `retail_oltp`, vista materializada actualizable, `products_search`, tienda**, tarda el intervalo de sincronización (un minuto como máximo) más hasta cinco minutos, o solo el intervalo de sincronización si actualizas la vista por tu cuenta.

### 5. Explora el clúster

No instalaste `kubectl`; el repositorio incluye un wrapper. Agrégalo a tu path en esta terminal:

```bash
export PATH="$PWD/deploy/bin:$PATH"
kubectl get nodes
kubectl get pods -n clickshop -o wide
kubectl get svc,ingress -n clickshop
kubectl get pods -n observability
helm list -A
```

Verás los tres nodos, 18 pods en `clickshop` (21 mientras se ejecutan los generadores y los compradores), y en `observability` un OpenTelemetry collector por nodo más uno para todo el clúster. Qué son los pods:

| Pod | Qué es |
|---|---|
| `frontend` | La tienda en Next.js. Lee y escribe en Postgres, y lee de ClickHouse para la búsqueda y el dashboard de analítica. |
| `storefront-bff`, `catalog-svc`, `checkout-svc`, `pricing-svc`, `inventory-svc`, `payment-card-svc`, `payment-pix-svc`, `payment-boleto-svc`, `card-gateway`, `pix-psp-gateway`, `boleto-gateway`, `order-svc`, `ledger-svc`, `email-gateway` | Un pequeño grafo de microservicios al que llama el proceso de pago, para que las trazas del módulo 08 tengan algo que mostrar. No guardan datos. |
| `snowplow-micro`, `snowplow-bridge` | Los eventos de comportamiento de la tienda van a Snowplow Micro; el bridge los lee y los inserta en ClickHouse. |
| `otel-gateway` | El collector de ClickStack: todo lo observable llega aquí y luego a ClickHouse (`retail_otel`). |

```bash
make status          # the pods, then row counts and freshness of every table, in both databases
make logs S=frontend # follow a service's logs (Ctrl+C to stop)
```

## Punto de control

```bash
make check-05
```

Todos los pods están listos, la tienda responde en el puerto 3000, el catálogo se carga desde Postgres, la búsqueda encuentra `jeans` a través de ClickHouse y Snowplow Micro responde.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `make cluster` dice que el puerto 3000 está en uso | Detén lo que lo esté usando, luego ejecuta `make down` y `make up` de nuevo. |
| Los pods se quedan en `ImagePullBackOff` | Las imágenes no se cargaron: ejecuta `make images`. |
| `make app` agota el tiempo de espera | `make status` muestra qué pods no están listos, y `make logs S=<pod name>` por qué. Un frontend que no puede conectarse a Postgres o a ClickHouse es la causa habitual: `make doctor`. |
| La tienda muestra una página de error | `make logs S=frontend`. |
| La búsqueda no encuentra nada | `products_search` está vacía: módulo 04, `SYSTEM REFRESH VIEW`. |
| Tu pedido no está en ClickHouse después de dos minutos | El ClickPipe va retrasado o está detenido: mira su página en la consola. |
| Cambiaste `.env` | `make apply-env` actualiza el Secret y reinicia los pods que lo leen. |
| Los pods son desalojados, o Docker va lento | El disco de Docker está casi lleno: `docker system df`, y deja 10 GB libres. |

## Para ir más lejos

- `make logs S=otel-gateway` muestra al collector exportando a ClickHouse.
- Todo lo que despliega el chart está en `deploy/helm/clickshop/`; `values.yaml` lista los servicios, su latencia y su memoria.
- `make stop` detiene el clúster y lo conserva, para hacer una pausa hasta otro día: `make up` lo trae de vuelta tal como estaba (también la carga, si estaba en marcha).
- `make down` elimina el clúster cuando quieras recuperar tu computadora. No se toca nada en la nube, y `make up` lo trae de vuelta en dos minutos (`make start` trae de vuelta también los generadores y los compradores).

**Siguiente:** [módulo 06, Analítica en tiempo real](../06-real-time-analytics/README.md).
