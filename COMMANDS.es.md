# Comandos de ClickShop

**Idioma:** [English](COMMANDS.md) · Español

El [README](README.es.md) enumera los cinco comandos que la mayoría necesita. Esta página tiene todos: qué hace cada uno y qué cambia, los parámetros que aceptan y cómo subir la carga después del taller. `make help` imprime la misma lista, una línea por comando.

Ejecuta cada comando desde la raíz del repositorio. Ninguno imprime un secreto: `make doctor` muestra `.env` enmascarado.

## El camino rápido

1. `make prefetch`: descarga y construye todo, una sola vez, antes del día (unos 5 minutos; necesita internet).
2. `make doctor`: comprueba Docker, `.env` y los dos servicios de Cloud.
3. `make setup`: la primera vez, construye todo e inicia la demo (unos 10 minutos; necesita la clave de API de Cloud).
4. `make start`: trae la demo de vuelta otro día, después de `make stop`, `make down` o de reiniciar la computadora.
5. `make down`: elimina el clúster local cuando termines (tus imágenes de Docker se conservan).

## Subir la carga

`.env.example` hace que todos empiecen con la mitad de la carga para la que se construyó el taller, porque nadie sabe de antemano cuánto aguanta su laptop. Si Docker tiene 8 GB de memoria (`make doctor` dice cuánta tiene), puedes subirla después del taller:

| Ajuste en `.env` | En `.env.example` | Carga completa | Qué es |
|---|---|---|---|
| `SIM_USERS` | 2 | 4 | navegadores, unos 300 MB de memoria cada uno |
| `SIM_ARRIVALS_PER_MINUTE` | 3 | 6 | compradores nuevos por minuto; un navegador atiende unos 1.5 por minuto |
| `PRODUCE_TARGET_EPS` | 100 | 200 | eventos web por segundo, como promedio diario (el pico de la noche es unas tres veces eso) |
| `CC_TARGET_TPS` | 10 | 20 | transacciones con tarjeta por segundo |

Edita `.env` y luego aplícalo:

```bash
make apply-env    # restarts the pods that read .env
make sim-start    # resizes the simulator to SIM_USERS
```

- Súbela de a poco y observa `make status` y `docker stats`. Con todo a carga completa, los contenedores de la laptop usaron unos 3.4 GiB.
- Más compradores necesitan más navegadores: mantén `SIM_ARRIVALS_PER_MINUTE` por debajo de unas 1.5 veces `SIM_USERS`, o el simulador descarta a los compradores que no puede atender (su log dice `SIM_SESSIONS is short`). Cada navegador suma unos 300 MB.
- Los generadores le cuestan a la laptop sobre todo CPU, no memoria.
- Si la computadora empieza a usar swap, o los pods se reinician, vuelve a los valores que funcionaban y ejecuta `make apply-env` de nuevo.
- `make sim-start USERS=6` prueba una cantidad de navegadores por una sola vez, sin cambiar `.env`.
- Un ajuste que quites de `.env` vuelve a la carga completa (4 navegadores, 6 compradores por minuto, 200 eventos y 20 transacciones por segundo), no a los valores de `.env.example`.

Con más compradores, la comprobación del módulo 07 (`make check-07`) pasa antes: necesita unos 20 minutos de compradores con la carga de `.env.example`, y unos 10 con la carga completa.

## Todos los comandos

### Prepararse y comprobar

| Comando | Qué hace |
|---|---|
| `make prefetch` | Descarga y construye todas las imágenes y el chart del collector, para que el clúster se pueda crear sin conexión. Ejecútalo de nuevo cuando quieras: lo que ya está se omite. |
| `make doctor` | Comprueba Docker (memoria, CPUs, disco), el puerto 3000, `.env` (cada valor enmascarado) y los dos servicios de Cloud. |
| `make check-NN` | Comprueba el final del módulo NN (`make check-05`, por ejemplo). El módulo 09 no tiene. |
| `make status` | Los pods, y luego la cantidad de filas y la frescura de cada tabla del taller. |

### Todo de una vez

| Comando | Qué hace |
|---|---|
| `make setup` | Construye lo que los módulos 01 a 08 construyen a mano, en orden, e inicia la carga. Se puede repetir sin problema: lo que ya existe se omite. Necesita la clave de API de Cloud. |

### ClickHouse, Postgres y el ClickPipe

