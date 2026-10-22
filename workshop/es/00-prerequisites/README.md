# Módulo 00: Prerrequisitos

**Objetivo:** prepara tu computadora y descarga todo una sola vez, **antes del día del taller**.

**Tiempo:** unos 15 minutos de tu propio tiempo. La mayor parte es `make prefetch` descargando y construyendo: 4 min 23 s desde cero con una conexión rápida, y más con el wifi de una conferencia, por eso lo haces con anticipación.

**Aprenderás:** cómo se ejecuta el taller en tu laptop. La aplicación, los generadores y el simulador se ejecutan en un pequeño clúster de Kubernetes (k3d) sobre Docker; la base de datos, la búsqueda y la observabilidad se ejecutan en ClickHouse Cloud.

## Antes de empezar

- Una laptop con 8 GB de memoria y 4 CPUs disponibles para Docker, y unos 10 GB de disco libre (15 GB es cómodo: `make doctor` considera que menos que eso es justo).
- Una cuenta de ClickHouse Cloud en la que puedas crear un servicio y una instancia de Managed Postgres.
- Un navegador y una conexión a internet.

Probado en macOS (Apple silicon) con OrbStack. Docker Desktop y Colima funcionan igual, y Linux también debería. En Windows usa WSL2 (no probado).

## Pasos

1. **Instala un motor de Docker** (Docker Desktop, OrbStack o Colima) y asígnale **8 GB de memoria y 4 CPUs**. En Docker Desktop eso está en *Settings, Resources*. Inícialo.

2. **Instala `make` y `git`.** En macOS, `xcode-select --install` instala ambos.

   Eso es todo lo que instalas. `k3d`, `kubectl` y `helm` se ejecutan desde imágenes de contenedor con versión fija mediante pequeños wrappers en `deploy/bin/`, así que no hay nada que instalar y tu propio `~/.kube/config` nunca se lee ni se modifica. (Para usarlos como comandos normales, ejecuta `export PATH="$PWD/deploy/bin:$PATH"` en el repositorio.)

3. **Clona el repositorio** y entra en él:

   ```bash
   git clone https://github.com/flaviomalavazi/clickhouse-cloud-ecommerce-workshop.git
   cd clickhouse-cloud-ecommerce-workshop
   ```

4. **Descarga y construye todo:**

   ```bash
   make prefetch
   ```

   Obtiene las imágenes de las herramientas y la imagen del nodo de Kubernetes, construye la imagen de herramientas (Python y `psql`, para las tareas de base de datos) y las seis imágenes del taller (tienda, servicios de demostración, puente de Snowplow, gateway de OpenTelemetry, generadores, simulador), obtiene Snowplow Micro y el collector de OpenTelemetry y descarga el chart de Helm del collector. Necesita internet **una sola vez**. Ejecútalo de nuevo cuando quieras; lo que ya está se omite.

5. **Comprueba:**

   ```bash
   make check-00
   ```

## Punto de control

`make check-00` imprime un ✓ por cada uno de estos puntos: Docker en ejecución, 8 GB y 4 CPUs, 10 GB de disco libre, la imagen de herramientas construida, las imágenes de las herramientas descargadas, las seis imágenes del taller construidas, el chart del collector descargado y el puerto 3000 libre. Termina con `All checks passed`.

El taller también necesita internet mientras se ejecuta: Snowplow Micro obtiene los esquemas de eventos desde Iglu Central, y los servicios de Cloud están, por supuesto, en la nube.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `the Docker daemon is not running` | Inicia Docker Desktop u OrbStack, espera a que indique que está en ejecución y vuelve a ejecutar la comprobación. |
| `Docker has less than 8 GB of memory` | Auméntala en la configuración de Docker y reinicia Docker. |
| `port 3000 is in use` | Algo en tu computadora lo está usando (a menudo un `npm run dev` local). Deténlo; la tienda necesita el 3000. |
| `make: command not found` | `xcode-select --install` en macOS, o `apt install make` en Debian y Ubuntu. |
| Una descarga o una construcción falla a medias | Ejecuta `make prefetch` de nuevo; las imágenes terminadas se conservan. |
| Los pods son desalojados más tarde, o las construcciones fallan con "no space left" | El disco de Docker está lleno. `docker system df` muestra qué ocupa el espacio y `docker builder prune` libera la caché de construcción. Cada uno de los tres nodos del clúster guarda una copia de las imágenes, así que mantén 10 GB libres. |
| `docker: command not found` o no logra conectarse | Docker no está instalado, no está en ejecución o tu shell no apunta a él (`docker context ls`). |

## Para ir más lejos

- Revisa `deploy/versions.env`: ahí están fijadas todas las versiones de las herramientas que usa el taller.
- `deploy/k3d/cluster.yaml` es la definición completa del clúster: un server, dos agents, el puerto 3000 mapeado al balanceador de carga.

**Siguiente:** [módulo 01, Servicios en la nube](../01-cloud-services/README.md).
