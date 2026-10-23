# Keeping the Spanish guide in step with the English one

The participants' guide exists in English and in Spanish: `README.md` and `workshop/en/NN-*/README.md` are the source, `README.es.md` and `workshop/es/NN-*/README.md` are the translation (plus `workshop/en/09-clickhouse-agents/langfuse.md` and its Spanish page). `tools/test_workshop_es.py` fails when the two stop being the same guide, and this page says how the Spanish is written, so that a change to an English page can be carried over the same way. Left in English on purpose: `workshop/FACILITATOR.md` and the other files under `docs/`, the agent-mode playbooks (the guide agent translates as it speaks), the analyst's instructions (they already answer in English, Spanish or Brazilian Portuguese) and the data generators' README.

**When you change an English page**, change its Spanish page in the same pull request: the test compares headings, fenced code blocks, inline code, tables, lists, links, times and the `TODO(owner)` notes, and it also fails for a page left partly in English or written in another register. **When you add a module or a page**, add its Spanish page at the matching path, with the language-switch line only on the two READMEs (`**Language:** English · [Español](README.es.md)` and `**Idioma:** Español · [English](README.md)`).

The rest of this page is the brief that the translation was made from.

You translate **English markdown files of a hands-on workshop** (ClickHouse Cloud, Managed Postgres, Kubernetes, ClickStack) into Spanish. A person follows them step by step, at a laptop, typing the commands. A mistake in a command costs them time; a stilted sentence costs them trust. Write the Spanish a good Latin American engineer would write for a colleague.

## Who reads it, and in what voice

- Participants of a technical workshop, mostly Spanish-speaking engineers and analysts in Latin America.
- **Neutral Latin American Spanish.** Informal **"tú"** everywhere (never "usted/ustedes", never "vos", never "vosotros"). Imperatives: "Abre", "Haz clic", "Escribe", "Copia", "Ejecuta", "Espera", "Comprueba". Plural address (you all) is rare in the source; if it appears, use "ustedes" only if you cannot avoid it.
- Latin American vocabulary: **computadora** (not "ordenador"), **archivo**, **contraseña**, **correo electrónico**, **haz clic** (not "pulsa"), **navegador**, **portátil** only if you must (prefer **laptop** or **computadora**), **conexión**, **clave** (for a key), **obtener** (not "coger").
- Same register as the English: direct, short sentences, no filler, no marketing tone. Keep the author's jokes and asides if they have any; do not add new ones.
- Typography: use "¿...?" and "¡...!" correctly; quotes as in the source; keep the English file's **bold**, *italics*, lists, tables and blockquotes exactly where they are.

## What you must NOT change (`tools/test_workshop_es.py` checks most of this)

