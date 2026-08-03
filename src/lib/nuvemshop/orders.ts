import { nuvemshopGet } from './client'
import { paginar } from './catalog'
import { sincronizarEtapaComCanal } from '@/lib/pedidos/sincronizarEtapa'
import { baixarEstoquePedidoItem } from '@/lib/produtos/estoque'
import type { NuvemshopChannel, SyncFailure, SyncResult } from './types'

export const DEFAULT_MAX_ORDERS = 300
export const DEFAULT_LOOKBACK_DAYS = 15

/**
 * A Nuvemshop separa o que Shopee e Mercado Livre misturam: `status` é o
 * ciclo do pedido (open/closed/cancelled), `payment_status` é o pagamento e
 * `shipping_status` é a entrega. Isso é uma vantagem — dá para saber
 * "enviado" e "entregue" sem chamada extra, o que no Mercado Livre exige
 * consultar o envio separadamente e por isso ficou de fora lá.
 *
 * O status interno do sistema (novo/confirmado/cancelado) segue o PAGAMENTO,
 * mesmo critério já usado nas outras duas integrações: é ele que autoriza a
 * baixa de estoque.
 */
const PAGAMENTO_PARA_STATUS: Record<string, string> = {
  pending: 'novo',
  authorized: 'novo',
  abandoned: 'cancelado',
  voided: 'cancelado',
  refunded: 'cancelado',
  partially_refunded: 'confirmado',
  partially_paid: 'novo',
  paid: 'confirmado',
}

export function mapStatus(rawOrder: any): string {
  if (rawOrder?.status === 'cancelled') return 'cancelado'
  return PAGAMENTO_PARA_STATUS[rawOrder?.payment_status ?? ''] ?? 'novo'
}

// Mesma ordem de prioridade da Shopee: o que já saiu fisicamente manda sobre
// a pendência de mapeamento, porque a etapa descreve onde o pedido ESTÁ, não
// o que falta cadastrar. Manter as três integrações com a mesma ordem evita
// que o mesmo estado apareça diferente dependendo do canal.
export function calcularEtapaInterna(rawOrder: any, algumItemPendente: boolean): string {
  if (rawOrder?.status === 'cancelled') return 'cancelado'

  const envio = rawOrder?.shipping_status
  if (envio === 'delivered') return 'concluido'
  if (envio === 'shipped' || envio === 'partially_fulfilled') return 'enviado'

  if (algumItemPendente) return 'pendencia_mapeamento'

  if (rawOrder?.payment_status === 'paid') return 'pronto_expedicao'
  return 'novo'
}

function nomeCliente(rawOrder: any): string | null {
  const c = rawOrder?.customer
  const nome = c?.name ?? rawOrder?.billing_name ?? null
  return nome ? String(nome).trim() || null : null
}

