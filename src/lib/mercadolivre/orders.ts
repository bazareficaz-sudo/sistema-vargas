import { mlGet, refreshAccessTokenIfNeeded } from './client'
import { sincronizarEtapaComCanal } from '@/lib/pedidos/sincronizarEtapa'
import { sleep, THROTTLE_MS } from './catalog'
import { baixarEstoquePedidoItem } from '@/lib/produtos/estoque'
import type { MLChannel, SyncFailure, SyncResult } from './types'

// Confiança moderada — validado contra a doc pública do Mercado Livre e um
// exemplo real de resposta (gist de terceiro), não contra doc oficial
// completa (mesmos bloqueios de acesso já enfrentados no restante da
// integração ML). Diferente da Shopee, /orders/search já retorna o pedido
// COMPLETO em `results` — não existe um segundo passo de "detalhe em lote".
export const ORDER_PAGE_SIZE = 50
export const DEFAULT_MAX_ORDERS = 200
export const DEFAULT_LOOKBACK_DAYS = 15
const OFFSET_MAX = 1000 // mesmo teto do catálogo — /search não pagina além disso

type CallCtx = { sb: any; canal: MLChannel }

// Pagina /orders/search por período de ÚLTIMA ATUALIZAÇÃO (date_last_updated),
// não de criação — mesmo princípio já usado pela Shopee (time_range_field:
// 'update_time'). É o que permite pegar mudança de status (ex: pagamento
// confirmado) em pedidos criados antes da janela de busca, sem precisar
// escanear tudo de novo a cada sincronização. Cada página já traz pedidos
// completos (order_items, buyer, shipping...), então não há chamada de
// detalhe separada como na Shopee.
export async function* searchOrders(
  ctx: CallCtx,
  opts: { fromIso: string; toIso: string; pageSize?: number }
): AsyncGenerator<any[]> {
  const pageSize = opts.pageSize ?? ORDER_PAGE_SIZE
  let offset = 0

  while (true) {
    const data = await mlGet('/orders/search', {
      seller: ctx.canal.sellerId,
      'order.date_last_updated.from': opts.fromIso,
      'order.date_last_updated.to': opts.toIso,
      sort: 'date_desc',
      offset,
      limit: pageSize,
    }, ctx.canal.accessToken)

    const resultados: any[] = data?.results ?? []
    if (resultados.length === 0) break

    yield resultados
    await sleep(THROTTLE_MS)

    const total = data?.paging?.total ?? 0
    offset += resultados.length
    if (offset >= total || offset >= OFFSET_MAX) break
  }
}

// order.status do ML é sobre PAGAMENTO, não sobre envio (diferente do
// order_status da Shopee, que já mistura os dois). Sem uma chamada extra a
// /shipments/{id} não dá pra saber "enviado"/"entregue" com confiança — fica
// como limitação conhecida desta fase (mesmo princípio de não fingir dado
// que não existe). `tags` às vezes traz "delivered", aproveitado quando
// presente, mas não é garantido pela doc.
const ORDER_STATUS_TO_STATUS: Record<string, string> = {
  confirmed: 'novo',
  payment_required: 'novo',
  payment_in_process: 'novo',
  partially_paid: 'novo',
  paid: 'confirmado',
  cancelled: 'cancelado',
  invalid: 'cancelado',
}
function mapStatus(status?: string): string {
  return ORDER_STATUS_TO_STATUS[status ?? ''] ?? 'novo'
}

export function calcularEtapaInterna(status: string | undefined, tags: string[] | undefined, algumItemPendente: boolean, envioStatus?: string | null): string {
  if (status === 'cancelled' || status === 'invalid') return 'cancelado'
  if ((tags ?? []).includes('delivered') || envioStatus === 'delivered') return 'concluido'
  if (envioStatus === 'shipped') return 'enviado'
  if (algumItemPendente) return 'pendencia_mapeamento'
  if (status === 'paid') return 'pronto_expedicao'
  return 'novo'
}

function nomeComprador(buyer: any): string | null {
  if (!buyer) return null
  const nome = [buyer.first_name, buyer.last_name].filter(Boolean).join(' ').trim()
  return nome || buyer.nickname || null
}

