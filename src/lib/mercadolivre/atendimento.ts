// ATENDIMENTO DO MERCADO LIVRE pelo sistema: perguntas de antes da compra,
// reclamações e mensagens de depois da venda. Tudo lido AO VIVO da API do ML
// (nada é copiado para o banco): o volume é pequeno — medido em 20/10/2026,
// ~40 perguntas e 1 a 2 reclamações por conta — e o que vale é o estado de
// agora. O que demora pesa na reputação: no mesmo dia havia 33 perguntas sem
// resposta (a mais antiga com 405 dias) e uma reclamação vencendo no dia.
//
// Formatos conferidos contra respostas reais (só leitura) em 20/10/2026:
//   GET /questions/search?seller_id&status=UNANSWERED&api_version=4
//   GET /post-purchase/v1/claims/search?status=opened  (players[].available_actions[].due_date)
//   GET /post-purchase/v1/claims/{id}/messages        (sender_role, message, date_created)
//   GET /post-purchase/v1/claims/reasons/{id}          (detail em português)
//   GET /messages/unread?role=seller&tag=post_sale     (results[].resource = /packs/N/sellers/N)
//   GET /messages/packs/{pack}/sellers/{seller}?tag=post_sale&mark_as_read=false
// Envio (pela documentação do ML; nunca exercitado antes desta tela):
//   POST /answers                                       { question_id, text }
//   POST /post-purchase/v1/claims/{id}/actions/send-message { receiver_role, message }
//   POST /messages/packs/{pack}/sellers/{seller}?tag=post_sale { from, to, text }

import { mlGet, mlPost, refreshAccessTokenIfNeeded } from './client'
import type { MLChannel } from './types'
import {
  acoesDoVendedor, prazoDaReclamacao, resumirAtendimento, type ResumoAtendimentoML,
  type ConversaML, type MensagemReclamacao, type PerguntaML, type ReclamacaoML,
} from './atendimentoRegras'

export type CanalAtendimento = MLChannel & { nome: string }

