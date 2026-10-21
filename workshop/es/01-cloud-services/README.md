# Módulo 01: Servicios en la nube

**Objetivo:** crear los dos servicios sobre los que corre el taller, un servicio de ClickHouse Cloud y una instancia de ClickHouse Managed Postgres, poner sus credenciales en el único archivo que lee todo el taller, y cargar los datos de Postgres que usa el resto del taller.

**Tiempo:** unos 20 minutos, la mayor parte esperando a que los servicios inicien. `make doctor` tarda 6 s, `make ch-bootstrap` 3 s y `make pg-setup` 13 s.

**Aprenderás:**
- la diferencia entre el servicio analítico (ClickHouse) y el transaccional (Postgres), y por qué viven en **la misma región**;
- el endpoint directo de Postgres y el pooler de conexiones, y por qué el ClickPipe necesita el directo;
- lo que te cuesta abrir una instancia a internet, y cómo verificar el certificado de un servidor;
- la única regla del taller para la configuración: **todo está en `.env`**.

## Antes de empezar

`make check-00` pasa (módulo 00), y tienes una cuenta de ClickHouse Cloud (una organización) donde puedes crear un servicio y una instancia de Managed Postgres. Ambos se facturan mientras existan: el [módulo 10](../10-cleanup/README.md) los elimina.

## La forma rápida: el taller de una hora

Si tienes alrededor de una hora, haz los pasos de abajo hasta el **7** (los servicios, el acceso, una clave de API y `.env`), y luego ejecuta:

```bash
make setup
```

Hace por ti el resto de los módulos 01 a 08, en el orden correcto: las bases de datos de ClickHouse, las migraciones de Postgres, el **ClickPipe** (a través de la API de Cloud), los datos de Postgres, la búsqueda de productos, los rollups en tiempo real, el clúster local y la aplicación, las **fuentes de ClickStack** (a través de la API), 30 días de historial, los generadores en vivo y los compradores simulados. Tarda unos diez minutos una vez construidas las imágenes (`make prefetch`, módulo 00) y muestra lo que está haciendo, así que la hora se dedica a leer y explorar, no a preparar el entorno. Cada paso se puede repetir sin problema: si uno falla, corrígelo y ejecuta `make setup` de nuevo. Lo que ya existe se reconoce y se deja intacto: un ClickPipe que hayas creado a mano, las fuentes de ClickStack y los 30 días de historial, que se cargan una sola vez. Después recorre los módulos para ver qué se construyó y por qué, en cualquier orden; cada uno describe los mismos pasos a mano.

Una cosa que hacer antes de ejecutarlo: abre **ClickStack** una vez desde tu servicio de ClickHouse en la consola (eso crea su conexión con tu servicio). Si lo olvidas, `make setup` igualmente construye todo lo demás y al final te indica que abras ClickStack y ejecutes `make clickstack-setup`.

O elige la forma lenta: omite la clave de API (paso 6) y sigue cada módulo en orden.

## Pasos

### 1. Crear el servicio de ClickHouse

