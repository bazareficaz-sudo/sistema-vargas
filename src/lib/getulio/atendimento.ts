// BLOCO "ATENDIMENTO NO WHATSAPP" do resumo da manhã da Betina.
//
// Lista exata (nada passa pela IA), com o link de cada conversa:
//   • retornos marcados para hoje ou atrasados (lembrete da caixa de entrada);
//   • orçamentos enviados há 3 dias ou mais sem resposta do cliente;
//   • conversas esperando resposta da loja há mais de 2 h (dos últimos 3 dias —
//     mais antigas que isso viram ruído enquanto a Z-API não avisa as
//     respostas dadas pelo celular).
// Liga e desliga em "O que vigiar" (id `atendimento_whatsapp`); não gera sinal
// na Central, só o bloco do resumo.

import { urlDoApp } from '@/lib/appUrl'
import { formatarTelefone } from '@/lib/clientes/telefone'
import { numeroOculto } from '@/lib/whatsapp/contatos'
import { rotuloRetorno, tempoDeEspera } from '@/lib/whatsapp/conversas'

export const VIGIA_ATENDIMENTO = 'atendimento_whatsapp'
const MAX_POR_LISTA = 5
const CONVERSAS = '/dashboard/integracoes/whatsapp/conversas'

export type ConversaResumo = {
  id: string; telefone: string; cliente_nome: string | null; nome_whatsapp: string | null
  retorno_em: string | null; retorno_nota: string | null; etapa_em: string | null; ultima_entrada_em: string | null
}

export type DadosAtendimento = { retornos: ConversaResumo[]; parados: ConversaResumo[]; aguardando: ConversaResumo[] }

const nomeDe = (c: ConversaResumo) =>
  c.cliente_nome?.trim() || c.nome_whatsapp?.trim() || (numeroOculto(c.telefone) ? 'Número oculto' : formatarTelefone(c.telefone))
const linkConversa = (id: string) => urlDoApp(`${CONVERSAS}?c=${id}`)
const diaMes = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })

function lista(titulo: string, itens: ConversaResumo[], linha: (c: ConversaResumo) => string, filtro: string): string[] {
  if (!itens.length) return []
  const mostra = itens.slice(0, MAX_POR_LISTA)
  const out = [`*${titulo} (${itens.length})*`]
  for (const c of mostra) out.push(`• ${linha(c)}\n  ${linkConversa(c.id)}`)
  if (itens.length > mostra.length) out.push(`• …e mais ${itens.length - mostra.length}: ${urlDoApp(`${CONVERSAS}?f=${filtro}`)}`)
  return out
}

/** Texto do bloco; nulo quando não há nada (o resumo segue sem ele). */
export function blocoAtendimento(d: DadosAtendimento, agora: Date = new Date()): string | null {
  const partes = [
    ...lista('Retornos para hoje', d.retornos,
      c => `${nomeDe(c)} — ${rotuloRetorno(c.retorno_em!, agora)}${c.retorno_nota ? `: ${c.retorno_nota.trim().slice(0, 80)}` : ''}`, 'hoje'),
    ...lista('Orçamentos sem resposta', d.parados,
      c => `${nomeDe(c)} — enviado em ${c.etapa_em ? diaMes(c.etapa_em) : '?'}, sem resposta`, 'hoje'),
    ...lista('Esperando resposta da loja', d.aguardando,
      c => `${nomeDe(c)} — há ${c.ultima_entrada_em ? tempoDeEspera(c.ultima_entrada_em, agora) : '?'}`, 'aguardando'),
  ]
  return partes.length ? `📲 *Atendimento no WhatsApp*\n${partes.join('\n')}` : null
}

const COLS = 'id, telefone, cliente_nome, nome_whatsapp, retorno_em, retorno_nota, etapa_em, ultima_entrada_em'

/** Lê as três listas (chave de serviço do cron; empresa fixa). Erro → nulo, o resumo segue sem o bloco. */
export async function lerAtendimento(sb: any, empresaId: string, agora: Date = new Date()): Promise<DadosAtendimento | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = () => sb.from('whatsapp_conversas').select(COLS).eq('empresa_id', empresaId).neq('status', 'ignorado')
  const duasHoras = new Date(agora.getTime() - 2 * 3_600_000).toISOString()
  const tresDias = new Date(agora.getTime() - 3 * 86_400_000).toISOString()
  const [r, p, a] = await Promise.all([
    base().eq('retorno_vencido', true).order('retorno_em', { ascending: true }).limit(50),
    base().eq('orcamento_parado', true).order('etapa_em', { ascending: true }).limit(50),
    base().eq('aguardando', true).lt('ultima_entrada_em', duasHoras).gte('ultima_entrada_em', tresDias)
      .order('ultima_entrada_em', { ascending: true }).limit(50),
  ])
  if (r.error || p.error || a.error) return null
  // Quem já está em "retornos" não repete nas outras listas.
  const jaListados = new Set<string>((r.data ?? []).map((c: ConversaResumo) => c.id))
  const parados = (p.data ?? []).filter((c: ConversaResumo) => !jaListados.has(c.id))
  parados.forEach((c: ConversaResumo) => jaListados.add(c.id))
  return {
    retornos: r.data ?? [],
    parados,
    aguardando: (a.data ?? []).filter((c: ConversaResumo) => !jaListados.has(c.id)),
  }
}
