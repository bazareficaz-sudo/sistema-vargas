import { tiktokGet, tiktokPost, getIntegracaoCredentials, refreshAccessTokenIfNeeded } from './client'
import { sincronizarEtapaComCanal } from '@/lib/pedidos/sincronizarEtapa'
import { baixarEstoquePedidoItem } from '@/lib/produtos/estoque'
import type { SyncFailure, SyncResult, TiktokChannel, TiktokOrder } from './types'

export const DEFAULT_MAX_ORDERS = 300
export const DEFAULT_LOOKBACK_DAYS = 15
const PAGE_SIZE = 50

// Status da TikTok Shop (Get Order List) → status interno. O interno segue
// o mesmo critério das outras três integrações: paga/confirma autoriza a
// baixa de estoque, cancelado nunca baixa.
const STATUS_MAP: Record<string, string> = {
  UNPAID: 'novo',
  ON_HOLD: 'novo',
  AWAITING_SHIPMENT: 'confirmado',
  PARTIALLY_SHIPPING: 'confirmado',
  AWAITING_COLLECTION: 'enviado',
  IN_TRANSIT: 'enviado',
  DELIVERED: 'entregue',
  COMPLETED: 'entregue',
  CANCELLED: 'cancelado',
}

// Mesma ordem de prioridade já usada em Shopee/Mercado Livre/Nuvemshop: o
// que já saiu fisicamente manda sobre a pendência de mapeamento, porque a
// etapa descreve onde o pedido ESTÁ, não o que falta cadastrar.
function calcularEtapaInterna(status: string, algumItemPendente: boolean): string {
  if (status === 'CANCELLED') return 'cancelado'
  if (status === 'COMPLETED' || status === 'DELIVERED') return 'concluido'
  if (status === 'IN_TRANSIT' || status === 'AWAITING_COLLECTION') return 'enviado'
  if (algumItemPendente) return 'pendencia_mapeamento'
  if (status === 'AWAITING_SHIPMENT' || status === 'PARTIALLY_SHIPPING') return 'pronto_expedicao'
  return 'novo'
}

function enderecoLinha(raw: TiktokOrder): string | null {
  const end = raw.recipient_address
  if (!end) return null
  if (end.full_address) return end.full_address
  const linha = [end.address_line1, end.address_line2, end.address_line3].filter(Boolean).join(', ')
  return linha || null
}

// Percorre pedidos criados/atualizados a partir de `desde`, uma página por
// vez — mesmo mecanismo de paginação por page_token opaco do catálogo
// (paginarProdutos em catalog.ts), só que via Get Order List
// (/order/202309/orders/search). page_size/page_token vão na query
// (assinada), o filtro de tempo vai no corpo.
export async function* paginarPedidos(
  canal: TiktokChannel,
  opts: { desde?: Date; pageSize?: number; maxPaginas?: number } = {},
): AsyncGenerator<TiktokOrder[]> {
  const { appKey, appSecret } = await getIntegracaoCredentials()
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const maxPaginas = opts.maxPaginas ?? 200

  const body: Record<string, any> = {}
  if (opts.desde) body.update_time_ge = Math.floor(opts.desde.getTime() / 1000)

  let pageToken: string | undefined
  let pagina = 0

  while (pagina < maxPaginas) {
    const extraQuery: Record<string, string | number> = { page_size: pageSize }
    if (pageToken) extraQuery.page_token = pageToken

    const resp = await tiktokPost(
      '/order/202309/orders/search',
      body,
      { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher },
      extraQuery,
    )

    const pedidos: TiktokOrder[] = resp?.data?.orders ?? []
    if (pedidos.length === 0) break

    yield pedidos

    const proximo = resp?.data?.next_page_token
    if (!proximo || pedidos.length < pageSize) break
    pageToken = proximo
    pagina += 1
  }
}

