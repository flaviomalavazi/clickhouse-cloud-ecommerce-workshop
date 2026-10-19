'use client';

import { useMemo } from 'react';
import { useI18n } from '@/i18n/LocaleProvider';
import { LOCALE_CURRENCY, type Locale } from '@/i18n/config';

/**
 * Chart strings for the analytics dashboard, in the three locales the app ships.
 *
 * ── Why these are not in `src/i18n/en.ts` ────────────────────────────────────
 * They should be, and if this file survives that is where they belong. The
 * dashboard predates the dictionary and hardcodes English throughout; the app
 * dictionary has no `analytics.*` namespace, and `t()` is typed as
 * `keyof typeof en`, so a key that is not in that file is a compile error
 * rather than a missing translation. This module is the same contract — flat
 * dotted keys, `{placeholder}` interpolation, English as the fallback — scoped
 * to one route, so the charts stop being English-only today without a
 * cross-cutting edit to the shared dictionary. Lift it wholesale when the rest
 * of the page is translated.
 *
 * The locale itself still comes from `useI18n()`, so this follows the switcher
 * like everything else and there is only one source of truth for which
 * language is on screen.
 */

const en = {
  'range.24h': 'Last 24 Hours',
  'range.7d': 'Last 7 Days',
  'range.30d': 'Last 30 Days',

  'title.pageViews': 'Page Views · {range}',
  'title.sessions': 'Sessions · {range}',
  'title.eventTypes': 'Event Types · Today',
  'title.categories': 'Category Interest · Today',
  // Not charts, but they share the range suffix with the ones above — a
  // translated window on an English heading reads worse than either alone.
  'title.topPages': 'Top Pages · Today',
  'title.topSearches': 'Top Searches · {range}',

  'series.pageViews': 'Page Views',
  'series.users': 'Users',
  'series.sessions': 'Sessions',
  'series.views': 'Views',

  'axis.time': 'Time',
  'axis.day': 'Date',
  'axis.category': 'Category',
  'axis.eventType': 'Event type',

  'col.count': 'Count',
  'col.share': 'Share',

  'empty.trend': 'No data yet · Waiting for events',
  'empty.events': 'No events yet',
  'empty.categories': 'No category views yet',

  'a11y.summary': '{title}. {n} data points. Series: {series}.',
  'a11y.tableCaption': '{title}: full data',

  // ── Page chrome ──────────────────────────────────────────────────────────
  'page.subtitle': 'Powered by ClickHouse · Live tiles every 5s · Last updated {time}',
  'header.refresh': 'Refresh',
  'header.refreshing': 'Refreshing…',
  'header.stage': 'Stage mode',
  'header.exitStage': 'Exit stage mode',
  'header.dataset': '{rows} events in ClickHouse',
  'session.read': 'rows read by ClickHouse since you opened this page',

  // ── KPIs ─────────────────────────────────────────────────────────────────
  'kpi.active': 'Active now',
  'kpi.activeSub': 'last 10 seconds',
  'kpi.pageViews': 'Page views',
  'kpi.sessions': 'Sessions',
  'kpi.users': 'Unique users',
  'kpi.events': 'Total events',
  'kpi.today': 'today',

  'emptyToday.title': 'No traffic yet today',
  'emptyToday.body': 'Browse the shop, or start the generator with ./run-demo.sh. The range tiles below still show history.',
  'emptyToday.cta': 'Show the last 7 days',

  // ── Live visitors ────────────────────────────────────────────────────────
  'title.visitors': 'Current visitors',
  'visitors.none': 'No visitors active in the last 10 seconds',
  'visitors.count': '{n} active right now',
  'visitors.asOf': 'as of {time}',
  'visitors.waiting': 'Waiting for visitors… browse the shop to see activity here.',
  'col.visitor': 'Visitor',
  'col.currentPage': 'Current page',
  'col.pageTitle': 'Page title',
  'col.events': 'Events',
  'you': 'You',


  // ── Globe + feed ─────────────────────────────────────────────────────────
  'title.feed': 'Live activity',
  'feed.empty': 'Waiting for clicks, carts and orders…',
  'feed.someone': 'Someone',
  'feed.youActor': 'You',
  'feed.aProduct': 'a product',
  'feed.product_click': '{who} opened {product}',
  'feed.cart_add_to_cart': '{who} added {product} to the cart',
  'feed.checkout_start': '{who} started checkout',
  'feed.checkout_payment_confirmed': '{who} placed an order of {value}',
  'feed.search_text_search': '{who} searched for “{query}”',
  'feed.ago': '{s}s ago',

  // ── Business tiles ───────────────────────────────────────────────────────
  'title.funnel': 'Conversion funnel · {range}',
  'funnel.page_view': 'Visited',
  'funnel.product_click': 'Opened a product',
  'funnel.cart_add_to_cart': 'Added to cart',
  'funnel.checkout_start': 'Started checkout',
  'funnel.checkout_payment_initiated': 'Started payment',
  'funnel.checkout_payment_confirmed': 'Paid',
  'funnel.ofStart': '{pct} of visits',
  'funnel.step': '{pct} of previous step',
  'funnel.empty': 'No sessions in this window',
  'funnel.caption': 'Sessions completing each step in order within an hour, via windowFunnel()',

  'title.revenue': 'Revenue · {range}',
  'revenue.gmv': 'Gross merchandise value',
  'revenue.orders': 'Orders',
  'revenue.aov': 'Average ticket',
  'revenue.empty': 'No orders in this window',
  'series.gmv': 'Revenue',

  'title.devices': 'Devices · {range}',
  'device.Mobile': 'Mobile',
  'device.Computer': 'Desktop',
  'device.Tablet': 'Tablet',
  'device.Unknown': 'Unknown',

  // ── Existing tables ──────────────────────────────────────────────────────
  'col.page': 'Page',
  'col.views': 'Views',
  'col.users': 'Users',
  'col.query': 'Query',
  'col.type': 'Type',
  'empty.topPages': 'No page view data yet',
  'empty.searches': 'No search data yet',
  'footer.poweredBy': 'Analytics powered by',
  'footer.snowplow': 'Events collected via Snowplow',

  // ── Query receipts ───────────────────────────────────────────────────────
  'receipt.read': '{rows} rows · {bytes} · {ms}',
  'receipt.cached': 'from the query cache',
  'receipt.sql': 'SQL',
  'receipt.hideSql': 'Hide SQL',

  // ── ClickStack pipeline ──────────────────────────────────────────────────
  'title.pipeline': 'ClickStack, live · this shop observing itself',
  'pipe.shop': 'ClickShop',
  'pipe.shopSub': 'browser and backend, instrumented',
  'pipe.collector': 'OTel Collector',
  'pipe.collectorSub': '{n} signals/s in',
  'pipe.clickhouse': 'ClickHouse Cloud',
  'pipe.clickhouseSub': '{n} rows/s written',
  'pipe.clickstack': 'ClickStack',
  'pipe.clickstackSub': 'traces, logs, metrics, replays',
  'pipe.spans': 'Spans/s',
  'pipe.logs': 'Logs/s',
  'pipe.metrics': 'Metric points/s',
  'pipe.replays': 'Replay chunks/s',
  'pipe.refused': '{n} refused',
  'pipe.unavailable': 'Collector metrics unavailable',
  'pipe.source': 'read from the collector’s own /metrics',

  // ── Store map + feed ─────────────────────────────────────────────────────
  'title.storeMap': 'Live store map · last minute',
  'storeMap.empty': 'Nobody in the store right now',
  'storeMap.more': '+{n}',
  'zone.home': 'Home',
  'zone.search': 'Search',
  'zone.category': 'Category',
  'zone.product': 'Product',
  'zone.cart': 'Cart',
  'zone.checkout': 'Checkout',
  'zone.paid': 'Paid',
  'zone.elsewhere': 'Elsewhere',
  'zone.entry': 'Arrived',
  'feed.freshness': 'last event {s}s ago · browser→collector p50 {p50}',


  // ── Real-data tiles ──────────────────────────────────────────────────────
  'title.payments': 'Payments by method · {range}',
  'payments.initiated': '{n} started',
  'payments.confirmed': '{n} confirmed',
  'payments.success': 'success',
  'payments.failing': 'failing',
  'payments.empty': 'No payment attempts in this window',
  'method.pix': 'Pix',
  'method.credit_card': 'Credit card',
  'method.boleto': 'Boleto',
  'title.sources': 'Traffic sources · {range}',
  'sources.sessions': 'sessions',
  'sources.orders': '{n} orders · {pct} conversion',
  'sources.empty': 'No sessions in this window',
  'source.direct': 'Direct',
  'title.flows': 'How people move through the store · {range}',
  'flows.forward': 'forward',
  'flows.back': 'back',
  'flows.empty': 'No page-to-page moves in this window',
  'title.scroll': 'Scroll depth · {range}',
  'scroll.caption': 'Share of page views that scrolled past each mark',
  'scroll.empty': 'No scroll events in this window',
  'title.platforms': 'Platforms, from the user agent · {range}',
  'platforms.caption': 'Parsed at query time with multiIf(match(useragent, …))',
  'title.zeroSearches': 'Searches with no results · {range}',
  'zeroSearches.rate': '{pct} of {n} searches found nothing',
  'zeroSearches.empty': 'Every search found something',
} as const;

