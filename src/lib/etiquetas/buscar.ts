// Busca o PDF da etiqueta de envio de um pedido no marketplace dele.
//
// Só BAIXA a etiqueta que o canal já liberou — não organiza envio, não
// escolhe modalidade. Hoje a nota e o envio são feitos em outro sistema, e
// organizar o envio aqui também poderia conflitar com ele. Pedido cuja
// etiqueta ainda não existe volta com o motivo dado pelo próprio canal.
//
//   Mercado Livre → GET /shipment_labels?shipment_ids=…&response_type=pdf
//                   (precisa do shipment em ready_to_ship, com a nota aceita)
//   Shopee        → documento THERMAL_AIR_WAYBILL (ver baixarEtiquetaTermica)
//   TikTok Shop   → GET /fulfillment/202309/packages/{id}/shipping_documents
//                   document_type=SHIPPING_LABEL, document_size=A6 → doc_url

import { refreshAccessTokenIfNeeded as refreshML } from '@/lib/mercadolivre/client'
import { refreshAccessTokenIfNeeded as refreshTiktok, getIntegracaoCredentials as credenciaisTiktok, tiktokGet } from '@/lib/tiktok/client'
import { montarCanal as montarCanalTiktok } from '@/lib/tiktok/canal'
import { baixarEtiquetaTermica } from '@/lib/shopee/logistics'
import type { MLChannel } from '@/lib/mercadolivre/types'
import type { ShopeeChannel } from '@/lib/shopee/types'

const ML_API = 'https://api.mercadolibre.com'

/**
 * O canal não libera mais a etiqueta porque o pacote JÁ FOI COLETADO pela
 * transportadora — a etiqueta foi impressa e usada fora daqui (outro
 * sistema, Seller Center). Não é falha de impressão: quem chama marca o
 * pedido como "etiqueta impressa" em vez de deixá-lo parado em "Imprimir".
 */
export class EtiquetaJaUsada extends Error {
  constructor(message: string) { super(message); this.name = 'EtiquetaJaUsada' }
}

function ehPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // %PDF
}

/** Mensagem legível de uma resposta de erro (JSON ou texto) do canal. */
async function motivo(res: Response): Promise<string> {
  const texto = await res.text().catch(() => '')
  try {
    const j = JSON.parse(texto)
    return String(j?.message ?? j?.error ?? j?.cause?.[0]?.message ?? texto).slice(0, 200)
  } catch {
    return (texto || `HTTP ${res.status}`).slice(0, 200)
  }
}

async function etiquetaML(sb: any, canalRow: any, pedido: any): Promise<Uint8Array> {
  const shipmentId = pedido.dados_brutos?.shipping?.id
  if (!shipmentId) throw new Error('Pedido sem envio do Mercado Envios')
  const canal: MLChannel = await refreshML(sb, {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  } as MLChannel)
  const res = await fetch(`${ML_API}/shipment_labels?shipment_ids=${shipmentId}&response_type=pdf`, {
    headers: { Authorization: `Bearer ${canal.accessToken}` },
  })
  if (!res.ok) throw new Error(`Mercado Livre: ${await motivo(res)}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!ehPdf(bytes)) throw new Error('Mercado Livre não devolveu um PDF de etiqueta')
  return bytes
}

async function etiquetaShopee(sb: any, canalRow: any, pedido: any): Promise<Uint8Array> {
  const canal: ShopeeChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }
  const pacote = pedido.dados_brutos?.package_list?.[0]?.package_number ?? null
  try {
    const bytes = await baixarEtiquetaTermica(sb, canal, String(pedido.id_externo), pacote)
    if (!ehPdf(bytes)) throw new Error('A Shopee não devolveu um PDF de etiqueta')
    return bytes
  } catch (e: any) {
    throw new Error(`Shopee: ${e?.message ?? 'falha ao baixar a etiqueta'}`)
  }
}

async function etiquetaTiktok(sb: any, canalRow: any, pedido: any): Promise<Uint8Array> {
  const pacoteId = pedido.dados_brutos?.packages?.[0]?.id
  if (!pacoteId) throw new Error('TikTok: pedido ainda sem pacote')
  const canal = await refreshTiktok(sb, montarCanalTiktok(canalRow))
  const { appKey, appSecret } = await credenciaisTiktok()
  let resp: any
  try {
    resp = await tiktokGet(`/fulfillment/202309/packages/${pacoteId}/shipping_documents`,
      { document_type: 'SHIPPING_LABEL', document_size: 'A6' },
      { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher })
  } catch (e: any) {
    const msg = String(e?.message ?? '')
    // Escopo de logística não liberado no app: precisa ativar no Partner
    // Center e reconectar a loja — o mesmo caminho dos escopos anteriores.
    // "Documents couldn't be printed after the package has been pickup":
    // a TikTok já tem o pacote, mas o status do pedido ainda não andou.
    if (/after the package has been pick ?up|has been picked up|already.*(collected|shipped)/i.test(msg)) {
      throw new EtiquetaJaUsada('TikTok: o pacote já foi coletado pela transportadora (etiqueta impressa e usada em outro lugar). Movido para "4. Aguardando postagem"; vai para Enviados quando a TikTok atualizar o status.')
    }
    if (/scope|permission|access denied/i.test(msg)) {
      throw new Error('TikTok: o app ainda não tem permissão de logística (Fulfillment). Ative o escopo no Partner Center e reconecte a loja.')
    }
    throw new Error(`TikTok: ${msg || 'falha ao pedir a etiqueta'}`)
  }
  const url = resp?.data?.doc_url
  if (!url) throw new Error('TikTok: etiqueta ainda não disponível (envio não organizado)')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TikTok: falha ao baixar a etiqueta (${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!ehPdf(bytes)) throw new Error('TikTok não devolveu um PDF de etiqueta')
  return bytes
}

export async function buscarEtiquetaDoPedido(sb: any, canalRow: any, pedido: any): Promise<Uint8Array> {
  if (!canalRow?.access_token) throw new Error('Canal sem conexão ativa')
  switch (canalRow.plataforma) {
    case 'mercadolivre': return etiquetaML(sb, canalRow, pedido)
    case 'shopee': return etiquetaShopee(sb, canalRow, pedido)
    case 'tiktok': return etiquetaTiktok(sb, canalRow, pedido)
    default: throw new Error(`Etiqueta de ${canalRow.plataforma} ainda não é suportada`)
  }
}