1. **Fenced code blocks (```` ``` ````) are copied byte for byte**, including their comments and expected output. Do not translate anything inside them. If a comment inside a block needs explaining, explain it in the text around the block.
2. **Inline code spans (`like this`) are copied exactly.** That includes commands, file names, paths, table and column names, environment variables, error messages and program output that appear inside backticks (for example `the Docker daemon is not running`: it is what the program prints, so it stays English).
3. **Error messages and program output quoted in plain quotes** ("no space left", "legacy builder is deprecated") also stay in English, in their quotes. Translate the sentence around them.
4. **Console and application labels in bold stay in English, exactly as written**, because the participant's screen is in English: **New service**, **Connect**, **Create New Agent**, **Capabilities**, **Settings**, **API Keys**, and so on. Do not translate them and do not add a gloss. (Labels that are not in bold or in code and are only ordinary words can be translated.)
5. **Link targets stay exactly as they are** in `[text](target)`; translate only the link text. (In a Spanish page a target is relative to that page: a link to a module goes to its Spanish page, and one to a file with no translation goes to the English file.) Keep `<https://...>` autolinks exactly.
6. **Numbers, times, sizes and versions stay exactly as written** ("about 25 minutes" becomes "unos 25 minutos", "4 min 23 s", "8 GB", "1.5 GB", "26.6.1"): do not reformat decimals or thousands separators.
7. **`TODO(owner)` stays verbatim** (the owner searches for it), as do the bold markers around it. Translate the rest of such notes.
8. **Names stay in English**: ClickHouse, ClickHouse Cloud, ClickHouse Agents, ClickPipe(s), ClickStack, HyperDX, Managed Postgres, Postgres, Snowplow, Snowplow Micro, OpenTelemetry, OTLP, Kubernetes, k3d, Helm, Docker, OrbStack, Colima, Langfuse, Langfuse Cloud, Traefik, ClickShop, Next.js, Playwright, `make` targets, and the names of the ClickShop services and tables.
9. **Structure is identical to the source**: the same headings at the same levels, in the same order (translate their text; keep numbering such as "### 3." and "## 2."), the same number of list items, table rows and columns, paragraphs and blockquotes. Do not merge, split, drop or add anything. Do not add a "translated by" note, a language switch or a table of contents.
10. **Do not "improve" the content.** If you think the English is wrong, translate it anyway and list the doubt in your final message.

## Fixed translations of the recurring headings and labels

Use these exactly, so that all the modules read alike:

| English | Spanish |
|---|---|
| `# Module NN: Title` | `# Módulo NN: Título` (module names: see glossary) |
| `**Goal:**` | `**Objetivo:**` |
| `**Time:**` | `**Tiempo:**` |
| `**You'll learn:**` | `**Aprenderás:**` |
| `**Next:**` | `**Siguiente:**` |
| `**Back to:**` | `**Volver a:**` |
| `**Optional final step:**` | `**Paso final opcional:**` |
| `## Before you start` | `## Antes de empezar` |
| `## Steps` | `## Pasos` |
| `## Checkpoint` | `## Punto de control` |
| `## Troubleshooting` | `## Solución de problemas` |
| `## Going further` | `## Para ir más lejos` |
| `## Clean up` | `## Limpieza` |
| `Symptom` / `Fix` (table headers) | `Síntoma` / `Solución` |
| `Draft.` (banner) | `Borrador.` |
| "about N minutes" | "unos N minutos" |
| "Tested on ..." | "Probado en ..." |

## Glossary (use these terms consistently)

| English | Spanish |
|---|---|
| workshop | taller |
| module | módulo |
| step | paso |
| participant | participante |
| service (ClickHouse Cloud) | servicio |
| instance (Postgres) | instancia |
| organization | organización |
| dashboard | dashboard (keep in English) |
| search / full-text search | búsqueda / búsqueda de texto completo |
| catalogue / catalog | catálogo |
| shopper(s) | comprador(es) |
| order | pedido |
| stock / inventory | inventario (stock) |
| checkout | pago (the checkout flow: "el proceso de pago") |
| clickstream | clickstream (keep in English) |
| events | eventos |
| generators | generadores |
| simulator / simulated shoppers | simulador / compradores simulados |
| trace / traces | traza / trazas |
| span | span (keep in English) |
| logs | logs (keep in English) |
| metrics | métricas |
| session replay | reproducción de sesión |
| observability | observabilidad |
| cluster | clúster |
| pod, node, namespace | pod, nodo, namespace (keep `pod` and `namespace`) |
| replica / replicate | réplica / replicar |
| replication slot | slot de replicación |
| write-ahead log | write-ahead log (keep in English, explain once if the source does) |
| materialized view | vista materializada |
| refreshable materialized view | vista materializada actualizable |
| rollup | rollup (keep in English; "tabla de agregados" if you must explain) |
| rows / columns / tables | filas / columnas / tablas |
| query / queries | consulta / consultas |
| freshness / fresh | frescura / actualizado |
| lag | retraso |
| sync interval | intervalo de sincronización |
| API key | clave de API |
| secret key / public key | clave secreta / clave pública |
| password | contraseña |
| credentials | credenciales |
| certificate | certificado |
| endpoint | endpoint (keep in English) |
| pooler | pooler (keep in English) |
| prompt (what you type to a model) | prompt (keep in English) |
| agent (ClickHouse Agents, an AI agent) | agente |
| instructions (of an agent) | instrucciones |
| capabilities (of an agent) | capacidades (but the console label **Capabilities** stays English) |
| the dry run, rehearsal | ensayo |
| run (a command) | ejecutar |
| start / stop (a service) | iniciar / detener |
| delete | eliminar (cloud resources) / borrar (files) |
| check (noun: `make check-NN`) | comprobación; the verb "check" is "comprobar" |
| troubleshooting | solución de problemas |
| laptop | laptop |
| breadcrumbs, tips | consejos |
| Pix, Boleto, card | Pix, Boleto, tarjeta |

Module names for titles and links, in this form: 00 Prerrequisitos; 01 Servicios en la nube (Cloud services); 02 Postgres transaccional (Postgres OLTP); 03 CDC con ClickPipes (CDC ClickPipe); 04 Búsqueda de texto completo; 05 Ejecutar la aplicación; 06 Analítica en tiempo real; 07 Compradores simulados; 08 Observabilidad con ClickStack; 09 ClickHouse Agents; 10 Limpieza. When the source refers to another module by name ("module 05, Run the app"), use these names.

## Terms settled while translating (add to the glossary above)

| English | Spanish |
|---|---|
| storefront | tienda |
| OpenTelemetry collector, collector | `collector` (kept) |
| card gateway | pasarela de tarjeta |
| funnel | embudo |
| chargeback | contracargo |
| the seed, seeded data | datos iniciales, carga inicial |
| "the pipe" (the ClickPipe) | el ClickPipe (module 03 also uses the loanword `pipe`) |
| the fast way / the slow way | la forma rápida / la forma lenta |
| ClickStack source | fuente (the bold UI label **Sources** stays English) |
| a bold word that is only emphasis | translated; a bold word that is a button, tab or field of the console or of ClickStack stays English |
| a prompt the participant types to an agent | translated (it is a sentence, not program output) |
| k3d's node roles "server" and "agents" | `server`, `agents` (kept, so they are not mistaken for ClickHouse Agents) |