export type AnalyticsKey = keyof typeof en;

const pt: Record<AnalyticsKey, string> = {
  'range.24h': 'Últimas 24 horas',
  'range.7d': 'Últimos 7 dias',
  'range.30d': 'Últimos 30 dias',

  'title.pageViews': 'Visualizações · {range}',
  'title.sessions': 'Sessões · {range}',
  'title.eventTypes': 'Tipos de evento · Hoje',
  'title.categories': 'Interesse por categoria · Hoje',
  'title.topPages': 'Páginas mais vistas · Hoje',
  'title.topSearches': 'Buscas mais frequentes · {range}',

  'series.pageViews': 'Visualizações',
  'series.users': 'Usuários',
  'series.sessions': 'Sessões',
  'series.views': 'Visualizações',

  'axis.time': 'Hora',
  'axis.day': 'Data',
  'axis.category': 'Categoria',
  'axis.eventType': 'Tipo de evento',

  'col.count': 'Contagem',
  'col.share': 'Participação',

  'empty.trend': 'Nenhum dado ainda · Aguardando eventos',
  'empty.events': 'Nenhum evento ainda',
  'empty.categories': 'Nenhuma visualização de categoria ainda',

  'a11y.summary': '{title}. {n} pontos de dados. Séries: {series}.',
  'a11y.tableCaption': '{title}: dados completos',

  'page.subtitle': 'Feito com ClickHouse · Tiles ao vivo a cada 5s · Atualizado às {time}',
  'header.refresh': 'Atualizar',
  'header.refreshing': 'Atualizando…',
  'header.stage': 'Modo telão',
  'header.exitStage': 'Sair do modo telão',
  'header.dataset': '{rows} eventos no ClickHouse',
  'session.read': 'linhas lidas pelo ClickHouse desde que você abriu esta página',

  'kpi.active': 'Ativos agora',
  'kpi.activeSub': 'últimos 10 segundos',
  'kpi.pageViews': 'Visualizações',
  'kpi.sessions': 'Sessões',
  'kpi.users': 'Usuários únicos',
  'kpi.events': 'Total de eventos',
  'kpi.today': 'hoje',

  'emptyToday.title': 'Ainda sem tráfego hoje',
  'emptyToday.body': 'Navegue na loja, ou ligue o gerador com ./run-demo.sh. Os tiles de período abaixo continuam mostrando o histórico.',
  'emptyToday.cta': 'Ver os últimos 7 dias',

  'title.visitors': 'Visitantes agora',
  'visitors.none': 'Nenhum visitante ativo nos últimos 10 segundos',
  'visitors.count': '{n} ativos agora',
  'visitors.asOf': 'às {time}',
  'visitors.waiting': 'Aguardando visitantes… navegue na loja para ver a atividade aqui.',
  'col.visitor': 'Visitante',
  'col.currentPage': 'Página atual',
  'col.pageTitle': 'Título da página',
  'col.events': 'Eventos',
  'you': 'Você',


  'title.feed': 'Atividade ao vivo',
  'feed.empty': 'Aguardando cliques, carrinhos e pedidos…',
  'feed.someone': 'Alguém',
  'feed.youActor': 'Você',
  'feed.aProduct': 'um produto',
  'feed.product_click': '{who} abriu {product}',
  'feed.cart_add_to_cart': '{who} adicionou {product} ao carrinho',
  'feed.checkout_start': '{who} iniciou o checkout',
  'feed.checkout_payment_confirmed': '{who} fez um pedido de {value}',
  'feed.search_text_search': '{who} buscou “{query}”',
  'feed.ago': 'há {s}s',

  'title.funnel': 'Funil de conversão · {range}',
  'funnel.page_view': 'Visitou',
  'funnel.product_click': 'Abriu um produto',
  'funnel.cart_add_to_cart': 'Adicionou ao carrinho',
  'funnel.checkout_start': 'Iniciou o checkout',
  'funnel.checkout_payment_initiated': 'Iniciou o pagamento',
  'funnel.checkout_payment_confirmed': 'Pagou',
  'funnel.ofStart': '{pct} das visitas',
  'funnel.step': '{pct} da etapa anterior',
  'funnel.empty': 'Nenhuma sessão neste período',
  'funnel.caption': 'Sessões que completam cada etapa em ordem em até uma hora, via windowFunnel()',

  'title.revenue': 'Receita · {range}',
  'revenue.gmv': 'Valor bruto de vendas',
  'revenue.orders': 'Pedidos',
  'revenue.aov': 'Ticket médio',
  'revenue.empty': 'Nenhum pedido neste período',
  'series.gmv': 'Receita',

  'title.devices': 'Dispositivos · {range}',
  'device.Mobile': 'Celular',
  'device.Computer': 'Desktop',
  'device.Tablet': 'Tablet',
  'device.Unknown': 'Desconhecido',

  'col.page': 'Página',
  'col.views': 'Visualizações',
  'col.users': 'Usuários',
  'col.query': 'Busca',
  'col.type': 'Tipo',
  'empty.topPages': 'Ainda sem visualizações de página',
  'empty.searches': 'Ainda sem buscas',
  'footer.poweredBy': 'Analytics feito com',
  'footer.snowplow': 'Eventos coletados via Snowplow',

  'receipt.read': '{rows} linhas · {bytes} · {ms}',
  'receipt.cached': 'do cache de queries',
  'receipt.sql': 'SQL',
  'receipt.hideSql': 'Ocultar SQL',

  'title.pipeline': 'ClickStack ao vivo · a loja observando a si mesma',
  'pipe.shop': 'ClickShop',
  'pipe.shopSub': 'navegador e backend instrumentados',
  'pipe.collector': 'OTel Collector',
  'pipe.collectorSub': '{n} sinais/s recebidos',
  'pipe.clickhouse': 'ClickHouse Cloud',
  'pipe.clickhouseSub': '{n} linhas/s gravadas',
  'pipe.clickstack': 'ClickStack',
  'pipe.clickstackSub': 'traces, logs, métricas e replays',
  'pipe.spans': 'Spans/s',
  'pipe.logs': 'Logs/s',
  'pipe.metrics': 'Pontos de métrica/s',
  'pipe.replays': 'Chunks de replay/s',
  'pipe.refused': '{n} recusados',
  'pipe.unavailable': 'Métricas do Collector indisponíveis',
  'pipe.source': 'lido do /metrics do próprio Collector',

  'title.storeMap': 'Mapa da loja ao vivo · último minuto',
  'storeMap.empty': 'Ninguém na loja agora',
  'storeMap.more': '+{n}',
  'zone.home': 'Home',
  'zone.search': 'Busca',
  'zone.category': 'Categoria',
  'zone.product': 'Produto',
  'zone.cart': 'Carrinho',
  'zone.checkout': 'Checkout',
  'zone.paid': 'Pago',
  'zone.elsewhere': 'Outras páginas',
  'zone.entry': 'Chegou',
  'feed.freshness': 'último evento há {s}s · navegador→coletor p50 {p50}',


  'title.payments': 'Pagamentos por método · {range}',
  'payments.initiated': '{n} iniciados',
  'payments.confirmed': '{n} confirmados',
  'payments.success': 'sucesso',
  'payments.failing': 'falhando',
  'payments.empty': 'Nenhuma tentativa de pagamento neste período',
  'method.pix': 'Pix',
  'method.credit_card': 'Cartão de crédito',
  'method.boleto': 'Boleto',
  'title.sources': 'Origem do tráfego · {range}',
  'sources.sessions': 'sessões',
  'sources.orders': '{n} pedidos · {pct} de conversão',
  'sources.empty': 'Nenhuma sessão neste período',
  'source.direct': 'Direto',
  'title.flows': 'Como as pessoas andam pela loja · {range}',
  'flows.forward': 'avançou',
  'flows.back': 'voltou',
  'flows.empty': 'Nenhuma navegação entre páginas neste período',
  'title.scroll': 'Profundidade de scroll · {range}',
  'scroll.caption': 'Parcela das visualizações que passou de cada marca',
  'scroll.empty': 'Nenhum evento de scroll neste período',
  'title.platforms': 'Plataformas, pelo user agent · {range}',
  'platforms.caption': 'Extraído na hora da query com multiIf(match(useragent, …))',
  'title.zeroSearches': 'Buscas sem resultado · {range}',
  'zeroSearches.rate': '{pct} de {n} buscas não encontraram nada',
  'zeroSearches.empty': 'Todas as buscas encontraram algo',
};

