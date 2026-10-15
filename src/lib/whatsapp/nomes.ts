import { zapiContatoMetadata, zapiConversaMetadata, type ZAPIConfig } from '@/lib/zapi'
import { camposComTexto, nomeDoMetadata, numeroOculto } from './contatos'

// Nome do WhatsApp para contato que chegou sem ele (carga do histórico, que
// não guardava nome, ou mensagem sem `senderName`). Só leitura na Z-API:
// primeiro os dados do contato (`notify`), depois os da conversa (`name`).
//
// 15/10/2026: na primeira rodada a consulta de contato trouxe nome para 5 de
// 77. O diagnóstico (só os NOMES dos campos que vieram, nunca os valores) é
// para saber o que a Z-API devolve antes de tentar outro caminho.

type Admin = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

export function configZapi(cfg: { instance_id?: string | null; token?: string | null; client_token?: string | null; url_base?: string | null } | null): ZAPIConfig | null {
  return cfg?.instance_id && cfg?.token
    ? { instanceId: cfg.instance_id, token: cfg.token, clientToken: cfg.client_token, urlBase: cfg.url_base }
    : null
}

export type Diagnostico = {
  /** Quantas respostas de contato trouxeram cada campo com texto. */
  contato: Record<string, number>
  /** O mesmo para a consulta de conversa (só feita quando o contato veio sem nome). */
  conversa: Record<string, number>
  /** Respostas por situação ("contato 200", "conversa 404"…). */
  situacoes: Record<string, number>
}
export const diagnosticoVazio = (): Diagnostico => ({ contato: {}, conversa: {}, situacoes: {} })
const contar = (alvo: Record<string, number>, chave: string) => { alvo[chave] = (alvo[chave] ?? 0) + 1 }

/**
 * Um contato: grava o nome se a Z-API souber. Sem nome, grava '' (já
 * consultado); a próxima mensagem com nome do remetente ainda preenche.
 * `refazer` aceita contato já marcado com ''.
 */
export async function preencherNomeDoContato(
  admin: Admin, config: ZAPIConfig, contatoId: string, telefone: string,
  opcoes: { refazer?: boolean; diagnostico?: Diagnostico } = {},
): Promise<'preenchido' | 'sem_nome' | 'erro'> {
  if (numeroOculto(telefone)) return 'sem_nome'
  const diag = opcoes.diagnostico
  const contato = await zapiContatoMetadata(config, telefone)
  if (diag) contar(diag.situacoes, contato.ok ? 'contato 200' : `contato ${contato.status ?? 'sem resposta'}`)
  if (!contato.ok) return 'erro'
  if (diag) camposComTexto(contato.dados).forEach(c => contar(diag.contato, c))
  let nome = nomeDoMetadata(contato.dados)

  if (!nome) {
    const conversa = await zapiConversaMetadata(config, telefone)
    if (diag) contar(diag.situacoes, conversa.ok ? 'conversa 200' : `conversa ${conversa.status ?? 'sem resposta'}`)
    if (conversa.ok) {
      if (diag) camposComTexto(conversa.dados).forEach(c => contar(diag.conversa, c))
      nome = nomeDoMetadata(conversa.dados)
    }
  }

  let q = admin.from('whatsapp_contatos')
    .update({ nome_whatsapp: nome ?? '', updated_at: new Date().toISOString() })
    .eq('id', contatoId)
  q = opcoes.refazer ? q.or('nome_whatsapp.is.null,nome_whatsapp.eq.') : q.is('nome_whatsapp', null)
  const { error } = await q
  if (error) return 'erro'
  return nome ? 'preenchido' : 'sem_nome'
}

/**
 * Lote de até 40 contatos sem nome (os mais recentes primeiro). `refazer`:
 * também os já consultados sem nome ('') e ainda não tocados desde `desde`
 * — assim as rodadas seguintes não repetem os mesmos. Para no 2º erro seguido.
 */
export async function preencherNomes(admin: Admin, empresaId: string, config: ZAPIConfig, opcoes: { refazer?: boolean; desde?: string } = {}) {
  const filtrar = (q: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    q = q.eq('empresa_id', empresaId).not('chave', 'like', 'x%')
    if (!opcoes.refazer) return q.is('nome_whatsapp', null)
    q = q.or('nome_whatsapp.is.null,nome_whatsapp.eq.')
    return opcoes.desde ? q.lt('updated_at', opcoes.desde) : q
  }
  const diagnostico = diagnosticoVazio()
  const { data, error } = await filtrar(admin.from('whatsapp_contatos').select('id, telefone')).order('ultima_em', { ascending: false }).limit(40)
  if (error) return { consultados: 0, preenchidos: 0, semNome: 0, erros: 1, restantes: null as number | null, diagnostico }
  let preenchidos = 0, semNome = 0, erros = 0, seguidos = 0, consultados = 0
  for (const c of (data ?? []) as { id: string; telefone: string }[]) {
    if (consultados) await pausa(300)
    consultados++
    const r = await preencherNomeDoContato(admin, config, c.id, c.telefone, { refazer: opcoes.refazer, diagnostico })
    if (r === 'preenchido') { preenchidos++; seguidos = 0 }
    else if (r === 'sem_nome') { semNome++; seguidos = 0 }
    else { erros++; if (++seguidos >= 2) break }
  }
  const { count } = await filtrar(admin.from('whatsapp_contatos').select('id', { count: 'exact', head: true }))
  return { consultados, preenchidos, semNome, erros, restantes: count ?? null, diagnostico }
}