| Comando | Qué hace |
|---|---|
| `make ch-bootstrap` | Crea las bases de datos de ClickHouse y las tablas del clickstream. |
| `make pg-setup` | Crea las tablas de Postgres y carga el catálogo, los clientes, el inventario y los pedidos: `make pg-migrate` y luego `make pg-seed`. |
| `make clickpipes` | Crea el ClickPipe de CDC de Postgres a través de la API de Cloud. |
| `make clickpipes-status`, `make clickpipes-wait` | El estado del pipe; esperar hasta que ClickHouse tenga lo que tiene Postgres. |
| `make ch-search` | Construye la búsqueda de productos: `products_search`, su índice de texto y la vista refrescable que la llena. |
| `make ch-mvs` | Crea los rollups en tiempo real y los llena con lo que ya hay. |
| `make backfill` | Carga 30 días de historial (5 millones de eventos, unos 2 minutos). Se omite cuando el historial ya está. |
| `make clickstack-setup`, `make clickstack-list` | Crea las fuentes de ClickStack a través de la API de Cloud; las lista. |
| `make cloud-ids` | Imprime los ids de tu organización y de tu servicio (módulo 09). |
| `make notebook` | Abre JupyterLab con el notebook que muestra la solicitud del ClickPipe. |

### El clúster local

| Comando | Qué hace |
|---|---|
| `make up` | Inicia el clúster y la aplicación (`make cluster images secrets app`). Con un clúster detenido, lo vuelve a iniciar tal como estaba. |
| `make start` | `make up` y luego `make traffic-start`. |
| `make stop` | Detiene el clúster y lo conserva: la aplicación, sus imágenes y su configuración. |
| `make down` | Elimina el clúster y todo lo que tiene dentro. Tus imágenes de Docker y los datos en Cloud se conservan. |
| `make apply-env` | Después de editar `.env`: actualiza el Secret del clúster y reinicia los pods que lo leen. |
| `make cluster`, `make images`, `make secrets`, `make app`, `make otel-k8s` | Los pasos de `make up`, uno por uno, como los enseña el módulo 05. |

### La carga

| Comando | Qué hace |
|---|---|
| `make traffic-start`, `make traffic-stop` | Inicia o detiene juntos los generadores y los compradores. |
| `make generators-start`, `make generators-stop` | Los eventos web y las transacciones con tarjeta en vivo. |
| `make sim-start`, `make sim-stop` | Los compradores del navegador. |

### Mirar por dentro

| Comando | Qué hace |
|---|---|
| `make logs S=<service>` | Sigue los logs de un servicio (`S=frontend`, `S=simulator`, o un Job: `S=backfill`). |
| `make ch-query Q="SELECT 1"`, `make pg-query Q="SELECT 1"` | Ejecuta SQL sin un prompt. `FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2` ejecuta la consulta de ejemplo número 2 de ese archivo. |
| `make ch-client`, `make psql` | Un prompt de SQL en ClickHouse, en Postgres. |

### Ejercicios y reinicios: lee antes de ejecutarlos

| Comando | Qué hace |
|---|---|
| `make break-card-gateway`, `make fix-card-gateway` | El ejercicio del módulo 08: los pagos con tarjeta fallan y luego vuelven a funcionar. Arréglalo antes de seguir. |
| `make nuke-data` | Devuelve los pedidos y el inventario a los datos iniciales y deja que el ClickPipe los copie de nuevo; los eventos y la telemetría se conservan. Te pide escribir una palabra, y detiene a los compradores: después ejecuta `make clickpipes-wait` y luego `make sim-start`. |
| `make pg-reset` | Vacía Postgres y lo vuelve a cargar, pero no la copia de ClickHouse: casi siempre lo que quieres es `make nuke-data`. Te pide escribir una palabra. |
| `make backfill FORCE=1` | Carga el historial por segunda vez, así que cada sesión pasada cuenta dos veces. |
| `make clickpipes-delete` | Elimina el ClickPipe. El módulo 10 dice cuándo. |

### Para quienes modifican el taller

| Comando | Qué hace |
|---|---|
| `make test` | Las pruebas unitarias de Python. |
| `make check-env-contract` | Comprueba que cada variable de entorno que lee el código esté definida en `.env.example`, en el chart o en una imagen. |
| `make images-webp` | Regenera las imágenes de productos de la tienda a partir de las fotos originales (necesita Pillow). |
| `make dev-frontend` | Ejecuta la tienda con npm en esta computadora, leyendo `.env` (necesita Node). |
| `make tools-image` | Construye la imagen de herramientas (Python y `psql`); los comandos que la necesitan la construyen solos. |

## Parámetros

| Parámetro | Lo usan | Qué hace |
|---|---|---|
| `USERS=n` | `make sim-start`, `make traffic-start`, `make start`, `make setup` | Los navegadores solo para esta ejecución, en lugar de `SIM_USERS` en `.env`. |
| `SKIP="backfill simulator"` | `make setup` | Omite esos pasos (los nombres de los pasos están en `scripts/setup.sh`). |
| `SETUP_DRY_RUN=1` | `make setup` | Imprime el plan y no ejecuta nada. |
| `FORCE=1` | `make backfill` | Carga el historial aunque ya esté. |
| `CONFIRM=yes` | `make pg-reset` | Omite la confirmación escrita. |
| `Q`, `FILE`, `N` | `make ch-query`, `make pg-query` | El SQL que se ejecuta, o un archivo de ejemplos y el número de una consulta dentro de él. |
| `S`, `TAIL` | `make logs` | El servicio, y cuántas líneas anteriores se muestran primero. |