const es: Record<AnalyticsKey, string> = {
  'range.24h': 'Últimas 24 horas',
  'range.7d': 'Últimos 7 días',
  'range.30d': 'Últimos 30 días',

  'title.pageViews': 'Vistas de página · {range}',
  'title.sessions': 'Sesiones · {range}',
  'title.eventTypes': 'Tipos de evento · Hoy',
  'title.categories': 'Interés por categoría · Hoy',
  'title.topPages': 'Páginas más vistas · Hoy',
  'title.topSearches': 'Búsquedas más frecuentes · {range}',

  'series.pageViews': 'Vistas de página',
  'series.users': 'Usuarios',
  'series.sessions': 'Sesiones',
  'series.views': 'Vistas',

  'axis.time': 'Hora',
  'axis.day': 'Fecha',
  'axis.category': 'Categoría',
  'axis.eventType': 'Tipo de evento',

  'col.count': 'Recuento',
  'col.share': 'Proporción',

  'empty.trend': 'Aún no hay datos · Esperando eventos',
  'empty.events': 'Aún no hay eventos',
  'empty.categories': 'Aún no hay vistas de categoría',

  'a11y.summary': '{title}. {n} puntos de datos. Series: {series}.',
  'a11y.tableCaption': '{title}: datos completos',

  'page.subtitle': 'Con ClickHouse · Tiles en vivo cada 5s · Actualizado a las {time}',
  'header.refresh': 'Actualizar',
  'header.refreshing': 'Actualizando…',
  'header.stage': 'Modo pantalla',
  'header.exitStage': 'Salir del modo pantalla',
  'header.dataset': '{rows} eventos en ClickHouse',
  'session.read': 'filas leídas por ClickHouse desde que abriste esta página',

  'kpi.active': 'Activos ahora',
  'kpi.activeSub': 'últimos 10 segundos',
  'kpi.pageViews': 'Vistas de página',
  'kpi.sessions': 'Sesiones',
  'kpi.users': 'Usuarios únicos',
  'kpi.events': 'Eventos totales',
  'kpi.today': 'hoy',

  'emptyToday.title': 'Aún no hay tráfico hoy',
  'emptyToday.body': 'Navega la tienda, o inicia el generador con ./run-demo.sh. Los tiles de período siguen mostrando el historial.',
  'emptyToday.cta': 'Ver los últimos 7 días',

  'title.visitors': 'Visitantes ahora',
  'visitors.none': 'Ningún visitante activo en los últimos 10 segundos',
  'visitors.count': '{n} activos ahora',
  'visitors.asOf': 'a las {time}',
  'visitors.waiting': 'Esperando visitantes… navega la tienda para ver actividad aquí.',
  'col.visitor': 'Visitante',
  'col.currentPage': 'Página actual',
  'col.pageTitle': 'Título de la página',
  'col.events': 'Eventos',
  'you': 'Tú',


  'title.feed': 'Actividad en vivo',
  'feed.empty': 'Esperando clics, carritos y pedidos…',
  'feed.someone': 'Alguien',
  'feed.youActor': 'Tú',
  'feed.aProduct': 'un producto',
  'feed.product_click': '{who} abrió {product}',
  'feed.cart_add_to_cart': '{who} agregó {product} al carrito',
  'feed.checkout_start': '{who} inició el checkout',
  'feed.checkout_payment_confirmed': '{who} hizo un pedido de {value}',
  'feed.search_text_search': '{who} buscó “{query}”',
  'feed.ago': 'hace {s}s',

  'title.funnel': 'Embudo de conversión · {range}',
  'funnel.page_view': 'Visitó',
  'funnel.product_click': 'Abrió un producto',
  'funnel.cart_add_to_cart': 'Agregó al carrito',
  'funnel.checkout_start': 'Inició el checkout',
  'funnel.checkout_payment_initiated': 'Inició el pago',
  'funnel.checkout_payment_confirmed': 'Pagó',
  'funnel.ofStart': '{pct} de las visitas',
  'funnel.step': '{pct} del paso anterior',
  'funnel.empty': 'Ninguna sesión en este período',
  'funnel.caption': 'Sesiones que completan cada paso en orden en menos de una hora, vía windowFunnel()',

  'title.revenue': 'Ingresos · {range}',
  'revenue.gmv': 'Valor bruto de ventas',
  'revenue.orders': 'Pedidos',
  'revenue.aov': 'Ticket promedio',
  'revenue.empty': 'Ningún pedido en este período',
  'series.gmv': 'Ingresos',

  'title.devices': 'Dispositivos · {range}',
  'device.Mobile': 'Móvil',
  'device.Computer': 'Escritorio',
  'device.Tablet': 'Tablet',
  'device.Unknown': 'Desconocido',

  'col.page': 'Página',
  'col.views': 'Vistas',
  'col.users': 'Usuarios',
  'col.query': 'Búsqueda',
  'col.type': 'Tipo',
  'empty.topPages': 'Aún no hay vistas de página',
  'empty.searches': 'Aún no hay búsquedas',
  'footer.poweredBy': 'Analytics con',
  'footer.snowplow': 'Eventos recolectados vía Snowplow',

  'receipt.read': '{rows} filas · {bytes} · {ms}',
  'receipt.cached': 'desde la caché de consultas',
  'receipt.sql': 'SQL',
  'receipt.hideSql': 'Ocultar SQL',

  'title.pipeline': 'ClickStack en vivo · la tienda observándose a sí misma',
  'pipe.shop': 'ClickShop',
  'pipe.shopSub': 'navegador y backend instrumentados',
  'pipe.collector': 'OTel Collector',
  'pipe.collectorSub': '{n} señales/s recibidas',
  'pipe.clickhouse': 'ClickHouse Cloud',
  'pipe.clickhouseSub': '{n} filas/s escritas',
  'pipe.clickstack': 'ClickStack',
  'pipe.clickstackSub': 'traces, logs, métricas y replays',
  'pipe.spans': 'Spans/s',
  'pipe.logs': 'Logs/s',
  'pipe.metrics': 'Puntos de métrica/s',
  'pipe.replays': 'Chunks de replay/s',
  'pipe.refused': '{n} rechazados',
  'pipe.unavailable': 'Métricas del Collector no disponibles',
  'pipe.source': 'leído del /metrics del propio Collector',

  'title.storeMap': 'Mapa de la tienda en vivo · último minuto',
  'storeMap.empty': 'No hay nadie en la tienda ahora',
  'storeMap.more': '+{n}',
  'zone.home': 'Inicio',
  'zone.search': 'Búsqueda',
  'zone.category': 'Categoría',
  'zone.product': 'Producto',
  'zone.cart': 'Carrito',
  'zone.checkout': 'Checkout',
  'zone.paid': 'Pagado',
  'zone.elsewhere': 'Otras páginas',
  'zone.entry': 'Llegó',
  'feed.freshness': 'último evento hace {s}s · navegador→colector p50 {p50}',


  'title.payments': 'Pagos por método · {range}',
  'payments.initiated': '{n} iniciados',
  'payments.confirmed': '{n} confirmados',
  'payments.success': 'éxito',
  'payments.failing': 'fallando',
  'payments.empty': 'Ningún intento de pago en este período',
  'method.pix': 'Pix',
  'method.credit_card': 'Tarjeta de crédito',
  'method.boleto': 'Boleto',
  'title.sources': 'Origen del tráfico · {range}',
  'sources.sessions': 'sesiones',
  'sources.orders': '{n} pedidos · {pct} de conversión',
  'sources.empty': 'Ninguna sesión en este período',
  'source.direct': 'Directo',
  'title.flows': 'Cómo se mueve la gente por la tienda · {range}',
  'flows.forward': 'avanzó',
  'flows.back': 'volvió',
  'flows.empty': 'Ninguna navegación entre páginas en este período',
  'title.scroll': 'Profundidad de scroll · {range}',
  'scroll.caption': 'Proporción de vistas que pasó cada marca',
  'scroll.empty': 'Ningún evento de scroll en este período',
  'title.platforms': 'Plataformas, por el user agent · {range}',
  'platforms.caption': 'Extraído al consultar con multiIf(match(useragent, …))',
  'title.zeroSearches': 'Búsquedas sin resultados · {range}',
  'zeroSearches.rate': '{pct} de {n} búsquedas no encontraron nada',
  'zeroSearches.empty': 'Todas las búsquedas encontraron algo',
};

const DICTIONARIES: Record<Locale, Record<AnalyticsKey, string>> = { en, pt, es };

type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export interface AnalyticsStrings {
  /** Chart string for the current locale. */
  a: (key: AnalyticsKey, vars?: Vars) => string;
  /**
   * BCP-47 tag for `Intl`. Taken from the locale's currency config, which
   * already decided that `pt` means pt-BR and `es` means es-MX — the axis
   * separators and the storefront's prices should not disagree about that.
   */
  numberLocale: string;
  /** The active locale, for currency conversion via LOCALE_CURRENCY. */
  locale: Locale;
}

export function useAnalyticsStrings(): AnalyticsStrings {
  const { locale } = useI18n();
  return useMemo(() => {
    const dictionary = DICTIONARIES[locale] ?? en;
    return {
      a: (key, vars) => interpolate(dictionary[key] ?? en[key] ?? key, vars),
      numberLocale: LOCALE_CURRENCY[locale].numberLocale,
      locale,
    };
  }, [locale]);
}
