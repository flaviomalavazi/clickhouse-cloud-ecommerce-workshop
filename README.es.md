# ClickShop: de cero a una aplicación en tiempo real en ClickHouse Cloud

**Idioma:** Español · [English](README.md)

Un taller práctico. Empiezas con una cuenta de ClickHouse Cloud vacía y terminas con una tienda en línea cuyos pedidos, búsquedas, clics y trazas viven todos en ClickHouse, y con una idea clara de para qué sirve cada parte.

Vas a:

1. crear un servicio de **ClickHouse Cloud** y una instancia de **ClickHouse Managed Postgres**;
2. cargar el catálogo de ClickShop en Postgres (el almacén transaccional) y **replicarlo en ClickHouse** con un ClickPipe de CDC de Postgres;
3. construir la búsqueda de productos con la **búsqueda de texto completo** de ClickHouse;
4. ejecutar la tienda, sus microservicios, Snowplow y un collector de OpenTelemetry en un **clúster local de Kubernetes**;
5. transmitir **clickstream y transacciones con tarjeta** sintéticos directamente a ClickHouse y ver un dashboard de analítica en tiempo real;
6. dejar que **compradores controlados por un navegador** hagan pedidos reales que modifican Postgres y fluyen hacia ClickHouse;
7. observar todo el sistema en **ClickStack**: trazas y el mapa de servicios, logs con búsqueda de texto completo, reproducciones de sesión e infraestructura de Kubernetes;
8. explorar los datos con **ClickHouse Agents** y, si quieres, ver qué hace el agente con **Langfuse Cloud** (un paso final opcional, [en el módulo 09](workshop/es/09-clickhouse-agents/langfuse.md)).

## Qué vas a construir

```text
 Your laptop (Docker Desktop / OrbStack / Colima)
 └── k3d cluster "clickshop"  (1 server + 2 agents)
     ├── namespace clickshop
     │   ├── frontend (Next.js) ── Postgres   (orders, catalogue, stock)             ┐
     │   │      │  ├─ ClickHouse   (search, the analytics dashboard)                 │
     │   │      │  ├─ /api/snowplow → snowplow-micro ← snowplow-bridge → ClickHouse  │
     │   │      │  ├─ /api/otlp (browser telemetry and replays) → otel-gateway       │
     │   │      │  └─ storefront-bff → catalog-svc, checkout-svc → pricing, inventory,
     │   │      │       payment-card-svc → card-gateway, payment-pix-svc → pix-psp-gateway,
     │   │      │       payment-boleto-svc → boleto-gateway, order-svc → ledger, email
     │   ├── web-events producer, card producer ──(batched INSERT)──→ ClickHouse
     │   ├── browser simulator (Playwright) ──HTTP──→ frontend
     │   └── otel-gateway (the ClickStack collector) ──→ ClickHouse (retail_otel)
     └── namespace observability
         ├── otel-node    (DaemonSet: kubelet metrics, container logs, host metrics)  → otel-gateway
         └── otel-cluster (Deployment: cluster metrics, Kubernetes events)            → otel-gateway

 ClickHouse Cloud
 ├── ClickHouse service   retail_analytics (clickstream, card transactions, rollups, products_search)
 │                        retail_oltp      (where the ClickPipe writes)
 │                        retail_otel      (ClickStack's tables)
 ├── Managed Postgres     database clickshop
 ├── ClickPipe            Postgres CDC  clickshop.public.*  →  retail_oltp.*
 ├── ClickStack           the UI over retail_otel
 └── ClickHouse Agents    over the service
```

La historia que cuenta el taller:

- El **clickstream de alto volumen** va directo a ClickHouse, desde los generadores (inserciones grandes por lotes) y desde Snowplow a través de un pequeño puente.
- Las **transacciones** viven en Postgres. El ClickPipe de CDC las trae a ClickHouse en pocos segundos.
- ClickHouse **cruza ambos** para la analítica y da soporte a la **búsqueda** a partir del catálogo replicado.
- **ClickStack** observa todo el sistema sobre el mismo motor.

