# Paso final opcional: monitorea tu agente con Langfuse

> **Borrador, como el resto del módulo 09.** La mitad de Langfuse de esta página (la cuenta, el proyecto, las claves) sigue la documentación propia de Langfuse. La mitad de ClickHouse Agents (dónde van las claves) **no está documentada en ningún lugar que el taller haya podido leer**, así que está marcada con **TODO(owner)** y hay que comprobarla en la consola antes del taller. El aviso y las notas se quitan cuando eso esté hecho.

**Objetivo:** ver qué hace tu `clickshop-analyst` detrás de la respuesta (cada pregunta, las llamadas al modelo, el SQL que ejecutó, cuánto tardó y cuánto costó) en **Langfuse Cloud**, y aprender qué mirar cuando un agente no se comporta como debería.

**Tiempo:** unos 15 minutos. Es **opcional** y no está incluido en el tiempo total del taller.

**Aprenderás:**
- qué significa **trazar** una aplicación LLM: una *traza* por pregunta, una *sesión* por conversación;
- cómo crear una cuenta de Langfuse, un proyecto y un par de claves de API;
- cómo leer una traza junto al SQL que comprobaste en el módulo 09.

## Antes de empezar

- Terminaste el [módulo 09](README.md) hasta el paso 6: `clickshop-analyst` existe y ha respondido preguntas.
- Eres **administrador de la organización** en ClickHouse Cloud. El changelog de ClickHouse (17 de agosto de 2026) dice que los administradores de la organización pueden abrir la sesión de Langfuse correspondiente directamente desde un chat de ClickHouse Agents, en **Public Beta**, **solo para chats creados recientemente**. Las conversaciones que tuviste antes de conectar Langfuse no aparecerán.
- Tienes una dirección de correo electrónico para una cuenta nueva y unos minutos. El plan gratuito **Hobby** de Langfuse Cloud es suficiente y no pide tarjeta de crédito (en el momento de escribir esto: 50,000 unidades al mes y 30 días de historial; la página de precios tiene las cifras actuales).
- **Usa solo los datos del taller.** Una traza guarda toda la conversación: tus preguntas, las instrucciones, el SQL y las filas que vio el agente. Los datos de ClickShop son sintéticos, así que aquí no hay problema. No conectes un proyecto de Langfuse a un agente que lea datos reales de clientes, a menos que tu organización lo haya aprobado.

## Pasos

### 1. Crea una cuenta de Langfuse Cloud

Abre <https://cloud.langfuse.com> (la región **EU**) o <https://us.cloud.langfuse.com> (la región **US**), haz clic en **Sign up** y crea la cuenta con tu correo electrónico (o con una opción de inicio de sesión que ofrezca la página). Confirma el correo si te lo pide.

Elige **una región y quédate en ella**: una cuenta, sus proyectos y sus claves pertenecen a la región donde te registraste, y una clave de una región no funciona en la otra. Langfuse también tiene una región de Japón (`jp.cloud.langfuse.com`) y una región HIPAA (`hipaa.cloud.langfuse.com`); el taller no las necesita.

### 2. Crea una organización y un proyecto

La primera vez que inicias sesión, Langfuse te pide crear una **organización** (un nombre como `clickshop-workshop`) y luego un **proyecto** (`clickshop-analyst`). Omite el paso de invitaciones. Un proyecto es donde viven las trazas de una aplicación, y las claves de API le pertenecen.

### 3. Crea las claves de API

En el proyecto, abre **Settings** y luego **API Keys**, y haz clic en **Create new API key** (puedes ponerle una nota, como `clickhouse-agents`). Langfuse muestra un par:

| Qué | Aspecto | Notas |
|---|---|---|
| **Public key** | `pk-lf-...` | Es seguro leerla en voz alta; identifica el proyecto. |
| **Secret key** | `sk-lf-...` | **Se muestra una sola vez.** Cópiala ahora: si la pierdes, crea otro par. |
| **Host** | `https://cloud.langfuse.com` (EU) o `https://us.cloud.langfuse.com` (US) | El de la región en la que te registraste. |

Trata la clave secreta como una contraseña. No va en `.env` (nada del taller la usa), ni en un archivo de este repositorio, ni en un chat con un agente de código: la pegarás solo en la consola de ClickHouse, en el siguiente paso.

### 4. Entrega las claves a ClickHouse Agents

> **TODO(owner): verifica en la consola.** Nada en la documentación de ClickHouse ni en la de Langfuse dice dónde introduce un administrador de la organización la clave pública, la clave secreta y el host de Langfuse para ClickHouse Agents, ni si ClickHouse Agents las pide siquiera (el changelog solo dice que los administradores pueden *abrir* la sesión de Langfuse desde un chat). Recórrelo una vez y anota aquí: dónde está el ajuste (una página a nivel de organización, o los ajustes propios del agente); las etiquetas de los tres campos; si se aplica a todos los agentes o a uno solo; y cuánto tarda en aplicarse.

