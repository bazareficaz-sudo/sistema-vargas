import { getIntegracaoCredentials, refreshAccessTokenIfNeeded, shopeeGet, shopeePost, shopeePostBinary } from './client'
import type { ShopeeChannel } from './types'

// Endpoints e formatos confirmados contra o SDK TypeScript open-source
// congminh1254/shopee-sdk (GitHub, "100% endpoint coverage" da Open API v2)
// — ao contrário do sync de catálogo/pedidos, não é "confiança média" no
// shape básico dos endpoints. O que NÃO foi confirmado: os valores exatos
// de `status` em get_shipping_document_result (assumido conter READY/
// FAILED como substring) e o shape exato dos itens de address_list/
// branch_list (tratados como registros soltos, repassados quase crus pra
// UI) — gravar sempre dados_brutos ajuda a ajustar isso no primeiro uso real.

export type DocumentType = 'NORMAL_AIR_WAYBILL' | 'THERMAL_AIR_WAYBILL' | 'NORMAL_JOB_AIR_WAYBILL' | 'THERMAL_JOB_AIR_WAYBILL'
const DEFAULT_DOCUMENT_TYPE: DocumentType = 'NORMAL_AIR_WAYBILL'

type CallCtx = { sb: any; canal: ShopeeChannel }

async function callOpts(ctx: CallCtx) {
  const { partnerId, partnerKey } = await getIntegracaoCredentials(ctx.sb)
  return { partnerId, partnerKey, accessToken: ctx.canal.accessToken, shopId: ctx.canal.sellerId }
}

export async function getShippingParameter(ctx: CallCtx, orderSn: string, packageNumber?: string) {
  const callOptions = await callOpts(ctx)
  const params: Record<string, string> = { order_sn: orderSn }
  if (packageNumber) params.package_number = packageNumber
  const data = await shopeeGet('/api/v2/logistics/get_shipping_parameter', params, callOptions)
  return data?.response ?? {}
}

export type ShipOrderEscolha =
  | { modalidade: 'pickup'; addressId: number; pickupTimeId?: string }
  | { modalidade: 'dropoff'; branchId?: number; slug?: string; senderRealName?: string }
  | { modalidade: 'non_integrated'; trackingNumber?: string }

async function shipOrder(ctx: CallCtx, orderSn: string, packageNumber: string | undefined, escolha: ShipOrderEscolha) {
  const callOptions = await callOpts(ctx)
  const body: Record<string, any> = { order_sn: orderSn }
  if (packageNumber) body.package_number = packageNumber

  if (escolha.modalidade === 'pickup') {
    body.pickup = { address_id: escolha.addressId, ...(escolha.pickupTimeId ? { pickup_time_id: escolha.pickupTimeId } : {}) }
  } else if (escolha.modalidade === 'dropoff') {
    body.dropoff = {
      ...(escolha.branchId ? { branch_id: escolha.branchId } : {}),
      ...(escolha.slug ? { slug: escolha.slug } : {}),
      ...(escolha.senderRealName ? { sender_real_name: escolha.senderRealName } : {}),
    }
  } else {
    body.non_integrated = escolha.trackingNumber ? { tracking_number: escolha.trackingNumber } : {}
  }

  return shopeePost('/api/v2/logistics/ship_order', body, callOptions)
}

async function createShippingDocument(ctx: CallCtx, orderList: { order_sn: string; package_number?: string }[], documentType: DocumentType) {
  const callOptions = await callOpts(ctx)
  return shopeePost('/api/v2/logistics/create_shipping_document', {
    order_list: orderList.map(o => ({ ...o, shipping_document_type: documentType })),
    shipping_document_type: documentType,
  }, callOptions)
}

async function getShippingDocumentResult(ctx: CallCtx, orderList: { order_sn: string; package_number?: string }[], documentType: DocumentType) {
  const callOptions = await callOpts(ctx)
  const data = await shopeePost('/api/v2/logistics/get_shipping_document_result', {
    order_list: orderList.map(o => ({ ...o, shipping_document_type: documentType })),
    shipping_document_type: documentType,
  }, callOptions)
  return data?.response?.result_list ?? []
}

