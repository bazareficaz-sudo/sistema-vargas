import { getIntegracaoCredentials, refreshAccessTokenIfNeeded, shopeeGet } from './client'
import { sleep, THROTTLE_MS } from './catalog'
import { baixarEstoquePedidoItem } from '@/lib/produtos/estoque'
import type { ShopeeChannel, SyncFailure, SyncResult } from './types'

// Valores conservadores — limites exatos de página/lote e a janela máxima de
// tempo por chamada não foram confirmados contra a documentação oficial no
// momento da implementação (mesma ressalva já feita em catalog.ts/sync.ts).
// Ajustar depois de validar com respostas reais gravadas em `dados_brutos`.
export const ORDER_LIST_PAGE_SIZE = 50
export const ORDER_DETAIL_BATCH_SIZE = 50
export const DEFAULT_MAX_ORDERS = 200
export const DEFAULT_LOOKBACK_DAYS = 15

const RESPONSE_OPTIONAL_FIELDS = [
  'buyer_username', 'recipient_address', 'item_list', 'package_list', 'order_status',
  'total_amount', 'currency', 'create_time', 'update_time', 'ship_by_date',
  'estimated_shipping_fee', 'actual_shipping_fee', 'payment_method', 'note',
].join(',')

type CallCtx = { sb: any; canal: ShopeeChannel }

async function callOpts(ctx: CallCtx) {
  const { partnerId, partnerKey } = await getIntegracaoCredentials(ctx.sb)
  return { partnerId, partnerKey, accessToken: ctx.canal.accessToken, shopId: ctx.canal.sellerId }
}

// Gera páginas de order_sn por período (get_order_list é paginado por cursor,
// não por offset como o catálogo). Defensivo: para quando a página vier
// vazia ou quando `more`/`next_cursor` não indicarem continuação.
export async function* listOrderSns(
  ctx: CallCtx,
  opts: { timeFrom: number; timeTo: number; pageSize?: number }
): AsyncGenerator<string[]> {
  const pageSize = opts.pageSize ?? ORDER_LIST_PAGE_SIZE
  const callOptions = await callOpts(ctx)
  let cursor = ''

  while (true) {
    const data = await shopeeGet(
      '/api/v2/order/get_order_list',
      {
        time_range_field: 'update_time',
        time_from: opts.timeFrom,
        time_to: opts.timeTo,
        page_size: pageSize,
        cursor,
      },
      callOptions
    )
    const lista: { order_sn: string }[] = data?.response?.order_list ?? []
    if (lista.length === 0) break

    yield lista.map(o => o.order_sn)
    await sleep(THROTTLE_MS)

    const more = data?.response?.more
    const nextCursor = data?.response?.next_cursor
    if (!more || !nextCursor) break
    cursor = nextCursor
  }
}

export async function getOrderDetailBatch(ctx: CallCtx, orderSns: string[]): Promise<any[]> {
  const callOptions = await callOpts(ctx)
  const resultados: any[] = []

  for (let i = 0; i < orderSns.length; i += ORDER_DETAIL_BATCH_SIZE) {
    const lote = orderSns.slice(i, i + ORDER_DETAIL_BATCH_SIZE)
    const data = await shopeeGet(
      '/api/v2/order/get_order_detail',
      { order_sn_list: lote.join(','), response_optional_fields: RESPONSE_OPTIONAL_FIELDS },
      callOptions
    )
    resultados.push(...(data?.response?.order_list ?? []))
    await sleep(THROTTLE_MS)
  }

  return resultados
}

const ORDER_STATUS_TO_STATUS: Record<string, string> = {
  UNPAID: 'novo',
  READY_TO_SHIP: 'confirmado',
  PROCESSED: 'confirmado',
  RETRY_SHIP: 'confirmado',
  INVOICE_PENDING: 'confirmado',
  SHIPPED: 'enviado',
  TO_CONFIRM_RECEIVE: 'enviado',
  COMPLETED: 'entregue',
  IN_CANCEL: 'cancelado',
  CANCELLED: 'cancelado',
}
function mapStatus(orderStatus?: string): string {
  return ORDER_STATUS_TO_STATUS[orderStatus ?? ''] ?? 'novo'
}

