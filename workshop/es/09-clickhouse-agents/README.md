# Módulo 09: ClickHouse Agents

> **Borrador.** Este módulo está escrito a partir de la documentación de ClickHouse y todavía no se ha recorrido en la consola. Las notas marcadas con **TODO(owner)** son cosas que la documentación no dice y que hay que comprobar en la consola real antes del taller. El aviso y las notas se quitan cuando eso esté hecho.

**Objetivo:** hacer preguntas en lenguaje natural a los datos que construiste con **ClickHouse Agents**, y aprender a comprobar la respuesta de un agente contra SQL en el que confías.

**Tiempo:** unos 25 minutos (una estimación: no se ha cronometrado).

**Aprenderás:**
- qué es un agente: **instrucciones**, un **modelo** y **herramientas**, y por qué unas instrucciones que describen tu esquema y tus reglas de negocio determinan qué tan buenas son las respuestas;
- cómo leer el SQL que ejecutó un agente y cómo comprobarlo;
- cómo compartir un agente y, brevemente, qué hace su memoria.

## Antes de empezar

- `make check-08` pasa (módulo 08).
- Los datos están fluyendo. Las preguntas sobre "la última hora" o "ahora mismo" necesitan los generadores y los compradores en marcha: `make status` muestra la frescura de cada tabla, y `make traffic-start` los inicia (`make setup` los deja en marcha).
- ClickHouse Agents es una función **Beta** de ClickHouse Cloud. Para crear un agente necesitas la opción **Create agent**; si más abajo no ves **Create New Agent**, un administrador de la organización tiene que otorgártela.

> **TODO(owner): verifica en la consola.** La documentación no dice: si la función está disponible en organizaciones de prueba; el nombre exacto y el lugar del permiso (la guía de inicio rápido dice "Admin Settings", la página de uso compartido no usa ese nombre); qué opciones de modelo muestra el menú desplegable (el anuncio del lanzamiento dice que Claude Sonnet y Haiku son los predeterminados).

## Pasos

### 1. Abre ClickHouse Agents