export function mapOrderToPedidoRow(raw: TiktokOrder, canal: TiktokChannel, algumItemPendente: boolean): Record<string, any> {
  const end = raw.recipient_address ?? {}
  const status = raw.status ?? ''
  const pagamento = raw.payment ?? {}

  return {
    empresa_id: canal.empresaId,
    canal_id: canal.id,
    id_externo: String(raw.id),
    numero_pedido: String(raw.id),
    cliente_nome: end.name ? String(end.name).trim() || null : null,
    entrega_cep: end.postal_code ?? null,
    entrega_logradouro: enderecoLinha(raw),
    entrega_bairro: end.district ?? null,
    entrega_cidade: end.city ?? end.town ?? null,
    entrega_estado: end.state ?? null,
    valor_produtos: Number(pagamento.sub_total ?? 0),
    valor_frete: Number(pagamento.shipping_fee ?? 0),
    valor_desconto: Number(pagamento.seller_discount ?? 0) + Number(pagamento.platform_discount ?? 0),
    valor_total: Number(pagamento.total_amount ?? 0),
    status: STATUS_MAP[status] ?? 'novo',
    status_externo: status || null,
    etapa_interna: calcularEtapaInterna(status, algumItemPendente),
    data_pedido: raw.create_time ? new Date(raw.create_time * 1000).toISOString() : new Date().toISOString(),
    dados_brutos: raw,
    ultima_sincronizacao: new Date().toISOString(),
    erro_sincronizacao: null,
    updated_at: new Date().toISOString(),
  }
  // Deliberadamente ausentes: transportadora, codigo_rastreio, observacoes,
  // pendencia_motivo, nfe_*. Mesma decisão de Shopee/ML/Nuvemshop — são
  // campos que o operador edita à mão, sync não pode apagar essa edição.
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

// A sincronização de catálogo (sync.ts) ainda não grava
// marketplace_anuncio_variacoes para a TikTok — resolve só no nível do
// anúncio (produto), mesmo tratamento que Shopee/Nuvemshop dão a produto
// de variação única. Quando a criação de variações existir, dá pra evoluir
// aqui do mesmo jeito.
async function resolverVinculoItem(
  sb: any, canalId: string, produtoIdExterno: string,
): Promise<{ anuncioId: string | null; produtoId: string | null }> {
  const { data: anuncio } = await sb.from('marketplace_anuncios')
    .select('id, produto_id')
    .eq('canal_id', canalId).eq('id_externo', produtoIdExterno)
    .maybeSingle()
  if (!anuncio) return { anuncioId: null, produtoId: null }
  return { anuncioId: anuncio.id, produtoId: anuncio.produto_id }
}

async function upsertItemPedido(
  sb: any, pedidoId: string,
  item: { itemIdExterno: string; modelIdExterno: string | null; nomeProduto: string; sku: string | null; quantidade: number; precoUnitario: number },
  vinculo: { anuncioId: string | null; produtoId: string | null },
): Promise<{ id: string }> {
  let query = sb.from('marketplace_pedido_itens').select('id')
    .eq('pedido_id', pedidoId).eq('item_id_externo', item.itemIdExterno)
  query = item.modelIdExterno ? query.eq('model_id_externo', item.modelIdExterno) : query.is('model_id_externo', null)
  const { data: existente } = await query.maybeSingle()

  const campos = {
    anuncio_id: vinculo.anuncioId,
    nome_produto: item.nomeProduto,
    sku: item.sku,
    quantidade: item.quantidade,
    preco_unitario: item.precoUnitario,
    subtotal: item.precoUnitario * item.quantidade,
  }

  // Nunca um upsert genérico: reescreveria produto_id, status_mapeamento e
  // baixou_estoque, que são estado local já processado.
  if (existente) {
    await sb.from('marketplace_pedido_itens').update(campos).eq('id', existente.id)
    return { id: existente.id }
  }

  const { data: criado, error } = await sb.from('marketplace_pedido_itens').insert({
    pedido_id: pedidoId,
    item_id_externo: item.itemIdExterno,
    model_id_externo: item.modelIdExterno,
    produto_id: vinculo.produtoId,
    status_mapeamento: vinculo.produtoId ? 'mapeado' : 'pendente',
    baixou_estoque: false,
    ...campos,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return { id: criado.id }
}

export async function processarPedido(
  sb: any, canal: TiktokChannel, raw: TiktokOrder,
): Promise<{ pedidoId: string; algumItemPendente: boolean }> {
  const itensRaw: any[] = raw?.line_items ?? []

  const vinculos: {
    raw: any; itemIdExterno: string; modelIdExterno: string | null
    vinculo: { anuncioId: string | null; produtoId: string | null }
  }[] = []

  for (const it of itensRaw) {
    const itemIdExterno = String(it?.id ?? '')
    const modelIdExterno = it?.sku_id != null ? String(it.sku_id) : null
    const produtoIdExterno = it?.product_id != null ? String(it.product_id) : ''
    const vinculo = produtoIdExterno
      ? await resolverVinculoItem(sb, canal.id, produtoIdExterno)
      : { anuncioId: null, produtoId: null }
    vinculos.push({ raw: it, itemIdExterno, modelIdExterno, vinculo })
  }

  const algumItemPendente = vinculos.some(v => !v.vinculo.produtoId)

  const row = mapOrderToPedidoRow(raw, canal, algumItemPendente)
  const pedido = await upsertPedido(sb, row)

  await sincronizarEtapaComCanal(sb, {
    pedidoId: pedido.id, empresaId: canal.empresaId, statusCanal: String(row.status ?? ''),
  })

  const debitaEstoque = canal.sincronizarEstoque !== false && canal.debitarEstoqueVendas !== false
  const deveBaixar = debitaEstoque && row.status !== 'novo' && row.status !== 'cancelado'

  for (const v of vinculos) {
    if (!v.itemIdExterno) continue
    const { id: itemId } = await upsertItemPedido(sb, pedido.id, {
      itemIdExterno: v.itemIdExterno,
      modelIdExterno: v.modelIdExterno,
      nomeProduto: v.raw?.product_name ?? `Item ${v.itemIdExterno}`,
      sku: v.raw?.seller_sku ? String(v.raw.seller_sku) : null,
      quantidade: Number(v.raw?.quantity ?? 1),
      precoUnitario: Number(v.raw?.sale_price ?? 0),
    }, v.vinculo)

    if (deveBaixar && v.vinculo.produtoId) {
      await baixarEstoquePedidoItem(sb, itemId)
    }
  }

  return { pedidoId: pedido.id, algumItemPendente }
}

export async function syncSinglePedido(
  sb: any, canalInicial: TiktokChannel, orderId: string,
): Promise<{ ok: true; pedidoId: string } | { ok: false; error: string }> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const { appKey, appSecret } = await getIntegracaoCredentials()
    const resp = await tiktokGet(
      '/order/202507/orders',
      { ids: `["${orderId}"]` },
      { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher },
    )
    const raw = (resp?.data?.orders ?? [])[0]
    if (!raw) return { ok: false, error: 'Pedido não encontrado na TikTok Shop' }
    const { pedidoId } = await processarPedido(sb, canal, raw)
    return { ok: true, pedidoId }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao sincronizar pedido' }
  }
}

/**
 * Sincroniza pedidos por janela de ÚLTIMA ATUALIZAÇÃO, não de criação —
 * mesmo critério de Shopee/Mercado Livre/Nuvemshop: pega mudança de status
 * (pagamento, envio) em pedido criado antes da janela, sem reprocessar tudo.
 */
export async function syncPedidos(
  sb: any, canalInicial: TiktokChannel, opts: { maxOrders?: number; desde?: Date } = {},
): Promise<SyncResult> {
  const maxOrders = opts.maxOrders ?? DEFAULT_MAX_ORDERS
  const desde = opts.desde ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)

  const brutos: TiktokOrder[] = []
  let truncated = false

  paginacao: for await (const pagina of paginarPedidos(canal, { desde })) {
    for (const pedido of pagina) {
      if (brutos.length >= maxOrders) { truncated = true; break paginacao }
      brutos.push(pedido)
    }
  }

  if (brutos.length === 0) return { totalFound: 0, upserted: 0, failed: [], truncated: false }

  const failed: SyncFailure[] = []
  let upserted = 0

  for (const rawOrder of brutos) {
    try {
      await processarPedido(sb, canal, rawOrder)
      upserted++
    } catch (e: any) {
      failed.push({ itemId: String(rawOrder?.id ?? '?'), error: e?.message ?? 'Erro ao processar pedido' })
    }
  }

  return { totalFound: brutos.length, upserted, failed, truncated }
}