// etapa_interna é o fluxo operacional NOSSO — não é uma tradução 1:1 do
// status da Shopee. Pendência de mapeamento tem prioridade sobre o avanço
// normal do fluxo (não faz sentido considerar "pronto pra expedição" um
// pedido com item sem produto vinculado).
function calcularEtapaInterna(orderStatus: string | undefined, algumItemPendente: boolean): string {
  if (orderStatus === 'CANCELLED' || orderStatus === 'IN_CANCEL') return 'cancelado'
  if (orderStatus === 'COMPLETED') return 'concluido'
  if (orderStatus === 'SHIPPED' || orderStatus === 'TO_CONFIRM_RECEIVE') return 'enviado'
  if (algumItemPendente) return 'pendencia_mapeamento'
  if (orderStatus === 'READY_TO_SHIP' || orderStatus === 'PROCESSED') return 'pronto_expedicao'
  return 'novo'
}

function somaItens(itemList: any[]): number {
  return (itemList ?? []).reduce((soma, it) => {
    const preco = Number(it.model_discounted_price ?? it.model_original_price ?? 0)
    const qtd = Number(it.model_quantity_purchased ?? 1)
    return soma + preco * qtd
  }, 0)
}

function mapOrderToPedidoRow(rawOrder: any, canal: ShopeeChannel, algumItemPendente: boolean): Record<string, any> {
  const addr = rawOrder.recipient_address ?? {}
  const orderStatus = rawOrder.order_status as string | undefined

  return {
    empresa_id: canal.empresaId,
    canal_id: canal.id,
    id_externo: rawOrder.order_sn,
    numero_pedido: rawOrder.order_sn,
    cliente_nome: addr.name ?? rawOrder.buyer_username ?? null,
    entrega_cep: addr.zipcode ?? null,
    entrega_logradouro: addr.full_address ?? null,
    entrega_bairro: addr.district ?? null,
    entrega_cidade: addr.city ?? null,
    entrega_estado: addr.state ?? null,
    valor_produtos: somaItens(rawOrder.item_list),
    valor_frete: Number(rawOrder.actual_shipping_fee ?? rawOrder.estimated_shipping_fee ?? 0),
    valor_total: Number(rawOrder.total_amount ?? 0),
    status: mapStatus(orderStatus),
    status_externo: orderStatus ?? null,
    etapa_interna: calcularEtapaInterna(orderStatus, algumItemPendente),
    data_pedido: rawOrder.create_time ? new Date(rawOrder.create_time * 1000).toISOString() : new Date().toISOString(),
    data_envio: ['SHIPPED', 'TO_CONFIRM_RECEIVE', 'COMPLETED'].includes(orderStatus ?? '') && rawOrder.update_time
      ? new Date(rawOrder.update_time * 1000).toISOString() : null,
    prazo_postagem: rawOrder.ship_by_date ? new Date(rawOrder.ship_by_date * 1000).toISOString() : null,
    dados_brutos: rawOrder,
    ultima_sincronizacao: new Date().toISOString(),
    erro_sincronizacao: null,
    updated_at: new Date().toISOString(),
  }
  // Deliberadamente NÃO inclui: transportadora, codigo_rastreio, observacoes,
  // pendencia_motivo, nfe_*. São campos editados manualmente pelo operador —
  // incluí-los aqui faria o upsert apagar essas edições a cada re-sync.
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

async function upsertPacote(sb: any, pedidoId: string, pkg: any): Promise<void> {
  const packageNumber = pkg?.package_number ?? null
  if (!packageNumber) return
  await sb.from('marketplace_pedido_pacotes').upsert({
    pedido_id: pedidoId,
    package_number_externo: packageNumber,
    transportadora: pkg.shipping_carrier ?? null,
    status_etiqueta: pkg.logistics_status ?? null,
    dados_brutos: pkg,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'pedido_id,package_number_externo' })
}

// Resolve o vínculo de um item via FK direta (item_id_externo →
// marketplace_anuncios.id_externo, model_id_externo → marketplace_anuncio_
// variacoes.model_id) — NÃO via marketplace_mapeamentos, que é keyed por
// SKU-texto e serve só ao aprendizado do sync de catálogo. Se o catálogo
// ainda não foi sincronizado para esse item, não há anúncio nenhum — fica
// sem vínculo até o usuário sincronizar o catálogo ou mapear manualmente.
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

// Upsert de item preservando estado local (produto_id/status_mapeamento/
// baixou_estoque) — UPDATE explícito só nos campos vindos da Shopee quando o
// item já existe; nunca um upsert genérico que reescreveria a linha inteira
// e apagaria um mapeamento manual ou uma baixa já processada.
async function upsertItemPedido(
  sb: any, pedidoId: string,
  item: { itemIdExterno: string; modelIdExterno: string | null; nomeProduto: string; sku: string | null; quantidade: number; precoUnitario: number },
  vinculo: { anuncioId: string | null; produtoId: string | null }
): Promise<{ id: string }> {
  let query = sb.from('marketplace_pedido_itens').select('id')
    .eq('pedido_id', pedidoId).eq('item_id_externo', item.itemIdExterno)
  query = item.modelIdExterno ? query.eq('model_id_externo', item.modelIdExterno) : query.is('model_id_externo', null)
  const { data: existente } = await query.maybeSingle()

  const camposShopee = {
    anuncio_id: vinculo.anuncioId,
    nome_produto: item.nomeProduto,
    sku: item.sku,
    quantidade: item.quantidade,
    preco_unitario: item.precoUnitario,
    subtotal: item.precoUnitario * item.quantidade,
  }

  if (existente) {
    await sb.from('marketplace_pedido_itens').update(camposShopee).eq('id', existente.id)
    return { id: existente.id }
  }

  const { data: criado, error } = await sb.from('marketplace_pedido_itens').insert({
    pedido_id: pedidoId,
    item_id_externo: item.itemIdExterno,
    model_id_externo: item.modelIdExterno,
    produto_id: vinculo.produtoId,
    status_mapeamento: vinculo.produtoId ? 'mapeado' : 'pendente',
    baixou_estoque: false,
    ...camposShopee,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return { id: criado.id }
}

// Processa um pedido já buscado (get_order_detail): resolve vínculo de cada
// item, grava o cabeçalho (com etapa_interna já considerando pendências) e
// os itens/pacotes. Reaproveitado por syncPedidos (lote) e syncSinglePedido.
export async function processRawOrder(
  sb: any, canal: ShopeeChannel, rawOrder: any
): Promise<{ pedidoId: string; algumItemPendente: boolean }> {
  const itensRaw: any[] = rawOrder.item_list ?? []

  const vinculos: { raw: any; itemIdExterno: string; modelIdExterno: string | null; vinculo: { anuncioId: string | null; produtoId: string | null } }[] = []
  for (const it of itensRaw) {
    const itemIdExterno = String(it.item_id)
    const modelIdExterno = it.model_id ? String(it.model_id) : null
    const vinculo = await resolverVinculoItem(sb, canal.id, itemIdExterno, modelIdExterno)
    vinculos.push({ raw: it, itemIdExterno, modelIdExterno, vinculo })
  }
  const algumItemPendente = vinculos.some(v => !v.vinculo.produtoId)

  const row = mapOrderToPedidoRow(rawOrder, canal, algumItemPendente)
  const pedido = await upsertPedido(sb, row)

  // Pedido "pago/confirmado ou além" (qualquer status comercial que não seja
  // 'novo' = ainda não pago) já dispara baixa automática pros itens mapeados
  // — sem fase de reserva nesta versão (ver plano). Falha de baixa de um
  // item não impede os demais nem o processamento do pedido em si.
  const deveBaixar = row.status !== 'novo' && row.status !== 'cancelado'
  for (const v of vinculos) {
    const precoUnitario = Number(v.raw.model_discounted_price ?? v.raw.model_original_price ?? 0)
    const quantidade = Number(v.raw.model_quantity_purchased ?? 1)
    const { id: itemId } = await upsertItemPedido(sb, pedido.id, {
      itemIdExterno: v.itemIdExterno,
      modelIdExterno: v.modelIdExterno,
      nomeProduto: v.raw.item_name ?? v.raw.model_name ?? `Item ${v.itemIdExterno}`,
      sku: v.raw.model_sku ?? v.raw.item_sku ?? null,
      quantidade,
      precoUnitario,
    }, v.vinculo)

    if (deveBaixar && v.vinculo.produtoId) {
      await baixarEstoquePedidoItem(sb, itemId)
    }
  }

  for (const pkg of rawOrder.package_list ?? []) {
    await upsertPacote(sb, pedido.id, pkg)
  }

  return { pedidoId: pedido.id, algumItemPendente }
}

// Ressincroniza um único pedido (ação individual), sem passar pela
// paginação/lote da sincronização completa.
export async function syncSinglePedido(
  sb: any, canalInicial: ShopeeChannel, orderSn: string
): Promise<{ ok: true; pedidoId: string } | { ok: false; error: string }> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const rawOrders = await getOrderDetailBatch({ sb, canal }, [orderSn])
    if (!rawOrders[0]) return { ok: false, error: 'Pedido não encontrado na Shopee' }
    const { pedidoId } = await processRawOrder(sb, canal, rawOrders[0])
    return { ok: true, pedidoId }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao sincronizar pedido' }
  }
}

// Orquestra a sincronização completa: lista order_sn no período → busca
// detalhes → processa. Falhas por pedido ficam isoladas (não abortam o
// restante); só uma falha ao nível do canal (token/credenciais) propaga.
export async function syncPedidos(
  sb: any, canalInicial: ShopeeChannel, opts: { maxOrders?: number; desde?: Date } = {}
): Promise<SyncResult> {
  const maxOrders = opts.maxOrders ?? DEFAULT_MAX_ORDERS
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const ctx = { sb, canal }

  const agora = Math.floor(Date.now() / 1000)
  const desde = opts.desde ? Math.floor(opts.desde.getTime() / 1000) : agora - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60

  const orderSns: string[] = []
  let truncated = false

  paginacao: for await (const pagina of listOrderSns(ctx, { timeFrom: desde, timeTo: agora })) {
    for (const sn of pagina) {
      if (orderSns.length >= maxOrders) { truncated = true; break paginacao }
      orderSns.push(sn)
    }
  }

  if (orderSns.length === 0) {
    return { totalFound: 0, upserted: 0, failed: [], truncated: false }
  }

  const failed: SyncFailure[] = []
  let upserted = 0

  const rawOrders = await getOrderDetailBatch(ctx, orderSns)
  const retornados = new Set(rawOrders.map((o: any) => o.order_sn))
  for (const sn of orderSns) {
    if (!retornados.has(sn)) failed.push({ itemId: sn, error: 'Não retornado por get_order_detail' })
  }

  for (const rawOrder of rawOrders) {
    try {
      await processRawOrder(sb, canal, rawOrder)
      upserted++
    } catch (e: any) {
      failed.push({ itemId: rawOrder.order_sn ?? '?', error: e?.message ?? 'Erro desconhecido ao processar pedido' })
    }
  }

  return { totalFound: orderSns.length, upserted, failed, truncated }
}
