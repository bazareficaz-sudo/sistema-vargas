// ATENDIMENTO DA SHOPEE pelo sistema: devoluções/reembolsos e avaliações de
// produto. Lido ao vivo na API (nada é copiado para o banco). O chat com o
// comprador a Shopee não libera para o nosso tipo de app — ver
// atendimentoRegras.ts.
//
// Formatos conferidos contra respostas reais (só leitura) em 20/10/2026:
//   GET /api/v2/returns/get_return_list  (janela de create_time; return_seller_due_date)
//   GET /api/v2/product/get_comment      (cursor; comment_reply só quando respondida)
// Envio (pela documentação da Shopee; primeiro uso real é pela tela):
//   POST /api/v2/product/reply_comment   { comment_list: [{ comment_id, comment }] }

import { getIntegracaoCredentials, refreshAccessTokenIfNeeded, shopeeGet, shopeePost } from './client'
import type { ShopeeChannel } from './types'
import {
  DEVOLUCAO_ABERTA, lerDevolucao, ordenarAvaliacoes, semResposta,
  type AvaliacaoShopee, type DevolucaoShopee,
} from './atendimentoRegras'

type Opts = { partnerId: number; partnerKey: string; accessToken: string; shopId: string }
export type CanalShopeeAtendimento = { id: string; nome: string; opts: Opts }

/** Lojas Shopee conectadas da empresa, com o token renovado. */
export async function lojasDeAtendimento(sb: any, empresaId: string, canalId?: string): Promise<CanalShopeeAtendimento[]> {
  let q = sb.from('marketplace_canais')
    .select('id, nome, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('empresa_id', empresaId).eq('plataforma', 'shopee').not('access_token', 'is', null)
  if (canalId) q = q.eq('id', canalId)
  const { data } = await q
  if (!data?.length) return []
  const { partnerId, partnerKey } = await getIntegracaoCredentials(sb)
  const lojas: CanalShopeeAtendimento[] = []
  for (const row of data) {
    const canal = await refreshAccessTokenIfNeeded(sb, {
      id: row.id, empresaId: row.empresa_id, sellerId: row.seller_id,
      accessToken: row.access_token, refreshToken: row.refresh_token, tokenExpiraEm: row.token_expira_em,
    } as ShopeeChannel)
    lojas.push({ id: row.id, nome: row.nome, opts: { partnerId: Number(partnerId), partnerKey, accessToken: canal.accessToken, shopId: String(canal.sellerId) } })
  }
  return lojas
}

// ── Devoluções ──────────────────────────────────────────────────────────
const JANELA_DIAS = 15
const DIAS_DEVOLUCOES = 60

/** Devoluções/reembolsos ainda em andamento dos últimos 60 dias, prazo mais curto primeiro. */
export async function devolucoesAbertas(sb: any, loja: CanalShopeeAtendimento): Promise<DevolucaoShopee[]> {
  const agora = Math.floor(Date.now() / 1000)
  const brutas: any[] = []
  // A lista é por janela de criação; quatro janelas de 15 dias.
  for (let fim = agora; fim > agora - DIAS_DEVOLUCOES * 86400; fim -= JANELA_DIAS * 86400) {
    for (let pagina = 0; pagina < 5; pagina++) {
      const r = await shopeeGet('/api/v2/returns/get_return_list', {
        page_no: pagina, page_size: 50, create_time_from: fim - JANELA_DIAS * 86400, create_time_to: fim,
      }, loja.opts)
      brutas.push(...(r?.response?.return ?? []))
      if (!r?.response?.more) break
    }
  }
  // Aceita há mais de 30 dias: processo resolvido que a Shopee não fechou na
  // lista (medido: aceitas de agosto ainda vinham como ACCEPTED).
  const limiteAceita = agora - 30 * 86400
  const abertas = brutas
    .filter(r => DEVOLUCAO_ABERTA.has(String(r?.status)) && !(r?.status === 'ACCEPTED' && Number(r?.create_time ?? 0) < limiteAceita))
    .map(r => lerDevolucao(r, loja))
  const pedidos = abertas.map(d => d.pedido).filter(Boolean)
  if (pedidos.length) {
    const { data } = await sb.from('marketplace_pedidos').select('id, id_externo').eq('canal_id', loja.id).in('id_externo', pedidos)
    const porSn = new Map((data ?? []).map((p: any) => [String(p.id_externo), p.id]))
    for (const d of abertas) d.pedidoId = (porSn.get(d.pedido) as string | undefined) ?? null
  }
  return abertas.sort((a, b) => (a.prazoLoja ?? '9999').localeCompare(b.prazoLoja ?? '9999'))
}

// ── Avaliações ──────────────────────────────────────────────────────────
const DIAS_AVALIACOES = 90

/** Avaliações sem resposta da loja (das 100 mais recentes, últimos 90 dias), pior nota primeiro. */
export async function avaliacoesSemResposta(sb: any, loja: CanalShopeeAtendimento): Promise<AvaliacaoShopee[]> {
  const brutas: any[] = []
  let cursor = ''
  for (let pagina = 0; pagina < 2; pagina++) {
    const r = await shopeeGet('/api/v2/product/get_comment', { cursor, page_size: 50 }, loja.opts)
    brutas.push(...(r?.response?.item_comment_list ?? []))
    cursor = String(r?.response?.next_cursor ?? '')
    if (!r?.response?.more || !cursor) break
  }
  const desde = Date.now() / 1000 - DIAS_AVALIACOES * 86400
  const pendentes = brutas.filter(c => semResposta(c) && !c.hidden && Number(c.create_time ?? 0) >= desde)

  const itens = [...new Set(pendentes.map(c => String(c.item_id)))]
  const produtos = new Map<string, { titulo: string; foto: string | null }>()
  if (itens.length) {
    const { data } = await sb.from('marketplace_anuncios').select('id_externo, titulo, imagens').eq('canal_id', loja.id).in('id_externo', itens)
    for (const a of data ?? []) produtos.set(String(a.id_externo), { titulo: a.titulo ?? '', foto: Array.isArray(a.imagens) ? a.imagens[0] ?? null : null })
  }
  return ordenarAvaliacoes(pendentes.map(c => ({
    commentId: Number(c.comment_id), canalId: loja.id, canalNome: loja.nome,
    nota: Number(c.rating_star ?? 0), texto: String(c.comment ?? '').trim(),
    comprador: String(c.buyer_username ?? ''), pedido: String(c.order_sn ?? ''),
    itemId: String(c.item_id), produto: produtos.get(String(c.item_id)) ?? null,
    fotos: (c.media?.image_url_list ?? []).filter((u: unknown) => typeof u === 'string'),
    criadaEm: new Date(Number(c.create_time ?? 0) * 1000).toISOString(),
  })))
}

/** Responde uma avaliação (a resposta fica pública no anúncio). */
export async function responderAvaliacao(loja: CanalShopeeAtendimento, commentId: number, texto: string): Promise<void> {
  const r = await shopeePost('/api/v2/product/reply_comment', { comment_list: [{ comment_id: commentId, comment: texto }] }, loja.opts)
  const falha = (r?.response?.result_list ?? []).find((x: any) => x?.fail_error || x?.fail_message)
  if (falha) throw new Error(String(falha.fail_message ?? falha.fail_error))
}