En la [consola de ClickHouse Cloud](https://console.clickhouse.cloud), crea un **New service**. Elige un proveedor de nube y una **región**, y anota la región: Postgres debe estar en la misma, para que la replicación no cruce regiones. Ponle el nombre `clickshop`. El taller necesita ClickHouse **26.2 o más reciente** (el índice de texto completo está disponible de forma general desde esa versión); se escribió con la 26.6.

Cuando esté en ejecución, abre la vista **Connect** del servicio. Necesitas el **host** (se ve así: `abc123.us-east-1.aws.clickhouse.cloud`), el usuario `default` y su contraseña. La contraseña se muestra una sola vez al crear el servicio: guárdala.

### 2. Crear la instancia de Managed Postgres

En la misma organización, crea una instancia de **Managed Postgres** en la **misma región**. El taller se escribió con Postgres 18. Un tamaño pequeño es más que suficiente. Ponle el nombre `clickshop-pg`.

### 3. Decidir quién puede acceder

Ambos servicios son accesibles desde internet y están protegidos por una contraseña y TLS. Permite el acceso desde la dirección IP de tu laptop (el ajuste **IP access** de la instancia). El ClickPipe que crearás en el módulo 03 se ejecuta dentro de ClickHouse Cloud: si restringes la instancia por IP, también tienes que permitir las direcciones de ClickPipes de tu región (están listadas en la documentación de ClickHouse).

El riesgo que debes entender: "permitir desde cualquier lugar" es el ajuste fácil para un taller, y significa que cualquiera que conozca la contraseña puede conectarse. Usa una contraseña segura, no reutilices una, y elimina ambos servicios en el [módulo 10](../10-cleanup/README.md).

### 4. Obtener los datos de conexión de Postgres

Abre la instancia y su vista **Connect** en la barra lateral izquierda. Muestra **Username** (`postgres`), **Password**, **Server** (el nombre de host) y **Port** (`5432`).

Usa la conexión **directa**, que es la predeterminada. **No** actives **via PgBouncer**: el pooler es para muchas conexiones de aplicación de corta duración, y la replicación lógica del ClickPipe no funciona a través de él.

### 5. Descargar el certificado CA de Postgres

En la pestaña **Settings** de la instancia, descarga el certificado CA. Guárdalo en este repositorio como `assets/certs/ca-certificate.pem` (la carpeta existe, y los archivos `*.pem` nunca se incluyen en un commit). Con él, cada parte del taller se conecta con `verify-full`: se comprueban tanto la cadena de certificados como el nombre de host, así sabes que estás hablando con tu instancia y no con un intermediario.

### 6. Crear una clave de API de Cloud (solo para la forma rápida)

`make setup`, `make clickpipes` y `make clickstack-setup` crean el ClickPipe y las fuentes de ClickStack llamando a la API de ClickHouse Cloud, que necesita una clave. En la consola, abre la página **API keys** de la organización y crea una clave con el rol **Admin**. Obtienes un **key ID** y un **key secret**; el secreto se muestra una sola vez. Omite este paso si vas a seguir los módulos a mano: entonces creas ambos por tu cuenta en la consola.

### 7. Completar `.env`

```bash
cp -n .env.example .env
```

(`-n` nunca reemplaza un `.env` que ya tengas: tus contraseñas están en él.) Abre `.env` y completa el **bloque obligatorio**:

| Clave | De dónde sale |
|---|---|
| `CLICKHOUSE_HOST` | Servicio de ClickHouse, **Connect**: solo el host, sin `https://` y sin `:8443` |
| `CLICKHOUSE_USER` | `default` |
| `CLICKHOUSE_PASSWORD` | la contraseña del servicio del paso 1 |
| `PGHOST` | Instancia de Postgres, **Connect**, **Server** |
| `PGPORT` | `5432` |
| `PGUSER` | `postgres` |
| `PGPASSWORD` | Instancia de Postgres, **Connect**, **Password** |
| `PGDATABASE` | `clickshop` (el taller la crea) |

Y, como se recomienda, descomenta y completa la línea opcional que apunta al certificado:

```dotenv
PGSSLROOTCERT=assets/certs/ca-certificate.pem
```

Para la forma rápida, descomenta y completa también la clave de API:

```dotenv
CLICKHOUSE_CLOUD_API_KEY_ID=...
CLICKHOUSE_CLOUD_API_KEY_SECRET=...
```

Reglas de este archivo: un `KEY=value` por línea, **sin comillas**, y los comentarios en sus propias líneas. Docker y Kubernetes lo leen exactamente como está escrito. Git lo ignora, y es lo **único** que configuras en todo el taller.

> En producción le darías a cada componente su propio usuario con privilegios mínimos. El taller usa `default` y `postgres` para simplificar.

### 8. Comprobarlo

```bash
make doctor
```

Comprueba Docker, los puertos y `.env` (cada valor se imprime **enmascarado**), y luego se conecta a ambos servicios. Una ejecución correcta termina con:

```text
  ✓ ClickHouse 26.x (needs 26.2+)
  ✓ Postgres 18.x (TLS, wal_level=logical)

All good. Next: make ch-bootstrap, then make pg-setup (module 01), or make setup to do everything at once.
```

### 9. Crear las bases de datos y las tablas de clickstream

```bash
make ch-bootstrap
```

Esto crea tres bases de datos en ClickHouse: `retail_analytics` (clickstream, transacciones con tarjeta, rollups, búsqueda), `retail_oltp` (donde el ClickPipe escribirá en el módulo 03) y `retail_otel` (las tablas de ClickStack), además de las dos tablas de clickstream. Se puede ejecutar de nuevo sin problema.

### 10. Cargar Postgres

```bash
make pg-setup
```

Esto crea la base de datos `clickshop` y sus seis tablas en Postgres y carga los datos que usa el resto del taller: el catálogo (978 productos, 691 de ellos activos), su inventario, 500 clientes y 2,000 pedidos de historial. Tarda 13 segundos y se puede ejecutar de nuevo (`products already seeded`).

Son dos pasos que también puedes ejecutar por separado: `make pg-migrate` crea las tablas y no carga nada, y `make pg-seed` carga los datos. `make setup` los ejecuta con el ClickPipe en medio, para que las filas lleguen a ClickHouse como cambios. El [módulo 02](../02-postgres-oltp/README.md) recorre lo que se cargó; es opcional.

## Punto de control

```bash
make check-01
make check-02
```

Cada línea es un ✓: `.env` completo, ClickHouse responde y es lo bastante reciente, Postgres responde por TLS con `wal_level = logical`, existen las tres bases de datos y las dos tablas, y Postgres contiene el catálogo, los clientes y los pedidos.

## Solución de problemas

`make doctor` dice qué está mal, con palabras. Los casos más comunes:

| Síntoma | Solución |
|---|---|
| `CLICKHOUSE_HOST must be a bare host name` | Quita `https://`, cualquier ruta y `:8443`. |
| `PGPORT is the pooler's port` | Copiaste la conexión de PgBouncer. Usa la directa, en el puerto 5432. |
| `has quotes` / `has a comment after the value` | Quita las comillas; mueve el comentario a su propia línea. |
| `has Windows line endings` | Guarda `.env` con finales de línea LF. |
| `Postgres wal_level is ... the ClickPipe needs 'logical'` | `wal_level = logical` es un ajuste de la instancia de Postgres, no algo que el taller cambie. Comprueba que `PGHOST` sea el nombre de servidor propio de la instancia de Managed Postgres, y avisa a tu facilitador si lo es. |
| `Postgres: could not connect` | Puede que la instancia aún esté iniciando; comprueba que **IP access** permita tu dirección; comprueba el host y la contraseña. |
| `certificate verify failed` | `PGSSLROOTCERT` apunta al archivo equivocado, o `PGHOST` no es el nombre de host propio de la instancia. |
| `PGSSLROOTCERT=... was not found` | La ruta es relativa a la raíz del repositorio: `assets/certs/ca-certificate.pem`. |
| ClickHouse anterior a 26.2 | Crea un servicio nuevo, o actualízalo desde la consola. |
| `Cloud API: ... 401` o `403` | La clave o el secreto son incorrectos, o la clave no tiene el rol Admin. |
| `no service in the organisation has the host ...` | `CLICKHOUSE_HOST` no es un host de los servicios de tu organización, o la clave ve varias organizaciones: configura `CLICKHOUSE_CLOUD_ORGANIZATION_ID`. |

## Para ir más lejos

- `wal_level = logical` es lo que permite a un ClickPipe leer los cambios de Postgres. `make check-01` lo verifica; en la instancia en la que se probó este taller ya estaba configurado.
- Abre `.env.example` y lee el bloque opcional: ahí están los ritmos de los generadores y del simulador, para módulos posteriores.

**Siguiente:** [módulo 02, Postgres transaccional](../02-postgres-oltp/README.md) (opcional), o ve directo al [módulo 03, CDC con ClickPipes](../03-cdc-clickpipe/README.md).