El panorama completo (los cuatro caminos de los datos, el proceso de pago, qué tan actualizado está cada elemento) está en [docs/architecture.md](docs/architecture.md).

## Dos formas de seguirlo

**La forma de una hora.** Crea los dos servicios de Cloud y una clave de API, completa `.env` ([módulo 01](workshop/es/01-cloud-services/README.md)) y ejecuta **`make setup`**. Construye todo lo que los módulos 01 a 08 construyen a mano (el ClickPipe y las fuentes de ClickStack a través de la API de Cloud, la búsqueda, los rollups en tiempo real, el clúster local y la aplicación, 30 días de historial, los generadores en vivo y los compradores del navegador) en unos diez minutos (una vez que `make prefetch` del módulo 00 haya construido las imágenes), así que la hora se va en leer los módulos, mirar lo que se construyó y explorarlo en ClickHouse Cloud.

**La forma lenta.** Sigue los módulos en orden. Cada uno describe los mismos pasos a mano, termina con una comprobación (`make check-NN`; el módulo 09 se hace en la consola, así que no tiene ninguna) y deja el sistema funcionando. El módulo 02 es opcional.

También puedes combinarlas: `make setup` se puede ejecutar con seguridad en cualquier momento, omite lo que ya está hecho, y cada pieza tiene su propio comando (`make clickpipes`, `make ch-search`, `make ch-mvs`, `make clickstack-setup`, ...).

Después de `make setup` todo ya está en marcha, así que cada módulo se convierte en un recorrido: su comprobación pasa desde el inicio y los pasos que crean cosas no cambian nada. Ten en cuenta que `make setup` deja los generadores y los compradores en ejecución: escriben unos 200 eventos y 20 transacciones con tarjeta por segundo en tu servicio de ClickHouse hasta que ejecutes `make traffic-stop`.

## Modo humano y modo agente

Puedes leer los módulos por tu cuenta (**modo humano**: este README y `workshop/`) o dejar que un agente de programación te guíe (**modo agente**): Claude Code, Codex, Cursor, Copilot u otro que lea `AGENTS.md`. Abre el repositorio (su carpeta raíz) en tu agente y dile *"inicia el taller"* (en Claude Code, `/workshop`). Lee [`AGENTS.md`](AGENTS.md) y los playbooks de [`agent-mode/`](agent-mode/README.md), empieza por la forma de una hora (díselo si prefieres ir paso a paso), ejecuta los comandos, explica cada uno y se detiene donde solo tú puedes actuar: la consola de Cloud y el navegador. Tú no escribes código y nunca pegas un secreto en el chat: editas `.env` tú mismo.

Los dos modos son textos separados que comparten los mismos comandos (los targets de `make` y `make check-NN`), así que ambos terminan en el mismo lugar.

## Los módulos

Los tiempos son para una primera ejecución a mano, incluida la espera.

| | Módulo | Aprendes | Tiempo |
|---|---|---|---|
| 00 | [Prerrequisitos](workshop/es/00-prerequisites/README.md) | Lo que necesita el taller; descarga todo **antes del día del taller** | 15 min + descarga |
| 01 | [Servicios en la nube](workshop/es/01-cloud-services/README.md) | Crear los servicios de ClickHouse y Postgres; el `.env` único; cargar Postgres | 20 min |
| 02 | [Postgres transaccional](workshop/es/02-postgres-oltp/README.md) *(opcional)* | Recorrer los datos transaccionales; por qué viven en Postgres | 10 min |
| 03 | [CDC con ClickPipes](workshop/es/03-cdc-clickpipe/README.md) | Replicar Postgres en ClickHouse; `ReplacingMergeTree` y `FINAL` | 25 min |
| 04 | [Búsqueda de texto completo](workshop/es/04-full-text-search/README.md) | El índice `text`, vistas materializadas actualizables | 20 min |
| 05 | [Ejecutar la aplicación](workshop/es/05-run-the-app/README.md) | La tienda en k3d; seguir un pedido hasta ClickHouse | 25 min |
| 06 | [Analítica en tiempo real](workshop/es/06-real-time-analytics/README.md) | Vistas materializadas incrementales; por qué lotes grandes | 30 min |
| 07 | [Compradores simulados](workshop/es/07-simulated-shoppers/README.md) | Pedidos desde navegadores; cruzar Postgres y el clickstream | 30 min |
| 08 | [Observabilidad con ClickStack](workshop/es/08-observability-clickstack/README.md) | Trazas, logs, reproducciones de sesión, infraestructura; romper y arreglar | 40 min |
| 09 | [ClickHouse Agents](workshop/es/09-clickhouse-agents/README.md) | Crear un agente, hacerle preguntas a los datos en lenguaje natural, comprobar sus respuestas *(borrador: se está verificando en la consola)* | 25 min |
| 10 | [Limpieza](workshop/es/10-cleanup/README.md) | Eliminar todo, en el orden correcto | 10 min |