En la consola de ClickHouse Cloud, abre tu servicio `clickshop` y haz clic en **ClickHouse agents** (marcado como Beta) en la barra lateral izquierda, y luego en **Launch ClickHouse agents**. Eso abre el **Agent Builder**. (El mismo producto también está en <https://ai.clickhouse.cloud/>.)

### 2. Crea el analista

En el Agent Builder haz clic en **Create New Agent**, en la parte superior del panel izquierdo, y completa el formulario:

| Campo | Valor |
|---|---|
| **Name** | `clickshop-analyst` |
| **Description** | para qué sirve, en una frase que entienda un compañero de equipo (el campo es visible para las personas con quienes lo compartes) |
| **Category** | `General` |
| **Instructions** | el prompt de sistema: su rol, las tablas que debe usar, las reglas de negocio. [`agents/clickshop-analyst/instructions.md`](../../09-clickhouse-agents/agents/clickshop-analyst/instructions.md) tiene el texto (un borrador que está revisando el responsable del taller): primero reemplaza los dos marcadores por los IDs de tu organización y de tu servicio |
| **Model** | elige uno del menú desplegable |

Las instrucciones son la parte que más importa. Todo lo que el agente debe saber sobre ClickShop y no puede adivinar va ahí: que las tablas replicadas de Postgres se leen con `FINAL` y `_peerdb_is_deleted = 0`, que los precios están en USD, qué eventos forman el embudo. [`docs/data-dictionary.md`](../../../docs/data-dictionary.md) lo enumera todo, tabla por tabla: adjúntalo al agente como **File Context**, y las instrucciones hacen referencia a él.

### 3. Elige qué puede hacer

El panel principal tiene **Capabilities**, interruptores para lo que el agente puede usar: **Run Code**, **Web Search**, **File Context**, **Artifacts**, **MCP Servers** y **Skills**. **Add Tools**, en la parte inferior, abre un catálogo de integraciones de terceros, y **Advanced settings** contiene los **subagents**. Puedes cambiar todo esto más tarde.

Para un analista de tus propios datos, deja activo lo que necesitas para leer los datos y graficarlos, y deja **Web Search** desactivado: quieres respuestas que salgan de tus tablas y no de internet.

> **TODO(owner): verifica en la consola.** La documentación no dice cómo llega un agente a los datos de tu servicio de ClickHouse. Compruébalo y anota aquí: si el agente consulta el servicio mediante una herramienta integrada o si hay que adjuntar un servidor MCP de ClickHouse (**MCP Servers**, **Add Tools**); con qué usuario o rol de base de datos se ejecutan sus consultas; si ese acceso es de solo lectura (el anuncio de Managed Postgres dice que su acceso a Postgres es "read-only by default"; nada lo dice para ClickHouse); y en qué lugar de una conversación se puede ver el SQL que ejecutó el agente.

### 4. Haz las primeras preguntas

Guarda el agente, abre una **nueva conversación** y selecciona `clickshop-analyst` en el selector de agentes. Pregúntale primero algo que necesite una sola tabla y luego algo que necesite dos bases de datos. [`agents/clickshop-analyst/questions.md`](../../09-clickhouse-agents/agents/clickshop-analyst/questions.md) tiene preguntas candidatas que cubren toda la tienda: ingresos, el embudo, búsquedas que no encontraron nada, inventario, la frescura de la réplica, anomalías en tarjetas. (El ejemplo de la propia documentación es "¿Cuáles son mis 10 tablas con más filas esta semana?")

El agente planifica, llama a sus herramientas y responde con una tabla o un gráfico.

### 5. Comprueba una respuesta

Un agente que suena seguro puede estar equivocado, así que haz esto siempre:

1. Pregunta: *"Muéstrame el SQL que ejecutaste."*
2. Léelo. ¿Lee `retail_oltp` con `FINAL` y `_peerdb_is_deleted = 0`? ¿Filtra por `is_active`? ¿Suma `bill_value` entre monedas (no debe hacerlo)? ¿Tomó la ventana de tiempo que querías?
3. Ejecuta el mismo SQL en la consola SQL, o con `make ch-query Q='...'`, y compara los números.
4. Para las preguntas que los ejemplos ya responden (`sql/clickhouse/examples/`), compara con ellos: por ejemplo, `make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2` es el embudo.

Cuando una respuesta es incorrecta, la solución suele estar en las **instrucciones**, no en la pregunta.

### 6. Mejóralo

Toma una pregunta que el agente respondió mal o a medias. Agrega a las **Instructions** una regla que lo habría evitado (el diccionario de datos dice cuál), guarda y haz la misma pregunta en una conversación nueva. Este ciclo, respuesta incorrecta, una regla, una respuesta mejor, es cómo se construye un agente útil.

### 7. Compártelo y qué hace la memoria

Para compartir el agente, abre su diálogo **Share**: busca a una persona o un grupo, elige su nivel de acceso (**Viewer** puede usarlo, **Editor** puede modificarlo, **Owner** también puede eliminarlo y compartirlo) y haz clic en **Save Changes**. Un interruptor lo comparte con toda la organización, lo que además hace que aparezca en el marketplace si tu administrador lo activó.

**Memory** guarda datos pequeños entre conversaciones: un formato de fecha preferido, la base de datos que consultas con más frecuencia. Es privada para cada persona (los agentes de los demás no ven la tuya). Ábrela desde el ícono **Memories** en la navegación izquierda; la casilla **Use memory**, en la parte superior, la desactiva. En un taller, desactívala para que una respuesta no dependa de lo que preguntaste antes.

> **TODO(owner): verifica en la consola.** Las etiquetas exactas del diálogo Share (en particular el interruptor para toda la organización), y si la biblioteca de **Prompts** guardados (la documentación la menciona pero no la describe) merece un paso aquí.

## Punto de control

No hay comprobación automática: el agente vive en la consola. Terminaste cuando:

- `clickshop-analyst` existe y respondió al menos una pregunta sobre cada base de datos (`retail_oltp`, `retail_analytics`, `retail_otel`);
- comprobaste al menos una respuesta ejecutando tú mismo su SQL;
- cambiaste las instrucciones una vez y viste cambiar la respuesta.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| **ClickHouse agents** no aparece en la barra lateral | Es una función Beta. Consulta con el administrador de tu organización; la disponibilidad en cuentas de prueba no está documentada. (TODO(owner): confirmar.) |
| No hay botón **Create New Agent** | Necesitas la opción **Create agent**: la otorga un administrador de la organización. |
| El agente dice que no puede acceder a tus datos | Sus herramientas no están configuradas para el servicio. Consulta la nota del paso 3. (TODO(owner): documentar la solución.) |
| Los números difieren de tu propio SQL | Lee su SQL (paso 5). Las causas habituales: falta `FINAL` o falta `_peerdb_is_deleted = 0` en una tabla de `retail_oltp`, se cuentan productos inactivos, se suma `bill_value` entre monedas, una ventana de tiempo distinta. |
| No encuentra nada para "la última hora" | La carga está detenida: `make status` muestra qué tan antigua es cada tabla; `make traffic-start`. |
| Cuenta como anomalías los importes de tarjeta `negative` y el número es enorme | Los contracargos son negativos por diseño. Las instrucciones deben indicar que se miren solo las filas `expense` (consulta el diccionario de datos). |

## Para ir más lejos

- Pide un gráfico: la capacidad **Artifacts** lo genera.
- **Monitorea el agente con Langfuse Cloud** (el paso final opcional): [una página propia](langfuse.md) te lleva desde crear una cuenta de Langfuse y sus claves de API hasta leer la traza de cada pregunta que responde tu analista.
- Crea un segundo agente solo para observabilidad (`retail_otel`: trazas, logs, métricas), con sus propias instrucciones, y pregúntale por el ejercicio de la pasarela de tarjetas del módulo 08.
- Los **Subagents** (en **Advanced settings**) permiten que un agente delegue trabajo en otro, por ejemplo un analista que consulta a un agente de observabilidad.
- Managed Postgres tiene su propia integración con agentes (puede consultar la instancia de Postgres directamente y combinarla con ClickHouse en una sola pregunta). TODO(owner): averiguar cómo activarla y si vale la pena agregarla a este módulo.

**Paso final opcional:** [monitorea el agente con Langfuse](langfuse.md) (unos 15 minutos, no incluidos en el total).

**Siguiente:** [módulo 10, Limpieza](../10-cleanup/README.md).
