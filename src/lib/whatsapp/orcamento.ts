import { zapiSendText, type ZAPIConfig } from '@/lib/zapi'
import { montarMensagemOrcamento, type CondicoesOrcamento } from '@/lib/orcamentos/condicoes'
import { hojeNaLoja, somarDias } from './conversas'

// ORÇAMENTO PELA CONVERSA DO WHATSAPP.
//
// O orçamento é o MESMO da tela de Orçamentos e do PDV (tabelas `orcamentos`
// e `orcamento_itens`): montado na conversa, ele aparece lá, pode ser
// editado lá (condições de pagamento, desconto) e vira venda pelo PDV.
// Preço é sempre calculado no servidor (preço vigente do cadastro) — o
// navegador manda só produto e quantidade.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_ITENS_ORCAMENTO = 60

/** Validade padrão: 7 dias a partir de hoje (dia da loja). */
export const validadePadrao = (agora: Date = new Date(), dias = 7) => somarDias(hojeNaLoja(agora), dias)

/**
 * Itens vindos do navegador: só produto e quantidade. Junta o mesmo produto,
 * recusa quantidade inválida e corta em 3 casas (produto fracionado).
 */
export function normalizarItens(bruto: unknown): { produtoId: string; quantidade: number }[] | null {
  if (!Array.isArray(bruto) || !bruto.length || bruto.length > MAX_ITENS_ORCAMENTO) return null
  const somados = new Map<string, number>()
  for (const i of bruto) {
    const id = typeof i?.produtoId === 'string' ? i.produtoId : ''
    const q = Math.round(Number(i?.quantidade) * 1000) / 1000
    if (!UUID.test(id) || !Number.isFinite(q) || q <= 0 || q > 100000) return null
    somados.set(id, Math.round(((somados.get(id) ?? 0) + q) * 1000) / 1000)
  }
  return [...somados].map(([produtoId, quantidade]) => ({ produtoId, quantidade }))
}

/** Data AAAA-MM-DD válida, de hoje até 1 ano; senão a padrão. */
export function validadeAceita(v: unknown, agora: Date = new Date()): string {
  const hoje = hojeNaLoja(agora)
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T12:00:00Z`).getTime())) return validadePadrao(agora)
  if (v < hoje || v > somarDias(hoje, 366)) return validadePadrao(agora)
  return v
}

type Sb = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

type OrcamentoLido = {
  id: string; numero: number; status: string; cliente_nome: string | null; total: number; validade: string | null
  desconto_avista_pct: number | null; avista_formas: string[] | null; parcelas_max: number | null
  parcelas_sem_juros: boolean | null; condicoes_observacao: string | null
  orcamento_itens: { produto_nome: string; quantidade: number; preco_unitario: number; total: number }[]
}

/**
 * Envia (ou reenvia) o orçamento pela Z-API para o contato da conversa, com
 * o mesmo texto da tela de Orçamentos (incluindo as condições salvas nele).
 * Registra antes de enviar; o banco liga à conversa e move a etapa para
 * "Orçamento enviado" quando o envio dá certo.
 */
export async function enviarOrcamentoNaConversa(sb: Sb, d: {
  empresaId: string; empresaNome: string | null; operador: string | null
  contato: { telefone: string; cliente_id: string | null; cliente_nome: string | null }
  orcamentoId: string; zapi: ZAPIConfig | null
}): Promise<{ ok: true; numero: number } | { ok: false; erro: string }> {
  const { data: o } = await sb.from('orcamentos')
    .select('id, numero, status, cliente_nome, total, validade, desconto_avista_pct, avista_formas, parcelas_max, parcelas_sem_juros, condicoes_observacao, orcamento_itens(produto_nome, quantidade, preco_unitario, total)')
    .eq('empresa_id', d.empresaId).eq('id', d.orcamentoId).maybeSingle()
  if (!d.zapi) return { ok: false, erro: 'WhatsApp não configurado ou inativo' }
  const orc = o as OrcamentoLido | null
  if (!orc) return { ok: false, erro: 'Orçamento não encontrado' }
  if (orc.status !== 'aberto' && orc.status !== 'aprovado') return { ok: false, erro: `Orçamento ${orc.status}: não dá para enviar` }

  const condicoes: CondicoesOrcamento = {
    descontoAvistaPct: Number(orc.desconto_avista_pct ?? 0), avistaFormas: orc.avista_formas ?? [],
    parcelasMax: orc.parcelas_max ?? null, parcelasSemJuros: orc.parcelas_sem_juros ?? true, observacao: orc.condicoes_observacao ?? null,
  }
  const mensagem = montarMensagemOrcamento({
    numero: orc.numero, empresaNome: d.empresaNome, clienteNome: orc.cliente_nome,
    itens: orc.orcamento_itens.map(i => ({ produto_nome: i.produto_nome, quantidade: Number(i.quantidade), preco_unitario: Number(i.preco_unitario), total: Number(i.total) })),
    total: Number(orc.total), validade: orc.validade, condicoes,
  })

  const agora = () => new Date().toISOString()
  const { data: msg, error } = await sb.from('whatsapp_mensagens').insert({
    empresa_id: d.empresaId, cliente_id: d.contato.cliente_id, cliente_nome: d.contato.cliente_nome,
    telefone: d.contato.telefone, tipo: 'orcamento', conteudo: mensagem,
    referencia_tipo: 'orcamento', referencia_id: orc.id, status: 'pendente', operador_nome: d.operador,
  }).select('id').single()
  if (error || !msg) return { ok: false, erro: 'Não foi possível registrar o envio' }

  const r = await zapiSendText(d.zapi!, d.contato.telefone, mensagem)
  await sb.from('whatsapp_mensagens').update({
    status: r.success ? 'enviado' : 'erro', tentativas: 1, erro: r.success ? null : (r.error ?? 'falha desconhecida'),
    zapi_message_id: r.messageId ?? null, enviado_em: r.success ? agora() : null, updated_at: agora(),
  }).eq('id', msg.id)
  if (!r.success) return { ok: false, erro: r.error ?? 'Não foi possível enviar' }
  await sb.from('orcamentos').update({ enviado_em: agora() }).eq('id', orc.id).eq('empresa_id', d.empresaId)
  return { ok: true, numero: orc.numero }
}