async function downloadShippingDocumentBytes(ctx: CallCtx, orderList: { order_sn: string; package_number?: string }[], documentType: DocumentType) {
  const callOptions = await callOpts(ctx)
  return shopeePostBinary('/api/v2/logistics/download_shipping_document', {
    order_list: orderList,
    shipping_document_type: documentType,
  }, callOptions)
}

async function getTrackingNumber(ctx: CallCtx, orderSn: string, packageNumber?: string): Promise<string | null> {
  try {
    const callOptions = await callOpts(ctx)
    const params: Record<string, string> = { order_sn: orderSn }
    if (packageNumber) params.package_number = packageNumber
    const data = await shopeeGet('/api/v2/logistics/get_tracking_number', params, callOptions)
    return data?.response?.tracking_number ?? null
  } catch {
    return null // não crítico — o rastreio pode ser preenchido manualmente depois
  }
}

async function buscarPedidoEPacote(sb: any, pedidoId: string) {
  const { data: pedido } = await sb.from('marketplace_pedidos').select('id, id_externo, empresa_id, canal_id').eq('id', pedidoId).single()
  if (!pedido) return null
  const { data: pacotes } = await sb.from('marketplace_pedido_pacotes').select('*').eq('pedido_id', pedidoId).order('created_at')
  return { pedido, pacote: pacotes?.[0] ?? null }
}

// Consulta o que a Shopee exige pra despachar este pedido (coleta, postagem
// em filial, ou rastreio manual) — chamado antes de shipOrder pra saber
// quais opções mostrar na tela.
export async function prepararEnvio(sb: any, canalInicial: ShopeeChannel, pedidoId: string) {
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const contexto = await buscarPedidoEPacote(sb, pedidoId)
  if (!contexto) throw new Error('Pedido não encontrado')
  const { pedido, pacote } = contexto

  const resposta = await getShippingParameter({ sb, canal }, pedido.id_externo, pacote?.package_number_externo ?? undefined)
  const infoNeeded = resposta.info_needed ?? {}

  let modalidade: 'pickup' | 'dropoff' | 'non_integrated' | null = null
  if (infoNeeded.pickup) modalidade = 'pickup'
  else if (infoNeeded.dropoff) modalidade = 'dropoff'
  else if (infoNeeded.non_integrated) modalidade = 'non_integrated'

  return {
    modalidade,
    enderecosColeta: resposta.pickup?.address_list ?? [],
    filiaisDropoff: resposta.dropoff?.branch_list ?? [],
    slugsDropoff: resposta.dropoff?.slug_list ?? [],
  }
}

// Confirma a modalidade de envio escolhida e já dispara a geração da
// etiqueta em seguida — evita um passo extra na UI, já que quase sempre o
// usuário quer as duas coisas juntas.
export async function confirmarEnvio(sb: any, canalInicial: ShopeeChannel, pedidoId: string, escolha: ShipOrderEscolha) {
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const contexto = await buscarPedidoEPacote(sb, pedidoId)
  if (!contexto) throw new Error('Pedido não encontrado')
  const { pedido, pacote } = contexto
  const packageNumber = pacote?.package_number_externo ?? undefined

  await shipOrder({ sb, canal }, pedido.id_externo, packageNumber, escolha)

  const camposPacote = {
    modalidade_envio: escolha.modalidade,
    endereco_coleta_id: escolha.modalidade === 'pickup' ? String(escolha.addressId) : null,
    filial_dropoff_id: escolha.modalidade === 'dropoff' && escolha.branchId ? String(escolha.branchId) : null,
    status_etiqueta: 'processando',
    etiqueta_erro: null,
  }
  let pacoteId: string | undefined
  if (pacote) {
    const { data } = await sb.from('marketplace_pedido_pacotes')
      .update({ ...camposPacote, updated_at: new Date().toISOString() }).eq('id', pacote.id).select('id').single()
    pacoteId = data?.id
  } else {
    const { data } = await sb.from('marketplace_pedido_pacotes')
      .insert({ pedido_id: pedidoId, ...camposPacote }).select('id').single()
    pacoteId = data?.id
  }

  await createShippingDocument({ sb, canal }, [{ order_sn: pedido.id_externo, package_number: packageNumber }], DEFAULT_DOCUMENT_TYPE)

  const trackingNumber = await getTrackingNumber({ sb, canal }, pedido.id_externo, packageNumber)
  if (trackingNumber) {
    if (pacoteId) await sb.from('marketplace_pedido_pacotes').update({ codigo_rastreio: trackingNumber }).eq('id', pacoteId)
    await sb.from('marketplace_pedidos').update({ codigo_rastreio: trackingNumber, transportadora: escolha.modalidade }).eq('id', pedidoId)
  }

  return { ok: true }
}