/** Canais do ML conectados da empresa, com o token renovado. */
export async function canaisDeAtendimento(sb: any, empresaId: string, canalId?: string): Promise<CanalAtendimento[]> {
  let q = sb.from('marketplace_canais')
    .select('id, nome, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('empresa_id', empresaId).eq('plataforma', 'mercadolivre').not('access_token', 'is', null)
  if (canalId) q = q.eq('id', canalId)
  const { data } = await q
  const canais: CanalAtendimento[] = []
  for (const row of data ?? []) {
    const canal = await refreshAccessTokenIfNeeded(sb, {
      id: row.id, empresaId: row.empresa_id, sellerId: String(row.seller_id),
      accessToken: row.access_token, refreshToken: row.refresh_token, tokenExpiraEm: row.token_expira_em,
    })
    canais.push({ ...canal, nome: row.nome })
  }
  return canais
}

// ── Perguntas ───────────────────────────────────────────────────────────
export async function perguntasSemResposta(sb: any, canal: CanalAtendimento): Promise<PerguntaML[]> {
  const r = await mlGet('/questions/search', {
    seller_id: canal.sellerId, status: 'UNANSWERED', api_version: 4, limit: 50,
    sort_fields: 'date_created', sort_types: 'DESC',
  }, canal.accessToken)
  const lista: any[] = (r?.questions ?? []).filter((q: any) => !q.deleted_from_listing)
  const itensIds = [...new Set(lista.map(q => String(q.item_id)))]

  const itens = new Map<string, PerguntaML['item']>()
  for (let i = 0; i < itensIds.length; i += 20) {
    const lote = itensIds.slice(i, i + 20)
    const resp = await mlGet('/items', { ids: lote.join(','), attributes: 'id,title,thumbnail,permalink,price,available_quantity,status' }, canal.accessToken).catch(() => [])
    for (const x of Array.isArray(resp) ? resp : []) {
      const b = x?.body
      if (x?.code === 200 && b?.id) itens.set(String(b.id), {
        titulo: b.title ?? '', foto: b.thumbnail ? String(b.thumbnail).replace(/^http:/, 'https:') : null,
        preco: b.price ?? null, estoque: b.available_quantity ?? null, link: b.permalink ?? null, status: b.status ?? null,
      })
    }
  }
  const produtos = new Map<string, string | null>()
  if (itensIds.length) {
    const { data } = await sb.from('marketplace_anuncios').select('id_externo, produto_id')
      .eq('canal_id', canal.id).in('id_externo', itensIds)
    for (const a of data ?? []) produtos.set(String(a.id_externo), a.produto_id ?? null)
  }

  return lista.map(q => ({
    id: Number(q.id), canalId: canal.id, canalNome: canal.nome,
    texto: String(q.text ?? ''), criadaEm: String(q.date_created), itemId: String(q.item_id),
    item: itens.get(String(q.item_id)) ?? null, produtoId: produtos.get(String(q.item_id)) ?? null,
  }))
}

export async function responderPergunta(canal: CanalAtendimento, perguntaId: number, texto: string) {
  return mlPost('/answers', { question_id: perguntaId, text: texto }, canal.accessToken)
}

// ── Reclamações ─────────────────────────────────────────────────────────
const motivos = new Map<string, string>()
async function textoDoMotivo(canal: CanalAtendimento, id: string): Promise<string> {
  if (!motivos.has(id)) {
    const r = await mlGet(`/post-purchase/v1/claims/reasons/${id}`, {}, canal.accessToken).catch(() => null)
    motivos.set(id, String(r?.detail ?? r?.name ?? id))
  }
  return motivos.get(id)!
}

const PAPEL: Record<string, MensagemReclamacao['de']> = { complainant: 'comprador', respondent: 'vendedor', mediator: 'mediador' }

export async function reclamacoesAbertas(sb: any, canal: CanalAtendimento): Promise<ReclamacaoML[]> {
  const r = await mlGet('/post-purchase/v1/claims/search', { status: 'opened', limit: 50 }, canal.accessToken)
  const lista: any[] = r?.data ?? []
  const pedidosExt = lista.filter(c => c.resource === 'order' && c.resource_id).map(c => String(c.resource_id))
  const pedidos = new Map<string, string>()
  if (pedidosExt.length) {
    const { data } = await sb.from('marketplace_pedidos').select('id, id_externo').eq('canal_id', canal.id).in('id_externo', pedidosExt)
    for (const p of data ?? []) pedidos.set(String(p.id_externo), p.id)
  }
  const saida: ReclamacaoML[] = []
  for (const c of lista) {
    const msgs = await mlGet(`/post-purchase/v1/claims/${c.id}/messages`, {}, canal.accessToken).catch(() => [])
    const mensagens: MensagemReclamacao[] = (Array.isArray(msgs) ? msgs : [])
      .map((m: any) => ({ de: PAPEL[m.sender_role] ?? 'mediador', texto: String(m.message ?? ''), em: String(m.date_created ?? m.message_date ?? '') }))
      .sort((a, b) => a.em.localeCompare(b.em))
    saida.push({
      id: Number(c.id), canalId: canal.id, canalNome: canal.nome,
      tipo: String(c.type ?? ''), etapa: String(c.stage ?? ''),
      motivo: await textoDoMotivo(canal, String(c.reason_id ?? '')),
      criadaEm: String(c.date_created), pedidoExterno: c.resource_id ? String(c.resource_id) : null,
      pedidoId: c.resource_id ? pedidos.get(String(c.resource_id)) ?? null : null,
      acoes: acoesDoVendedor(c.players), prazo: prazoDaReclamacao(c.players), mensagens,
    })
  }
  // Prazo mais curto primeiro; sem prazo (esperando o comprador ou o ML) no fim.
  return saida.sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999'))
}

export async function mensagemNaReclamacao(canal: CanalAtendimento, reclamacaoId: number, texto: string) {
  return mlPost(`/post-purchase/v1/claims/${reclamacaoId}/actions/send-message`,
    { receiver_role: 'complainant', message: texto }, canal.accessToken)
}

// ── Mensagens pós-venda ─────────────────────────────────────────────────
export async function conversasNaoLidas(canal: CanalAtendimento): Promise<ConversaML[]> {
  const r = await mlGet('/messages/unread', { role: 'seller', tag: 'post_sale' }, canal.accessToken)
  const saida: ConversaML[] = []
  for (const x of (r?.results ?? []) as { resource?: string; count?: number }[]) {
    const pack = String(x.resource ?? '').match(/\/packs\/(\d+)/)?.[1]
    if (!pack) continue
    // mark_as_read=false: ler aqui não pode marcar como lida no ML.
    const d = await mlGet(`/messages/packs/${pack}/sellers/${canal.sellerId}`, { tag: 'post_sale', mark_as_read: 'false', limit: 20 }, canal.accessToken).catch(() => null)
    const msgs: any[] = d?.messages ?? []
    const comprador = msgs.map(m => String(m?.from?.user_id ?? '')).find(id => id && id !== String(canal.sellerId))
      ?? msgs.map(m => String(m?.to?.user_id ?? '')).find(id => id && id !== String(canal.sellerId)) ?? null
    saida.push({
      packId: pack, canalId: canal.id, canalNome: canal.nome, compradorId: comprador, naoLidas: Number(x.count ?? 0),
      temReclamacao: Array.isArray(d?.conversation_status?.claim_ids) && d.conversation_status.claim_ids.length > 0,
      mensagens: msgs.map(m => ({
        daLoja: String(m?.from?.user_id ?? '') === String(canal.sellerId),
        texto: String(m?.text ?? ''),
        em: String(m?.message_date?.created ?? m?.message_date?.received ?? ''),
      })).sort((a, b) => a.em.localeCompare(b.em)),
    })
  }
  return saida
}

export async function responderConversa(canal: CanalAtendimento, packId: string, compradorId: string, texto: string) {
  return mlPost(`/messages/packs/${packId}/sellers/${canal.sellerId}?tag=post_sale`, {
    from: { user_id: String(canal.sellerId) }, to: { user_id: String(compradorId) }, text: texto,
  }, canal.accessToken)
}

// ── Resumo para o Início do vendedor ────────────────────────────────────
/**
 * Quantas perguntas e reclamações esperam, em todas as contas — DUAS
 * consultas leves por conta (o total das perguntas e a lista de reclamações).
 * Passou de `limiteMs`, devolve nulo: o Início abre sem o cartão em vez de
 * esperar o Mercado Livre.
 */
export async function resumoParaInicio(sb: any, empresaId: string, limiteMs = 6000): Promise<ResumoAtendimentoML | null> {
  const trabalho = (async () => {
    const canais = await canaisDeAtendimento(sb, empresaId)
    if (!canais.length) return null
    const contas = await Promise.all(canais.map(async canal => {
      const [p, r] = await Promise.all([
        mlGet('/questions/search', { seller_id: canal.sellerId, status: 'UNANSWERED', api_version: 4, limit: 1 }, canal.accessToken),
        mlGet('/post-purchase/v1/claims/search', { status: 'opened', limit: 50 }, canal.accessToken),
      ])
      return { perguntas: Number(p?.total ?? 0), reclamacoes: (r?.data ?? []) as { players?: any[] }[] }
    }))
    return resumirAtendimento(contas)
  })()
  const tempo = new Promise<null>(res => setTimeout(() => res(null), limiteMs))
  return Promise.race([trabalho.catch(() => null), tempo])
}

/** Descrição do anúncio no ML (texto), para a IA responder com o que o anúncio diz. */
export async function descricaoDoAnuncio(canal: CanalAtendimento, itemId: string): Promise<string | null> {
  if (!/^MLB\d+$/i.test(itemId)) return null
  const d = await mlGet(`/items/${itemId}/description`, {}, canal.accessToken).catch(() => null)
  const texto = String(d?.plain_text ?? '').trim()
  return texto ? texto.slice(0, 4000) : null
}
