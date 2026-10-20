import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import AtendimentoMLClient from '@/components/atendimento/AtendimentoMLClient'
import { canaisDeAtendimento, conversasNaoLidas, perguntasSemResposta, reclamacoesAbertas } from '@/lib/mercadolivre/atendimento'
import type { ConversaML, PerguntaML, ReclamacaoML } from '@/lib/mercadolivre/atendimentoRegras'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ATENDIMENTO DO MERCADO LIVRE: perguntas sem resposta, reclamações abertas
// e mensagens pós-venda não lidas, de todas as contas do ML, lidas ao vivo.
export default async function AtendimentoMLPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const profile = await perfilDaSessao(sb, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const perguntas: PerguntaML[] = []
  const reclamacoes: ReclamacaoML[] = []
  const conversas: ConversaML[] = []
  const erros: string[] = []

  let canais: Awaited<ReturnType<typeof canaisDeAtendimento>> = []
  try { canais = await canaisDeAtendimento(sb, empresaId) }
  catch (e: unknown) { erros.push(`Contas do Mercado Livre: ${e instanceof Error ? e.message : 'erro'}`) }

  await Promise.all(canais.map(async canal => {
    const [p, r, c] = await Promise.allSettled([
      perguntasSemResposta(sb, canal), reclamacoesAbertas(sb, canal), conversasNaoLidas(canal),
    ])
    if (p.status === 'fulfilled') perguntas.push(...p.value); else erros.push(`${canal.nome} — perguntas: ${String(p.reason?.message ?? p.reason)}`)
    if (r.status === 'fulfilled') reclamacoes.push(...r.value); else erros.push(`${canal.nome} — reclamações: ${String(r.reason?.message ?? r.reason)}`)
    if (c.status === 'fulfilled') conversas.push(...c.value); else erros.push(`${canal.nome} — mensagens: ${String(c.reason?.message ?? c.reason)}`)
  }))

  // Mais nova primeiro: é quem ainda está decidindo a compra.
  perguntas.sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))
  reclamacoes.sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999'))

  return (
    <AtendimentoMLClient
      contas={canais.map(c => c.nome)}
      perguntas={perguntas} reclamacoes={reclamacoes} conversas={conversas} erros={erros}
    />
  )
}