// city/state às vezes vêm como string simples, às vezes como {id, name} —
// tratado defensivamente, mesmo princípio já usado no mapeamento de item.
function nomeOuTexto(valor: any): string | null {
  if (!valor) return null
  return typeof valor === 'string' ? valor : (valor.name ?? null)
}

function mapOrderToPedidoRow(rawOrder: any, canal: MLChannel, algumItemPendente: boolean): Record<string, any> {
  const status = rawOrder.status as string | undefined
  const addr = rawOrder.shipping?.receiver_address ?? {}
  const tags: string[] = rawOrder.tags ?? []

  return {
    empresa_id: canal.empresaId,
    canal_id: canal.id,
    id_externo: String(rawOrder.id),
    numero_pedido: String(rawOrder.id),
    cliente_nome: nomeComprador(rawOrder.buyer),
    entrega_cep: addr.zip_code ?? null,
    entrega_logradouro: addr.address_line ?? ([addr.street_name, addr.street_number].filter(Boolean).join(', ') || null),
    entrega_bairro: nomeOuTexto(addr.neighborhood),
    entrega_cidade: nomeOuTexto(addr.city),
    entrega_estado: nomeOuTexto(addr.state),
    valor_produtos: (rawOrder.order_items ?? []).reduce((soma: number, it: any) => soma + Number(it.unit_price ?? 0) * Number(it.quantity ?? 1), 0),
    valor_frete: 0, // custo de frete vive no recurso /shipments/{id}, não no pedido — não buscado nesta fase
    valor_total: Number(rawOrder.total_amount ?? 0),
    status: mapStatus(status),
    status_externo: status ?? null,
    etapa_interna: calcularEtapaInterna(status, tags, algumItemPendente),
    data_pedido: rawOrder.date_created ?? new Date().toISOString(),
    data_envio: tags.includes('delivered') && rawOrder.date_closed ? rawOrder.date_closed : null,
    // prazo_postagem e envio_* NÃO vão aqui: vivem no shipment e são
    // acrescentados por aplicarEnvio() só quando consultados — mandar null
    // apagaria o prazo já gravado a cada re-sync.
    dados_brutos: rawOrder,
    ultima_sincronizacao: new Date().toISOString(),
    erro_sincronizacao: null,
    updated_at: new Date().toISOString(),
  }
  // Deliberadamente NÃO inclui: transportadora, codigo_rastreio, observacoes,
  // pendencia_motivo, nfe_*. Mesmos campos editados manualmente pelo operador
  // que o upsert da Shopee já preserva — incluir aqui apagaria essas edições
  // a cada re-sync.
}

