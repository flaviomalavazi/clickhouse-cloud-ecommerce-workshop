# Módulo 06: Analítica en tiempo real

**Objetivo:** llenar ClickHouse con un mes de historial de clickstream y un flujo en vivo de eventos y transacciones con tarjeta, y observar un dashboard en tiempo real que los lee.

**Tiempo:** unos 30 minutos. `make ch-mvs` tarda 4 s, `make backfill` 1 min 34 s y `make generators-start` 3 s.

**Aprenderás:**
- las **vistas materializadas incrementales** y `AggregatingMergeTree`: preagregar al insertar para que un dashboard lea miles de filas, no millones;
- **por qué importan los lotes grandes** para ClickHouse, y cómo los escriben los generadores;
- SQL analítico sobre un clickstream: rollups, un embudo de compra, búsquedas que no encontraron nada, comprobaciones de anomalías.

## Antes de empezar

`make check-05` pasa (módulo 05), y el clúster está en ejecución.

## Pasos

### 1. Crea los rollups

```bash
make ch-mvs
```

Esto aplica `sql/clickhouse/30_realtime_mvs.sql`. Ábrelo. Sin rollups, el dashboard agregaría la tabla `snowplow_events` en bruto en cada actualización, cada 5 segundos. El archivo crea cinco tablas pequeñas y cinco **vistas materializadas** que las alimentan: cada vez que se inserta un lote en `snowplow_events`, la vista agrega **ese lote** y escribe el resultado en una tabla de destino.

Cuatro de las tablas de destino son `AggregatingMergeTree` (la quinta, una ventana de diez minutos de vistas de página en bruto para el feed en vivo, es una `MergeTree` simple con un TTL). Mira la primera:

```sql
CREATE TABLE retail_analytics.analytics_events_1m
(
    minute        DateTime('UTC'),
    event_name    LowCardinality(String),
    events        AggregateFunction(count),
    uniq_users    AggregateFunction(uniq, String),
    uniq_sessions AggregateFunction(uniq, String)
) ENGINE = AggregatingMergeTree ORDER BY (minute, event_name);
```

Las columnas guardan **estados de agregación**, no números. Un estado se puede combinar con otro, así que puedes consolidar los minutos en horas o días al leer, de forma exacta (`countMerge(events)`, `uniqMerge(uniq_users)`). Ejecútalo **antes** de cargar datos, para que cada inserción alimente los rollups conforme llega; el archivo también rellena cualquier minuto que falte, así que volver a ejecutarlo más tarde es seguro.

### 2. Carga un mes de historial

```bash
make backfill
```

Esto ejecuta un **Job** de Kubernetes que escribe 30 días de historial: unos **5 millones de eventos**, más las transacciones con tarjeta de las compras que hay entre ellos, en menos de dos minutos. Observa su log: cada línea `[flush]` es una inserción.

Si el historial ya está ahí (`make setup` lo carga), `make backfill` lo dice y no hace nada, porque una segunda carga duplicaría cada sesión. `make backfill FORCE=1` lo carga de todos modos.

```text
[flush] snowplow_events rows=100,000 bytes=98,142,336 wire=7,164,196 ms=2,673 server_written_rows=100000
```

Cada inserción es de **100,000 filas**, unos 98 MB de JSON que viajan como unos 7 MB, escritos en unos 2 a 3 segundos. Es a propósito, mira el paso 6.

### 3. Inicia los generadores en vivo

Si ejecutaste `make setup` ya están en ejecución, y esto no cambia nada. (`make traffic-start` inicia estos generadores y los compradores con navegador del módulo 07 a la vez.)

```bash
make generators-start
make logs S=producer-web
```

Se inician dos pods: `producer-web` genera sesiones de navegación a unos **100 eventos por segundo** en promedio a lo largo de un día, y `producer-cc` genera unas **10 transacciones con tarjeta por segundo** (la carga de `.env.example`, la mitad de la completa). El ritmo sigue una curva por hora del día (las primeras líneas del log muestran el promedio y el pico), y las sesiones siguen el mismo embudo que el backfill, y cada compra entre ellas puede llevar una transacción con tarjeta. Mira ahora las líneas `[flush]`: un lote cada 5 o 6 segundos, de cientos de filas o más, según la hora.

Los ritmos están en `.env`: `PRODUCE_TARGET_EPS` y `CC_TARGET_TPS`. Después de cambiarlos, ejecuta `make apply-env` ([COMMANDS.es.md](../../../COMMANDS.es.md) dice hasta dónde los aguanta una laptop).

