import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import AtendimentoShopeeClient from '@/components/atendimento/AtendimentoShopeeClient'
import { avaliacoesSemResposta, devolucoesAbertas, lojasDeAtendimento } from '@/lib/shopee/atendimento'
import { ordenarAvaliacoes, type AvaliacaoShopee, type DevolucaoShopee } from '@/lib/shopee/atendimentoRegras'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ATENDIMENTO DA SHOPEE: devoluções em andamento e avaliações sem resposta,
// de todas as lojas Shopee, lidas ao vivo.
export default async function AtendimentoShopeePage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const profile = await perfilDaSessao(sb, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const devolucoes: DevolucaoShopee[] = []
  let avaliacoes: AvaliacaoShopee[] = []
  const erros: string[] = []

  let lojas: Awaited<ReturnType<typeof lojasDeAtendimento>> = []
  try { lojas = await lojasDeAtendimento(sb, empresaId) }
  catch (e: unknown) { erros.push(`Lojas da Shopee: ${e instanceof Error ? e.message : 'erro'}`) }

  await Promise.all(lojas.map(async loja => {
    const [d, a] = await Promise.allSettled([devolucoesAbertas(sb, loja), avaliacoesSemResposta(sb, loja)])
    if (d.status === 'fulfilled') devolucoes.push(...d.value); else erros.push(`${loja.nome} — devoluções: ${String(d.reason?.message ?? d.reason)}`)
    if (a.status === 'fulfilled') avaliacoes.push(...a.value); else erros.push(`${loja.nome} — avaliações: ${String(a.reason?.message ?? a.reason)}`)
  }))
  devolucoes.sort((a, b) => (a.prazoLoja ?? '9999').localeCompare(b.prazoLoja ?? '9999'))
  avaliacoes = ordenarAvaliacoes(avaliacoes)

  return <AtendimentoShopeeClient lojas={lojas.map(l => l.nome)} devolucoes={devolucoes} avaliacoes={avaliacoes} erros={erros} />
}
