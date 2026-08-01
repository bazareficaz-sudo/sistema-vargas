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

export function calcularEtapaInterna(status: string | undefined, tags: string[] | undefined, algumItemPendente: boolean): string {
  if (status === 'cancelled' || status === 'invalid') return 'cancelado'
  if ((tags ?? []).includes('delivered')) return 'concluido'
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
    prazo_postagem: null, // idem valor_frete — prazo de postagem vive no shipment, não no pedido
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

  return { totalFound: pedidosBrutos.length, upserted, failed, truncated }
}

// Mesmo motivo/uso da versão Shopee: recalcula etapa_interna a partir do
// estado atual depois de um mapeamento manual feito fora da sincronização.
export async function recalcularEtapaPedido(sb: any, pedidoId: string): Promise<string | null> {
  const { data: pedido } = await sb.from('marketplace_pedidos').select('id, status_externo, dados_brutos').eq('id', pedidoId).single()
  if (!pedido) return null

  const { data: itens } = await sb.from('marketplace_pedido_itens').select('produto_id').eq('pedido_id', pedidoId)
  const algumItemPendente = (itens ?? []).some((i: any) => !i.produto_id)

  const tags = pedido.dados_brutos?.tags as string[] | undefined
  const etapa = calcularEtapaInterna(pedido.status_externo ?? undefined, tags, algumItemPendente)
  await sb.from('marketplace_pedidos').update({ etapa_interna: etapa }).eq('id', pedidoId)
  return etapa
}