### 4. Abre el dashboard

Abre <http://localhost:3000/demo/analytics>. Muestra los visitantes en vivo y un feed en vivo de eventos, los números de hoy, vistas de página por hora, las páginas más vistas, el embudo, los ingresos, los métodos de pago, los dispositivos, las fuentes de tráfico y las búsquedas que no devolvieron nada. El tile **Pipeline** es distinto: lee los contadores del OpenTelemetry collector (spans, logs y puntos de métricas recibidos y escritos por segundo), que es el sistema que observarás en el módulo 08.

Cada tile lee las tablas de rollup, no los eventos en bruto: por eso puede actualizarse cada pocos segundos sobre millones de filas.

### 5. Haz tus propias preguntas

Ejecuta `sql/clickhouse/examples/06_real_time_analytics.sql` en la consola SQL, o una consulta a la vez con `make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=1` (luego `N=2`, y así sucesivamente). En orden:

1. **Eventos por minuto**, desde el rollup. Los estados de agregación se combinan, así que un intervalo más grueso es exacto.
2. **El embudo de compra**, con `windowFunnel`: hasta dónde llegó cada sesión, en orden, dentro de una hora: vista de página, clic en un producto, agregar al carrito, inicio del proceso de pago, pago iniciado, pago confirmado.
3. **Búsquedas que no devolvieron nada.** Lo que buscan los clientes y el catálogo no tiene. Prueba `summer dress`.
4. **Filas por parte**: el siguiente paso.
5. **Anomalías en las transacciones con tarjeta.** Una pequeña proporción de las transacciones tiene exactamente un campo corrupto (un comercio faltante, un monto negativo, cero cuotas, una red de tarjeta desconocida, una marca de tiempo en el futuro). Cada comprobación cuenta un tipo.
6. Las filas anómalas en sí.

### 6. Por qué lotes grandes

Ejecuta la consulta 4:

```sql
SELECT table, count() AS active_parts, sum(rows) AS total_rows, round(sum(rows) / count()) AS avg_rows_per_part
FROM system.parts
WHERE database = 'retail_analytics' AND active AND table IN ('snowplow_events', 'credit_card_transactions')
GROUP BY table;
```

Cada inserción en una tabla MergeTree crea una **parte** en disco, y las fusiones en segundo plano combinan las partes. Muchas inserciones pequeñas significan muchas partes pequeñas, así que las fusiones se quedan atrás y las consultas leen más archivos. Cada inserción en `snowplow_events` también ejecuta las cinco vistas materializadas. Por eso los generadores nunca envían los eventos uno por uno: cada proceso tiene **un escritor por tabla** que junta filas hasta tener 100,000 o hasta que pasen 5 segundos, y las envía en una sola inserción. El resultado son unas 0.2 inserciones por segundo por tabla al ritmo en vivo, y partes de alrededor de medio millón de filas una vez que se han ejecutado las fusiones (499,112 en promedio en nuestra ejecución). El backfill es el caso extremo: inserciones de 100,000 filas tan rápido como ClickHouse las acepta.

## Punto de control

```bash
make check-06
```

`snowplow_events` tiene más de un millón de eventos a lo largo de una semana o más, el rollup de un minuto es igual a los eventos en bruto, hay transacciones con tarjeta, están llegando eventos ahora, y los endpoints del dashboard responden. (La penúltima comprobación necesita que los generadores estén en ejecución.)

## Solución de problemas

| Síntoma | Solución |
|---|---|
| Los tiles del dashboard están vacíos o muestran errores | ¿Ejecutaste `make ch-mvs`? ¿Terminó el backfill y están en ejecución los generadores (`make status`)? |
| `check-06` dice que el rollup difiere de los eventos en bruto | Ejecuta `make ch-mvs` de nuevo: rellena los minutos que faltan. |
| `make backfill` falla | `make logs S=backfill` y `make doctor`: normalmente son las credenciales de ClickHouse o que no se puede llegar a él. |
| Quieres que los eventos se detengan | `make generators-stop`, o `make traffic-stop` para detener también el simulador (módulo 07). |

## Para ir más lejos

- Sube `PRODUCE_TARGET_EPS` a 1000 en `.env`, ejecuta `make apply-env` y observa cómo las líneas de flush se hacen más grandes en lugar de más frecuentes.
- Lee `data-generators/README.md` para ver cómo los productores dan forma a las sesiones, al embudo y a las anomalías.

**Siguiente:** [módulo 07, Compradores simulados](../07-simulated-shoppers/README.md).