function mapOrderToPedidoRow(rawOrder: any, canal: NuvemshopChannel, algumItemPendente: boolean): Record<string, any> {
  const end = rawOrder?.shipping_address ?? {}

  // A Nuvemshop chama de `province` o que aqui é estado, e de `locality` o
  // que costuma ser o bairro (`neighborhood` aparece em algumas respostas).
  const logradouro = [end.address, end.number].filter(Boolean).join(', ') || null

  return {
    empresa_id: canal.empresaId,
    canal_id: canal.id,
    id_externo: String(rawOrder?.id),
    // `number` é o número que o lojista e o cliente enxergam; o `id` é interno.
    numero_pedido: String(rawOrder?.number ?? rawOrder?.id),
    cliente_nome: nomeCliente(rawOrder),
    entrega_cep: end.zipcode ?? null,
    entrega_logradouro: logradouro,
    entrega_bairro: end.neighborhood ?? end.locality ?? null,
    entrega_cidade: end.city ?? null,
    entrega_estado: end.province ?? null,
    valor_produtos: Number(rawOrder?.subtotal ?? 0),
    // Diferente do Mercado Livre, o frete vem no próprio pedido — não precisa
    // de uma segunda consulta, então aqui o valor é real e não zero.
    valor_frete: Number(rawOrder?.shipping_cost_customer ?? 0),
    valor_total: Number(rawOrder?.total ?? 0),
    status: mapStatus(rawOrder),
    status_externo: rawOrder?.payment_status ?? rawOrder?.status ?? null,
    etapa_interna: calcularEtapaInterna(rawOrder, algumItemPendente),
    data_pedido: rawOrder?.created_at ?? new Date().toISOString(),
    data_envio: rawOrder?.shipping_status === 'shipped' || rawOrder?.shipping_status === 'delivered'
      ? (rawOrder?.completed_at ?? null)
      : null,
    prazo_postagem: null,
    dados_brutos: rawOrder,
    ultima_sincronizacao: new Date().toISOString(),
    erro_sincronizacao: null,
    updated_at: new Date().toISOString(),
  }
  // Deliberadamente ausentes: transportadora, codigo_rastreio, observacoes,
  // pendencia_motivo, nfe_*. São campos que o operador edita à mão — incluí-los
  // aqui apagaria essas edições a cada nova sincronização. Mesma decisão já
  // tomada em Shopee e Mercado Livre.
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

async function resolverVinculoItem(
  sb: any, canalId: string, produtoIdExterno: string, varianteIdExterna: string | null,
): Promise<{ anuncioId: string | null; produtoId: string | null }> {
  const { data: anuncio } = await sb.from('marketplace_anuncios')
    .select('id, produto_id')
    .eq('canal_id', canalId).eq('id_externo', produtoIdExterno)
    .maybeSingle()
  if (!anuncio) return { anuncioId: null, produtoId: null }
  if (!varianteIdExterna) return { anuncioId: anuncio.id, produtoId: anuncio.produto_id }

  const { data: variacao } = await sb.from('marketplace_anuncio_variacoes')
    .select('produto_id')
    .eq('anuncio_id', anuncio.id).eq('model_id', varianteIdExterna)
    .maybeSingle()

  // Produto de variação única não é gravado como variação (ver sync.ts), então
  // sem linha de variação o vínculo do anúncio ainda vale.
  return { anuncioId: anuncio.id, produtoId: variacao?.produto_id ?? anuncio.produto_id }
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
  sb: any, canal: NuvemshopChannel, rawOrder: any,
): Promise<{ pedidoId: string; algumItemPendente: boolean }> {
  const itensRaw: any[] = rawOrder?.products ?? []

  const vinculos: {
    raw: any; itemIdExterno: string; modelIdExterno: string | null
    vinculo: { anuncioId: string | null; produtoId: string | null }
  }[] = []

  for (const it of itensRaw) {
    const itemIdExterno = String(it?.product_id)
    const modelIdExterno = it?.variant_id != null ? String(it.variant_id) : null
    const vinculo = await resolverVinculoItem(sb, canal.id, itemIdExterno, modelIdExterno)
    vinculos.push({ raw: it, itemIdExterno, modelIdExterno, vinculo })
  }

  const algumItemPendente = vinculos.some(v => !v.vinculo.produtoId)

  const row = mapOrderToPedidoRow(rawOrder, canal, algumItemPendente)
  const pedido = await upsertPedido(sb, row)

  await sincronizarEtapaComCanal(sb, {
    pedidoId: pedido.id, empresaId: canal.empresaId, statusCanal: String(row.status ?? ''),
  })

  const debitaEstoque = canal.sincronizarEstoque !== false && canal.debitarEstoqueVendas !== false
  const deveBaixar = debitaEstoque && row.status !== 'novo' && row.status !== 'cancelado'

  for (const v of vinculos) {
    const { id: itemId } = await upsertItemPedido(sb, pedido.id, {
      itemIdExterno: v.itemIdExterno,
      modelIdExterno: v.modelIdExterno,
      nomeProduto: v.raw?.name ?? `Item ${v.itemIdExterno}`,
      sku: v.raw?.sku ? String(v.raw.sku) : null,
      quantidade: Number(v.raw?.quantity ?? 1),
      precoUnitario: Number(v.raw?.price ?? 0),
    }, v.vinculo)

    if (deveBaixar && v.vinculo.produtoId) {
      await baixarEstoquePedidoItem(sb, itemId)
    }
  }

  return { pedidoId: pedido.id, algumItemPendente }
}

export async function syncSinglePedido(
  sb: any, canal: NuvemshopChannel, orderId: string,
): Promise<{ ok: true; pedidoId: string } | { ok: false; error: string }> {
  try {
    const rawOrder = await nuvemshopGet(canal, `/orders/${orderId}`)
    if (!rawOrder?.id) return { ok: false, error: 'Pedido não encontrado na Nuvemshop' }
    const { pedidoId } = await processarPedido(sb, canal, rawOrder)
    return { ok: true, pedidoId }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao sincronizar pedido' }
  }
}

/**
 * Sincroniza pedidos por janela de ÚLTIMA ATUALIZAÇÃO, não de criação — é o
 * que permite pegar mudança de status (pagamento confirmado, envio) em pedido
 * criado antes da janela, sem varrer tudo de novo. Mesmo critério da Shopee e
 * do Mercado Livre.
 */
export async function syncPedidos(
  sb: any, canal: NuvemshopChannel, opts: { maxOrders?: number; desde?: Date } = {},
): Promise<SyncResult> {
  const maxOrders = opts.maxOrders ?? DEFAULT_MAX_ORDERS
  const desde = opts.desde ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const brutos: any[] = []
  let truncated = false

  paginacao: for await (const pagina of paginar(canal, '/orders', { updated_at_min: desde.toISOString() })) {
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

/** Recalcula a etapa depois de um mapeamento manual feito fora do sync. */
export async function recalcularEtapaPedido(sb: any, pedidoId: string): Promise<string | null> {
  const { data: pedido } = await sb.from('marketplace_pedidos')
    .select('id, dados_brutos').eq('id', pedidoId).single()
  if (!pedido) return null

  const { data: itens } = await sb.from('marketplace_pedido_itens').select('produto_id').eq('pedido_id', pedidoId)
  const algumItemPendente = (itens ?? []).some((i: any) => !i.produto_id)

  const etapa = calcularEtapaInterna(pedido.dados_brutos ?? {}, algumItemPendente)
  await sb.from('marketplace_pedidos').update({ etapa_interna: etapa }).eq('id', pedidoId)
  return etapa
}