Unas cuatro horas a mano, y una hora con `make setup`. Si vas a dar este taller a un grupo, pide a todos que terminen el módulo 00 de antemano y lee la [guía del facilitador](workshop/FACILITATOR.md).

## Palabras que encontrarás

| Palabra | Qué es aquí |
|---|---|
| **Servicio de ClickHouse Cloud** | La base de datos ClickHouse administrada que creas en el módulo 01. |
| **Managed Postgres** | El PostgreSQL administrado de ClickHouse Cloud. Los pedidos y el catálogo de la tienda viven allí. |
| **ClickPipe** | Un trabajo de ingesta administrado. Aquí copia cada cambio de Postgres en ClickHouse. |
| **CDC** (captura de cambios de datos) | Leer el write-ahead log de la base de datos para copiar cada cambio a medida que ocurre, sin triggers y sin código de aplicación. |
| **ReplacingMergeTree, `FINAL`** | Una tabla que guarda todas las versiones de una fila y elimina las antiguas más tarde. `FINAL` lee solo la última versión. |
| **Índice de texto** | El índice de texto completo de ClickHouse; `hasAllTokens` y `hasAnyTokens` buscan con él. |
| **Vista materializada** | Una consulta que se ejecuta en cada inserción y guarda su resultado en otra tabla. Una *actualizable* se vuelve a ejecutar según una programación. |
| **Snowplow** | El rastreador de comportamiento de código abierto que usa la tienda. Snowplow Micro es su collector pequeño, e Iglu es donde obtiene los esquemas de sus eventos. |
| **OpenTelemetry** | El estándar para trazas, logs y métricas. Un collector los envía a ClickHouse. |
| **ClickStack** | El producto de observabilidad de ClickHouse: las pantallas sobre esas trazas, logs, métricas y reproducciones de sesión. |
| **k3d** | Kubernetes ejecutándose dentro de contenedores de Docker, así que tu laptop no necesita nada más instalado. |
| **ClickHouse Agents** | Los agentes conversacionales de ClickHouse Cloud (Beta) que responden preguntas sobre tus datos. |

## Qué necesitas

- Una laptop con **Docker** (Docker Desktop, OrbStack o Colima) con **8 GB de memoria y 4 CPUs** asignados (4 GB de memoria como mínimo, con menos carga), unos **10 GB de disco libre**, y `make` y `git`. No se instala nada más: `k3d`, `kubectl` y `helm` se ejecutan desde contenedores.
- Una cuenta de **ClickHouse Cloud** en la que puedas crear un servicio y una instancia de Managed Postgres y, para `make setup`, una **clave de API** con el rol Admin.
- Una conexión a internet.

Probado en macOS (Apple silicon) con OrbStack.

## Comandos

Ejecuta `make help` para ver la lista completa. Los que usarás:

