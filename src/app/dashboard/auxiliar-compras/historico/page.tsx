import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import HistoricoClient from '@/components/auxiliar-compras/HistoricoClient'

export const dynamic = 'force-dynamic'

// Memória do Auxiliar de Compras — fatia 6, a última do plano original.
//
// Duas coisas que não têm como nascer com histórico: quanto tempo cada
// produto ficou zerado, e o que o comprador faz com o que o motor sugere.
// Esta tela começa vazia no dia em que entra no ar — o valor dela cresce
// com o tempo de uso, não com código.

export default async function HistoricoPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const [{ data: rupturas, error: erroRupturas }, { data: decisoes, error: erroDecisoes }] = await Promise.all([
    sb.from('reposicao_rupturas')
      .select('id, produto_id, inicio, fim, dias, solicitacoes_durante, unidades_solicitadas_durante')
      .eq('empresa_id', empresaId)
      .order('inicio', { ascending: false })
      .limit(500),
    sb.from('reposicao_decisoes')
      .select('id, produto_id, evento, quantidade_sugerida, quantidade_decidida, criado_em')
      .eq('empresa_id', empresaId)
      .order('criado_em', { ascending: false })
      .limit(500),
  ])

  if (erroRupturas || erroDecisoes) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-8">
        <h1 className="text-amber-900 font-semibold mb-2">Histórico do Auxiliar de Compras</h1>
        <p className="text-sm text-amber-800">
          As tabelas de memória ainda não existem no banco: {erroRupturas?.message ?? erroDecisoes?.message}
        </p>
        <p className="text-xs text-amber-700 mt-2">
          Rode <code className="bg-amber-100 px-1 rounded">supabase-reposicao-memoria.sql</code> e recarregue.
        </p>
      </div>
    )
  }

  const ids = [...new Set([...(rupturas ?? []).map(r => r.produto_id), ...(decisoes ?? []).map(d => d.produto_id)])]
  const nomes: Record<string, { nome: string; sku: string | null }> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('produtos').select('id, nome, sku').in('id', ids.slice(i, i + 200))
    for (const p of data ?? []) nomes[p.id] = { nome: p.nome, sku: p.sku }
  }

  const rupturasComNome = (rupturas ?? []).map(r => ({
    ...r,
    nome: nomes[r.produto_id]?.nome ?? '(produto removido)',
    sku: nomes[r.produto_id]?.sku ?? null,
  }))
  const decisoesComNome = (decisoes ?? []).map(d => ({
    ...d,
    nome: nomes[d.produto_id]?.nome ?? '(produto removido)',
    sku: nomes[d.produto_id]?.sku ?? null,
  }))

  return <HistoricoClient rupturas={rupturasComNome} decisoes={decisoesComNome} />
}