async function upsertPedido(sb: any, row: Record<string, any>): Promise<{ id: string }> {
  const { data, error } = await sb
    .from('marketplace_pedidos')
    .upsert(row, { onConflict: 'canal_id,id_externo' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data
}

// Mesmo princípio de resolução por FK direta já usado pela Shopee — não via
// marketplace_mapeamentos (keyed por SKU-texto, serve só ao aprendizado do
// sync de catálogo).
async function resolverVinculoItem(
  sb: any, canalId: string, itemIdExterno: string, modelIdExterno: string | null
): Promise<{ anuncioId: string | null; produtoId: string | null }> {
  const { data: anuncio } = await sb.from('marketplace_anuncios')
    .select('id, produto_id')
    .eq('canal_id', canalId).eq('id_externo', itemIdExterno)
    .maybeSingle()
  if (!anuncio) return { anuncioId: null, produtoId: null }
  if (!modelIdExterno) return { anuncioId: anuncio.id, produtoId: anuncio.produto_id }

  const { data: variacao } = await sb.from('marketplace_anuncio_variacoes')
    .select('produto_id')
    .eq('anuncio_id', anuncio.id).eq('model_id', modelIdExterno)
    .maybeSingle()
  return { anuncioId: anuncio.id, produtoId: variacao?.produto_id ?? null }
}

// Upsert de item preservando estado local — mesmo princípio da Shopee: nunca
// um upsert genérico que reescreveria produto_id/status_mapeamento/
// baixou_estoque já processados localmente.
async function upsertItemPedido(
  sb: any, pedidoId: string,
  item: { itemIdExterno: string; modelIdExterno: string | null; nomeProduto: string; sku: string | null; quantidade: number; precoUnitario: number },
  vinculo: { anuncioId: string | null; produtoId: string | null }
): Promise<{ id: string }> {
  let query = sb.from('marketplace_pedido_itens').select('id')
    .eq('pedido_id', pedidoId).eq('item_id_externo', item.itemIdExterno)
  query = item.modelIdExterno ? query.eq('model_id_externo', item.modelIdExterno) : query.is('model_id_externo', null)
  const { data: existente } = await query.maybeSingle()

  const camposML = {
    anuncio_id: vinculo.anuncioId,
    nome_produto: item.nomeProduto,
    sku: item.sku,
    quantidade: item.quantidade,
    preco_unitario: item.precoUnitario,
    subtotal: item.precoUnitario * item.quantidade,
  }

  if (existente) {
    await sb.from('marketplace_pedido_itens').update(camposML).eq('id', existente.id)
    return { id: existente.id }
  }

  const { data: criado, error } = await sb.from('marketplace_pedido_itens').insert({
    pedido_id: pedidoId,
    item_id_externo: item.itemIdExterno,
    model_id_externo: item.modelIdExterno,
    produto_id: vinculo.produtoId,
    status_mapeamento: vinculo.produtoId ? 'mapeado' : 'pendente',
    baixou_estoque: false,
    ...camposML,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return { id: criado.id }
}

// ── ENVIO (shipment) ───────────────────────────────────────────────────────
//
// O pedido do ML só fala de pagamento. O que a esteira de pedidos precisa —
// nota pendente, etiqueta pronta, etiqueta impressa, enviado, entregue, e o
// prazo de postagem — vive em /shipments/{id}:
//   status/substatus: ready_to_ship + invoice_pending | ready_to_print |
//                     printed | ...; shipped; delivered (doc "Shipments")
//   /shipments/{id}/sla → expected_date: data e hora limite para despachar
//                     o pacote (doc "Shipment SLA"). O estimated_handling_limit
//                     que a doc de shipments cita não vem nas respostas reais
//                     do lead_time (conferido em 30/09/2026).

// Depois disto o shipment não muda mais de um jeito que importe à esteira.
const ENVIO_FINAL = new Set(['shipped', 'delivered', 'not_delivered', 'cancelled'])

type EnvioML = {
  envio_status: string | null; envio_substatus: string | null; envio_atualizado_em: string
  prazo_postagem?: string
  // O que o ML devolveu (shipment e lead_time) — para conferir prazo,
  // modalidade e rastreio sem precisar consultar o canal de novo.
  envio_dados?: Record<string, any>
}

// "2026-10-01T00:00:00.000-03:00" → fim desse dia em Brasília.
function fimDoDiaBrasilia(dataIso: string): string | undefined {
  const dia = String(dataIso).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return undefined
  return new Date(`${dia}T23:59:59-03:00`).toISOString()
}

export async function buscarEnvio(canal: MLChannel, shippingId: string | number, precisaPrazo: boolean): Promise<EnvioML> {
  const sh = await mlGet(`/shipments/${shippingId}`, {}, canal.accessToken, { 'x-format-new': 'true' })
  const envio: EnvioML = {
    envio_status: sh?.status ?? null,
    envio_substatus: sh?.substatus ?? null,
    envio_atualizado_em: new Date().toISOString(),
    envio_dados: { shipment: sh },
  }
  // O limite de despacho pode vir no próprio shipment (formato antigo:
  // shipping_option; novo: lead_time) ou só no recurso /lead_time.
  const limiteNoShipment = sh?.lead_time?.estimated_handling_limit?.date
    ?? sh?.shipping_option?.estimated_handling_limit?.date
  if (limiteNoShipment) envio.prazo_postagem = fimDoDiaBrasilia(limiteNoShipment)

  if (precisaPrazo && !envio.prazo_postagem && !ENVIO_FINAL.has(envio.envio_status ?? '')) {
    // Sem prazo o pedido só cai como "sai hoje" — falhar aqui não pode
    // derrubar o pedido. O erro fica guardado em envio_dados para diagnóstico.
    try {
      const sla = await mlGet(`/shipments/${shippingId}/sla`, {}, canal.accessToken)
      envio.envio_dados!.sla = sla
      const limite = sla?.expected_date ? new Date(sla.expected_date) : null
      if (limite && !isNaN(limite.getTime())) envio.prazo_postagem = limite.toISOString()
    } catch (e: any) {
      envio.envio_dados!.sla_erro = e?.message ?? String(e)
    }
  }
  return envio
}

// Leva o que o shipment disse para a linha do pedido: situação do envio,
// prazo e — quando o pacote já saiu ou chegou — o status do pedido, que
// antes ficava "confirmado" para sempre no ML.
function aplicarEnvio(row: Record<string, any>, envio: EnvioML, tags: string[], algumItemPendente: boolean): void {
  row.envio_status = envio.envio_status
  row.envio_substatus = envio.envio_substatus
  row.envio_atualizado_em = envio.envio_atualizado_em
  if (envio.prazo_postagem) row.prazo_postagem = envio.prazo_postagem
  if (envio.envio_dados) row.envio_dados = envio.envio_dados
  // DESTINATÁRIO E ENDEREÇO: o pedido do ML só traz o apelido do comprador
  // (THIAGO1011) e nenhum endereço; o shipment traz o nome de quem recebe e
  // para onde vai. Em entrega na agência do ML, o endereço é o da agência —
  // marcado no logradouro para ninguém achar que é a casa do cliente.
  const destino = envio.envio_dados?.shipment?.destination
  const end = destino?.shipping_address
  if (destino?.receiver_name) row.cliente_nome = String(destino.receiver_name).trim()
  if (end) {
    const naAgencia = destino?.type === 'agency'
    row.entrega_cidade = end.city?.name ?? null
    row.entrega_estado = String(end.state?.id ?? '').replace(/^BR-/, '') || end.state?.name || null
    row.entrega_cep = end.zip_code ?? null
    row.entrega_logradouro = naAgencia
      ? `Retirada na agência: ${end.agency?.description ?? end.street_name ?? ''}`.trim()
      : (end.street_name ?? end.address_line ?? null)
    row.entrega_numero = naAgencia ? null : (end.street_number ?? null)
    row.entrega_bairro = end.neighborhood?.name ?? null
  }
  if (row.status === 'confirmado') {
    if (envio.envio_status === 'shipped') row.status = 'enviado'
    if (envio.envio_status === 'delivered') row.status = 'entregue'
  }
  row.etapa_interna = calcularEtapaInterna(row.status_externo ?? undefined, tags, algumItemPendente, envio.envio_status)
}

// Consulta o shipment de um pedido pago ainda não finalizado. Falha de
// shipment é isolada: o pedido segue gravado com o que se sabia antes.
async function envioDoPedido(sb: any, canal: MLChannel, rawOrder: any): Promise<EnvioML | null> {
  const shippingId = rawOrder.shipping?.id

  const { data: atual } = await sb.from('marketplace_pedidos')
    .select('prazo_postagem, envio_status, envio_substatus, envio_atualizado_em, envio_dados')
    .eq('canal_id', canal.id).eq('id_externo', String(rawOrder.id))
    .maybeSingle()
  // O que já está gravado é REAPLICADO quando não há consulta nova: o upsert
  // do pedido devolveria o status para "confirmado" e trocaria nome e
  // endereço do destinatário pelo apelido e por vazio.
  const gravado: EnvioML | null = atual?.envio_status || atual?.envio_dados ? {
    envio_status: atual.envio_status ?? null, envio_substatus: atual.envio_substatus ?? null,
    envio_atualizado_em: atual.envio_atualizado_em ?? new Date().toISOString(),
    ...(atual.envio_dados ? { envio_dados: atual.envio_dados } : {}),
  } : null
  if (!shippingId || rawOrder.status !== 'paid') return gravado
  if ((rawOrder.tags ?? []).includes('delivered')) return gravado
  if (gravado && ENVIO_FINAL.has(gravado.envio_status ?? '')) return gravado

  try {
    return await buscarEnvio(canal, shippingId, !atual?.prazo_postagem)
  } catch {
    return gravado
  }
}

// Pedidos em aberto cujo pedido NÃO mudou (então não voltam no
// /orders/search), mas cujo envio pode ter mudado — nota aceita, etiqueta
// impressa em outro sistema, pacote postado. Uma fatia por rodada, os mais
// desatualizados primeiro.
export async function atualizarEnviosEmAberto(sb: any, canal: MLChannel, limite = 30): Promise<number> {
  const trintaDias = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const cincoMin = new Date(Date.now() - 5 * 60_000).toISOString()
  const { data: abertos } = await sb.from('marketplace_pedidos')
    .select('id, status, status_externo, prazo_postagem, envio_status, dados_brutos')
    .eq('canal_id', canal.id).eq('status', 'confirmado')
    .gte('data_pedido', trintaDias)
    .or(`envio_atualizado_em.is.null,envio_atualizado_em.lt.${cincoMin}`)
    .order('envio_atualizado_em', { ascending: true, nullsFirst: true })
    .limit(limite)

  let atualizados = 0
  for (const p of abertos ?? []) {
    const shippingId = p.dados_brutos?.shipping?.id
    if (!shippingId) continue
    try {
      const envio = await buscarEnvio(canal, shippingId, !p.prazo_postagem)
      const { data: itens } = await sb.from('marketplace_pedido_itens').select('produto_id').eq('pedido_id', p.id)
      const row: Record<string, any> = { status: p.status, status_externo: p.status_externo }
      aplicarEnvio(row, envio, p.dados_brutos?.tags ?? [], (itens ?? []).some((i: any) => !i.produto_id))
      await sb.from('marketplace_pedidos').update(row).eq('id', p.id)
      if (row.status !== p.status) {
        await sincronizarEtapaComCanal(sb, { pedidoId: p.id, empresaId: canal.empresaId, statusCanal: row.status })
      }
      atualizados++
      await sleep(THROTTLE_MS)
    } catch { /* tenta de novo na próxima rodada */ }
  }
  return atualizados
}

// Processa um pedido já buscado (search já traz completo). Reaproveitado por
// syncPedidos (lote) e syncSinglePedido.
export async function processRawOrder(
  sb: any, canal: MLChannel, rawOrder: any
): Promise<{ pedidoId: string; algumItemPendente: boolean }> {
  const itensRaw: any[] = rawOrder.order_items ?? []

  const vinculos: { raw: any; itemIdExterno: string; modelIdExterno: string | null; vinculo: { anuncioId: string | null; produtoId: string | null } }[] = []
  for (const it of itensRaw) {
    const itemIdExterno = String(it.item?.id)
    const modelIdExterno = it.item?.variation_id ? String(it.item.variation_id) : null
    const vinculo = await resolverVinculoItem(sb, canal.id, itemIdExterno, modelIdExterno)
    vinculos.push({ raw: it, itemIdExterno, modelIdExterno, vinculo })
  }
  const algumItemPendente = vinculos.some(v => !v.vinculo.produtoId)

  const row = mapOrderToPedidoRow(rawOrder, canal, algumItemPendente)
  const envio = await envioDoPedido(sb, canal, rawOrder)
  if (envio) aplicarEnvio(row, envio, rawOrder.tags ?? [], algumItemPendente)
  const pedido = await upsertPedido(sb, row)

  // Etapa operacional acompanha o canal — só para a frente, nunca apagando
  // o que a operação já registrou.
  await sincronizarEtapaComCanal(sb, {
    pedidoId: pedido.id, empresaId: canal.empresaId, statusCanal: String(row.status ?? ''),
  })

  // Baixa automática pros itens mapeados assim que o pagamento é confirmado
  // ('confirmado' = status.paid) — mesmo critério e mesma ausência de fase
  // de reserva já usados pela Shopee.
  const debitaEstoque = canal.sincronizarEstoque !== false && canal.debitarEstoqueVendas !== false
  const deveBaixar = debitaEstoque && row.status !== 'novo' && row.status !== 'cancelado'
  for (const v of vinculos) {
    const precoUnitario = Number(v.raw.unit_price ?? 0)
    const quantidade = Number(v.raw.quantity ?? 1)
    const { id: itemId } = await upsertItemPedido(sb, pedido.id, {
      itemIdExterno: v.itemIdExterno,
      modelIdExterno: v.modelIdExterno,
      nomeProduto: v.raw.item?.title ?? `Item ${v.itemIdExterno}`,
      sku: v.raw.item?.seller_sku ?? v.raw.item?.seller_custom_field ?? null,
      quantidade,
      precoUnitario,
    }, v.vinculo)

    if (deveBaixar && v.vinculo.produtoId) {
      await baixarEstoquePedidoItem(sb, itemId)
    }
  }

  return { pedidoId: pedido.id, algumItemPendente }
}

export async function syncSinglePedido(
  sb: any, canalInicial: MLChannel, orderId: string
): Promise<{ ok: true; pedidoId: string } | { ok: false; error: string }> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const rawOrder = await mlGet(`/orders/${orderId}`, {}, canal.accessToken)
    if (!rawOrder?.id) return { ok: false, error: 'Pedido não encontrado no Mercado Livre' }
    const { pedidoId } = await processRawOrder(sb, canal, rawOrder)
    return { ok: true, pedidoId }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao sincronizar pedido' }
  }
}

// Orquestra a sincronização completa: pagina /orders/search por período →
// processa cada pedido (já completo). Falha por pedido fica isolada; só
// falha de token/credenciais propaga pro nível do canal.
export async function syncPedidos(
  sb: any, canalInicial: MLChannel, opts: { maxOrders?: number; desde?: Date } = {}
): Promise<SyncResult> {
  const maxOrders = opts.maxOrders ?? DEFAULT_MAX_ORDERS
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const ctx = { sb, canal }

  const agora = new Date()
  const desde = opts.desde ?? new Date(agora.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const pedidosBrutos: any[] = []
  let truncated = false

  paginacao: for await (const pagina of searchOrders(ctx, { fromIso: desde.toISOString(), toIso: agora.toISOString() })) {
    for (const pedido of pagina) {
      if (pedidosBrutos.length >= maxOrders) { truncated = true; break paginacao }
      pedidosBrutos.push(pedido)
    }
  }

  if (pedidosBrutos.length === 0) {
    try { await atualizarEnviosEmAberto(sb, canal) } catch { /* próxima rodada */ }
    return { totalFound: 0, upserted: 0, failed: [], truncated: false }
  }

  const failed: SyncFailure[] = []
  let upserted = 0

  for (const rawOrder of pedidosBrutos) {
    try {
      await processRawOrder(sb, canal, rawOrder)
      upserted++
    } catch (e: any) {
      failed.push({ itemId: String(rawOrder.id ?? '?'), error: e?.message ?? 'Erro desconhecido ao processar pedido' })
    }
  }

  // Envios de pedidos que não mudaram nesta janela — não pode derrubar o sync.
  try { await atualizarEnviosEmAberto(sb, canal) } catch { /* próxima rodada */ }

  return { totalFound: pedidosBrutos.length, upserted, failed, truncated }
}

// Mesmo motivo/uso da versão Shopee: recalcula etapa_interna a partir do
// estado atual depois de um mapeamento manual feito fora da sincronização.
export async function recalcularEtapaPedido(sb: any, pedidoId: string): Promise<string | null> {
  const { data: pedido } = await sb.from('marketplace_pedidos').select('id, status_externo, envio_status, dados_brutos').eq('id', pedidoId).single()
  if (!pedido) return null

  const { data: itens } = await sb.from('marketplace_pedido_itens').select('produto_id').eq('pedido_id', pedidoId)
  const algumItemPendente = (itens ?? []).some((i: any) => !i.produto_id)

  const tags = pedido.dados_brutos?.tags as string[] | undefined
  const etapa = calcularEtapaInterna(pedido.status_externo ?? undefined, tags, algumItemPendente, pedido.envio_status)
  await sb.from('marketplace_pedidos').update({ etapa_interna: etapa }).eq('id', pedidoId)
  return etapa
}