// Consulta se o documento já ficou pronto — chamado em polling pelo
// frontend depois de confirmarEnvio.
export async function consultarStatusEtiqueta(sb: any, canalInicial: ShopeeChannel, pedidoId: string) {
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const contexto = await buscarPedidoEPacote(sb, pedidoId)
  if (!contexto) throw new Error('Pedido não encontrado')
  const { pedido, pacote } = contexto
  const packageNumber = pacote?.package_number_externo ?? undefined

  const resultados = await getShippingDocumentResult({ sb, canal }, [{ order_sn: pedido.id_externo, package_number: packageNumber }], DEFAULT_DOCUMENT_TYPE)
  const item = resultados[0]
  const statusBruto = String(item?.status ?? '').toUpperCase()
  const status = statusBruto.includes('READY') ? 'pronta' : statusBruto.includes('FAIL') || statusBruto.includes('ERROR') ? 'erro' : 'processando'

  if (pacote) {
    await sb.from('marketplace_pedido_pacotes')
      .update({ status_etiqueta: status, etiqueta_erro: status === 'erro' ? (item?.error ?? 'Falha ao gerar etiqueta') : null, updated_at: new Date().toISOString() })
      .eq('id', pacote.id)
  }

  return { status, erro: status === 'erro' ? (item?.error ?? 'Falha ao gerar etiqueta') : null }
}

// Baixa o PDF da Shopee (só se ainda não tiver sido salvo) e devolve uma
// signed URL de curta duração — o arquivo nunca fica público.
export async function baixarEtiqueta(sb: any, canalInicial: ShopeeChannel, pedidoId: string): Promise<{ url: string }> {
  const contexto = await buscarPedidoEPacote(sb, pedidoId)
  if (!contexto) throw new Error('Pedido não encontrado')
  const { pedido, pacote } = contexto
  if (!pacote) throw new Error('Envio ainda não confirmado para este pedido')

  if (pacote.arquivo_etiqueta_url) {
    const { data, error } = await sb.storage.from('etiquetas-envio').createSignedUrl(pacote.arquivo_etiqueta_url, 300)
    if (!error && data?.signedUrl) return { url: data.signedUrl }
    // se o arquivo salvo sumiu do storage por algum motivo, cai pro re-download abaixo
  }

  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const packageNumber = pacote.package_number_externo ?? undefined
  const bytes = await downloadShippingDocumentBytes({ sb, canal }, [{ order_sn: pedido.id_externo, package_number: packageNumber }], DEFAULT_DOCUMENT_TYPE)

  const path = `${pedido.empresa_id}/${pedidoId}/${packageNumber ?? 'etiqueta'}.pdf`
  const { error: uploadError } = await sb.storage.from('etiquetas-envio').upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw new Error(uploadError.message)

  await sb.from('marketplace_pedido_pacotes')
    .update({ arquivo_etiqueta_url: path, etiqueta_gerada_em: new Date().toISOString(), status_etiqueta: 'pronta' })
    .eq('id', pacote.id)

  const { data, error } = await sb.storage.from('etiquetas-envio').createSignedUrl(path, 300)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Falha ao gerar link de download')
  return { url: data.signedUrl }
}
