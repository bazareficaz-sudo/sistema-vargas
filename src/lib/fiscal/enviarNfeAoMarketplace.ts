import { mlPostArquivo, refreshAccessTokenIfNeeded as refreshML } from '@/lib/mercadolivre/client'
import {
  getIntegracaoCredentials as credShopee, refreshAccessTokenIfNeeded as refreshShopee, shopeeUploadImage,
} from '@/lib/shopee/client'
import { getIntegracaoCredentials as credTiktok, refreshAccessTokenIfNeeded as refreshTiktok, tiktokPost } from '@/lib/tiktok/client'
import { montarCanal as montarCanalTiktok } from '@/lib/tiktok/canal'

// ENVIO DA NF-e AO MARKETPLACE — a nota emitida aqui, entregue ao canal.
//
// Sem isto a nota existe, mas o pedido não anda: o ML segura a etiqueta em
// "invoice_pending", a TikTok em NEED_INVOICE e a Shopee em INVOICE_PENDING
// até alguém subir o XML no painel de cada um.
//
// Endpoints:
//   · Mercado Livre — POST /packs/{pack_id}/fiscal_documents, multipart, campo
//     `fiscal_document` (documentação oficial "Upload invoices"). Pedido sem
//     pack usa o próprio id do pedido como pack.
//   · Shopee — POST /api/v2/order/upload_invoice_doc, multipart: order_sn,
//     file_type 4 (XML), file ≤ 1 MB. "Para vendedor local do BR e PH" —
//     conferido no SDK gerado da especificação (congminh1254/shopee-sdk).
//   · TikTok — POST /fulfillment/202502/invoice/upload (caminho conferido no
//     SDK easycb-go; a resposta devolve erros por package_id/order_ids). O
//     FORMATO DO CORPO NÃO FOI CONFIRMADO em fonte acessível: segue o mais
//     provável, e a mensagem da TikTok é gravada inteira para ajustar no
//     primeiro envio real.
//
// Só vai nota AUTORIZADA EM PRODUÇÃO. Nota de homologação não tem valor
// fiscal; subir uma para um pedido real faria o marketplace liberar o envio
// com um documento que não vale.

export type ResultadoEnvioCanal = { ok: boolean; erro?: string; jaEnviada?: boolean }

/** O XML guardado na emissão (data URL base64 da Brasil NFe), em texto. */
export function xmlDaEmissao(emissao: any): string | null {
  const url = String(emissao?.xmlUrl ?? '')
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(url)
  if (!m) return null
  const xml = Buffer.from(m[1], 'base64').toString('utf8')
  return /<(nfeProc|NFe)\b/.test(xml) ? xml : null
}

/** Onde o marketplace espera a nota deste pedido. */
export function alvoDoEnvio(plataforma: string, pedido: { id_externo: string; pack_id?: string | null; pacotes?: any }):
  | { plataforma: 'mercadolivre'; packId: string }
  | { plataforma: 'shopee'; orderSn: string }
  | { plataforma: 'tiktok'; orderId: string; packageId: string | null }
  | { erro: string } {
  switch (plataforma) {
    case 'mercadolivre':
      return { plataforma, packId: String(pedido.pack_id || pedido.id_externo) }
    case 'shopee':
      return { plataforma, orderSn: String(pedido.id_externo) }
    case 'tiktok': {
      const pacotes: any[] = Array.isArray(pedido.pacotes) ? pedido.pacotes : []
      return { plataforma, orderId: String(pedido.id_externo), packageId: pacotes[0]?.id ? String(pacotes[0].id) : null }
    }
    default:
      return { erro: `Envio da nota ainda não disponível para ${plataforma}.` }
  }
}

function arquivoXml(xml: string): Blob {
  return new Blob([xml], { type: 'application/xml' })
}

async function enviarML(sb: any, canal: any, packId: string, xml: string, chave: string) {
  const ml = await refreshML(sb, {
    id: canal.id, empresaId: canal.empresa_id, sellerId: canal.seller_id,
    accessToken: canal.access_token, refreshToken: canal.refresh_token, tokenExpiraEm: canal.token_expira_em,
  })
  const form = new FormData()
  form.append('fiscal_document', arquivoXml(xml), `${chave}.xml`)
  await mlPostArquivo(`/packs/${packId}/fiscal_documents`, form, ml.accessToken)
}