| | |
|---|---|
| `make prefetch` | descargar y construir todo (módulo 00) |
| `make doctor` | comprobar Docker, `.env` (se muestra enmascarado) y ambas bases de datos |
| `make setup` | **todo de una vez** (necesita la clave de API): ClickPipe, búsqueda, rollups, clúster, fuentes de ClickStack, historial y carga |
| `make ch-bootstrap`, `make pg-setup`, `make ch-search`, `make ch-mvs` | crear las bases de datos y las tablas, configurar Postgres (`pg-migrate` y luego `pg-seed`), construir la búsqueda, crear los rollups |
| `make clickpipes`, `make clickpipes-status`, `make clickstack-setup`, `make notebook` | el ClickPipe y las fuentes de ClickStack a través de la API de Cloud; el notebook que muestra la petición del ClickPipe |
| `make psql`, `make ch-client` | una consola de SQL en Postgres, en ClickHouse |
| `make ch-query Q="SELECT 1"`, `make pg-query Q="SELECT 1"` | ejecutar SQL sin consola interactiva (lo que usa un agente); `FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2` ejecuta una consulta de ejemplo numerada |
| `make up` | iniciar el clúster local y la aplicación de una sola vez (módulo 05; ejecuta `make cluster images secrets app`) |
| `make traffic-start` | iniciar juntos los generadores en vivo y los compradores del navegador (`SIM_USERS` en `.env` define cuántos) |
| `make start` | todo lo anterior: `make up` y luego `make traffic-start` |
| `make backfill`, `make generators-start`, `make sim-start` | llenar ClickHouse; iniciar los generadores en vivo; iniciar los compradores del navegador, cada uno por separado |
| `make generators-stop`, `make sim-stop`, `make traffic-stop` | detener los generadores, los compradores o ambos |
| `make break-card-gateway`, `make fix-card-gateway` | el ejercicio del módulo 08 |
| `make status`, `make logs S=<service>` | los pods y la frescura de cada tabla; seguir los logs de un servicio |
| `make check-NN` | comprobar el final del módulo NN |
| `make apply-env` | después de cambiar `.env`: actualizar el clúster |
| `make nuke-data` | devolver los pedidos y el inventario a los datos iniciales (los eventos y la telemetría se conservan) |
| `make down` | eliminar el clúster local |

## Un solo archivo de configuración

Todo se configura en **`.env`**, en la raíz del repositorio. Lo creas a partir de `.env.example` en el módulo 01 y nunca editas otro archivo para configurar el taller. Git lo ignora. `make doctor` lo comprueba y muestra cada valor enmascarado.

## Dónde está cada cosa

```text
workshop/en/              the modules in English (human mode: this is what you follow)
workshop/es/              the same modules in Spanish
workshop/FACILITATOR.md   the facilitator guide (English only)
AGENTS.md, agent-mode/    agent mode: the rulebook and one playbook per module
Makefile                  every command
.env.example              the one configuration template
sql/                      Postgres schema, ClickHouse tables, and example queries for the modules
frontend/                 the storefront (Next.js)
services/demo-service/    the 14 microservices of the checkout path (one image, one role each)
snowplow-bridge/          Snowplow Micro to ClickHouse
otel-collector/           the ClickStack collector image
data-generators/          the generators and the simulator (see its README)
deploy/                   the k3d cluster, the Helm charts, the tool wrappers
tools/                    the database tasks (seed, SQL runner, checks)
scripts/                  doctor, and the module checks in scripts/checks/
docs/architecture.md      the deeper dive: data paths, the checkout, observability, the local platform
docs/data-dictionary.md   every table and column, the join keys and the rules for querying them
docs/decisions.md         why things are the way they are
```

## Solución de problemas

Cada módulo tiene su propia tabla. Los sospechosos habituales:

- `make doctor` falla: dice con palabras qué hay que corregir en `.env` o a qué servicio no logra llegar.
- Los pods están en `Pending` o son desalojados, o las construcciones fallan con "no space left": el disco de Docker está lleno. Mantén 10 GB libres (`docker system df`).
- Algo responde muy lento o se agota el tiempo de espera: a los servicios de Cloud se llega por internet; `make doctor` muestra si responden.
- Cambiaste `.env` y no pasó nada: `make apply-env`.

`docs/decisions.md` registra cada decisión y lo que se midió mientras se construía el taller.