Se llame como se llame la pantalla, pide las mismas tres cosas del paso 3: la **clave pública**, la **clave secreta** y el **host** (la URL base de tu región de Langfuse). Ingrésalas ahí, guarda y **crea un nuevo chat**: solo las conversaciones nuevas generan trazas.

Como comparación, Langfuse documenta los mismos tres valores para LibreChat, la aplicación de chat de código abierto del Agentic Data Stack de ClickHouse (como los ajustes `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` y `LANGFUSE_BASE_URL`, tras los cuales cada mensaje genera una traza): <https://langfuse.com/integrations/other/agentic-data-stack>.

### 5. Haz preguntas que valga la pena trazar

En una **nueva conversación** con `clickshop-analyst`, haz tres preguntas:

1. Una pregunta de [`questions.md`](../../09-clickhouse-agents/agents/clickshop-analyst/questions.md) que necesite una sola tabla (los ingresos por método de pago).
2. Una que necesite dos bases de datos (la primera página y la fuente de tráfico de los pedidos).
3. Una que debería responder mal sin una regla: *"¿Cuántas transacciones con tarjeta parecen corruptas?"* si todavía no le dijiste que los contracargos son negativos por diseño (módulo 09, paso 6).

### 6. Lee las trazas

En Langfuse, abre tu proyecto y luego **Tracing**: **Traces** lista una fila por pregunta, y **Sessions** agrupa las trazas de una conversación. (Si las etiquetas son distintas, confía en la pantalla: la idea es *una conversación, una sesión; una pregunta, una traza*.)

Abre la traza de la tercera pregunta y mira, en este orden:

- **La entrada y la salida**: la pregunta y lo que respondió el agente.
- **Las llamadas a herramientas**: el SQL que ejecutó contra tu servicio. Es el mismo SQL que le pediste que mostrara en el módulo 09, paso 5, pero ya no tienes que pedírselo.
- **Latencia**: cuánto tardó la pregunta completa y qué paso tomó la mayor parte.
- **Tokens y costo**: cuántos tokens entraron y salieron, y cuánto costó. Las instrucciones y el diccionario de datos forman parte de cada pregunta, así que dominan ese costo.

Ahora toma el SQL de la llamada a la herramienta, ejecútalo con `make ch-query Q='...'` y compara los números con la respuesta del agente, como hiciste en el módulo 09.

### 7. Cierra el ciclo

Cambia las instrucciones (módulo 09, paso 6) y haz la misma pregunta de nuevo en una conversación nueva. En Langfuse compara las dos trazas: ¿cambió el SQL, y cambiaron con él el costo y el tiempo? Unas instrucciones más largas cuestan tokens en cada pregunta, así que cada regla tiene que justificar su lugar.

Si quieres más: Langfuse puede **puntuar** una traza a mano (un pulgar arriba o abajo con un comentario) o con un evaluador automático, que es como los equipos notan que un agente empeoró después de un cambio. Eso queda fuera de este taller.

## Punto de control

No hay comprobación automática: las dos mitades están en un navegador. Terminaste cuando:

- tu proyecto de Langfuse muestra al menos una **sesión** de una conversación con `clickshop-analyst`;
- encontraste, en una traza, el SQL que ejecutó el agente y lo comparaste con ese mismo SQL ejecutado a mano;
- puedes explicar qué son una traza y una sesión, y qué mirarías primero cuando un agente da una respuesta incorrecta.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| No aparece nada en Langfuse | Solo generan trazas los chats **recién creados**: inicia una conversación nueva después de guardar las claves. Luego comprueba que el host sea la URL base de la región donde te registraste, y que no pegaste las claves en los campos equivocados. |
| El par de claves no funciona | Una clave pertenece a un proyecto **y a una región**. Crea un par nuevo en el proyecto (paso 3), con el host de su región. |
| Perdiste la clave secreta | Se muestra una sola vez. Crea otro par y elimina el anterior. |
| No encuentras dónde ingresar las claves | Puede que no seas administrador de la organización, o que la función no esté activada para tu organización (está en Public Beta). Pídeselo a un administrador. (TODO(owner): documentar la pantalla.) |
| Las trazas muestran la pregunta pero no el SQL | El agente respondió sin llamar a ninguna herramienta. Haz una pregunta que necesite los datos y mira la traza de esa pregunta. |
| Langfuse pide una tarjeta | Elegiste un plan de pago. El plan **Hobby** es gratuito. |

## Limpieza

Cuando termines, en Langfuse abre **Settings** del proyecto y **elimina las claves de API** (o elimina el proyecto, y la organización si la creaste solo para esto). Luego quita los ajustes de Langfuse de ClickHouse Agents (TODO(owner): dónde) o elimina el agente, como indica el [módulo 10](../10-cleanup/README.md). Las trazas en Langfuse permanecen hasta que elimines el proyecto o termine la retención del plan: contienen tus conversaciones.

**Volver a:** [módulo 09](README.md). **Siguiente:** [módulo 10, Limpieza](../10-cleanup/README.md).