async function enviarShopee(sb: any, canal: any, orderSn: string, xml: string, chave: string) {
  const sh = await refreshShopee(sb, {
    id: canal.id, empresaId: canal.empresa_id, sellerId: canal.seller_id,
    accessToken: canal.access_token, refreshToken: canal.refresh_token, tokenExpiraEm: canal.token_expira_em,
  })
  const { partnerId, partnerKey } = await credShopee(sb)
  if (Buffer.byteLength(xml) > 1_000_000) throw new Error('XML maior que 1 MB — limite da Shopee.')
  const form = new FormData()
  form.append('order_sn', orderSn)
  form.append('file_type', '4') // 4 = XML
  form.append('file', arquivoXml(xml), `${chave}.xml`)
  // shopeeUploadImage é o envio multipart genérico da integração (assina só a
  // query, como toda chamada Shopee) — o nome vem do primeiro uso.
  await shopeeUploadImage('/api/v2/order/upload_invoice_doc', form, {
    partnerId, partnerKey, accessToken: sh.accessToken, shopId: sh.sellerId,
  })
}

async function enviarTiktok(sb: any, canal: any, orderId: string, packageId: string | null, xml: string) {
  const tt = await refreshTiktok(sb, montarCanalTiktok(canal))
  const { appKey, appSecret } = await credTiktok()
  const resp = await tiktokPost('/fulfillment/202502/invoice/upload', {
    invoices: [{
      order_ids: [orderId],
      ...(packageId ? { package_id: packageId } : {}),
      file_type: 'XML',
      file: Buffer.from(xml, 'utf8').toString('base64'),
    }],
  }, { appKey, appSecret, accessToken: tt.accessToken, shopCipher: tt.shopCipher })
  // Código 0 com erros por pacote também é falha.
  const erros: any[] = resp?.data?.errors ?? []
  if (erros.length > 0) throw new Error(erros.map(e => e?.message ?? JSON.stringify(e)).join(' · '))
}

const COLUNAS_CANAL = 'id, nome, plataforma, empresa_id, seller_id, shop_cipher, access_token, refresh_token, token_expira_em, sincronizar_estoque, debitar_estoque_vendas'

export async function enviarNfeAoMarketplace(sb: any, empresaId: string, pedidoId: string): Promise<ResultadoEnvioCanal> {
  const { data: pedido } = await sb.from('marketplace_pedidos')
    .select('id, canal_id, id_externo, nfe_status, nfe_chave, nfe_informada_em, nfe_emissao, pack_id:dados_brutos->>pack_id, pacotes:dados_brutos->packages')
    .eq('id', pedidoId).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado' }

  const emissao = pedido.nfe_emissao ?? {}
  if (pedido.nfe_status !== 'autorizada' || emissao.ambiente !== 'producao') {
    return { ok: false, erro: 'Só nota autorizada em produção pode ser enviada ao marketplace.' }
  }
  if (emissao.enviadaAoCanalEm) return { ok: true, jaEnviada: true }

  const xml = xmlDaEmissao(emissao)
  if (!xml) return { ok: false, erro: 'O XML da nota não está guardado no pedido — não há o que enviar.' }
  const chave = String(emissao.chave ?? pedido.nfe_chave ?? 'nfe')

  const { data: canal } = await sb.from('marketplace_canais').select(COLUNAS_CANAL).eq('id', pedido.canal_id).maybeSingle()
  if (!canal?.access_token) return { ok: false, erro: 'Canal do pedido não está conectado.' }

  const alvo = alvoDoEnvio(canal.plataforma, pedido)
  let erro: string | undefined
  if ('erro' in alvo) {
    erro = alvo.erro
  } else {
    try {
      if (alvo.plataforma === 'mercadolivre') await enviarML(sb, canal, alvo.packId, xml, chave)
      else if (alvo.plataforma === 'shopee') await enviarShopee(sb, canal, alvo.orderSn, xml, chave)
      else await enviarTiktok(sb, canal, alvo.orderId, alvo.packageId, xml)
    } catch (e: any) {
      erro = e?.message ?? String(e)
    }
  }

  const agora = new Date().toISOString()
  const novaEmissao = erro
    ? { ...emissao, envioCanalErro: erro, envioCanalTentativaEm: agora }
    : { ...emissao, enviadaAoCanalEm: agora, envioCanalErro: null, envioCanalTentativaEm: agora }
  await sb.from('marketplace_pedidos').update({
    nfe_emissao: novaEmissao,
    // nfe_informada_em é o que a esteira lê como "o canal já tem a nota" —
    // o pedido passa para "Imprimir etiqueta" sem esperar o próximo sync.
    ...(erro ? {} : { nfe_informada_em: agora }),
  }).eq('id', pedidoId)

  return erro ? { ok: false, erro: `${canal.nome}: ${erro}` } : { ok: true }
}
