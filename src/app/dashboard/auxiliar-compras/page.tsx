import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import AuxiliarComprasClient from '@/components/auxiliar-compras/AuxiliarComprasClient'
import BotaoRecalcular from '@/components/auxiliar-compras/BotaoRecalcular'

export const dynamic = 'force-dynamic'

// Auxiliar de Compras — a lista do que comprar, já calculada.
//
// Esta página não calcula nada. Tudo o que ela mostra saiu da rodada
// noturna (`/api/cron/reposicao`) e está em `reposicao_metricas`. É a
// diferença entre abrir em meio segundo e reler 14 mil produtos a cada
// visita, que é o defeito da tela de Estoque & Giro que esta substitui.

export default async function AuxiliarComprasPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: metricas, error } = await sb.from('reposicao_metricas')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('score', { ascending: false })
    .limit(1000)

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-8">
        <h1 className="text-amber-900 font-semibold mb-2">Auxiliar de Compras</h1>
        <p className="text-sm text-amber-800">
          As tabelas de reposição ainda não existem no banco: {error.message}
        </p>
        <p className="text-xs text-amber-700 mt-2">
          Rode <code className="bg-amber-100 px-1 rounded">supabase-reposicao.sql</code> e recarregue.
        </p>
      </div>
    )
  }

  const linhas = metricas ?? []

  // Nome, SKU e categoria não moram na tabela de métricas de propósito —
  // duplicá-los ali significaria que renomear um produto deixaria a lista
  // de compra mostrando o nome antigo até a próxima madrugada.
  const ids = linhas.map(m => m.produto_id)
  const produtos: Record<string, { nome: string; sku: string | null; categoria: string | null; marca: string | null; unidade: string | null }> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('produtos')
      .select('id, nome, sku, categoria, marca, unidade')
      .in('id', ids.slice(i, i + 200))
    for (const p of data ?? []) {
      produtos[p.id] = { nome: p.nome, sku: p.sku, categoria: p.categoria, marca: p.marca, unidade: p.unidade }
    }
  }

  // Sinais de IA e o resumo do dia — ausência de qualquer um dos dois não é
  // erro, só quer dizer que a rodada de IA (fatia 5) ainda não rodou para
  // esta empresa, ou que o produto não estava entre os de maior score.
  const { data: sinaisIA } = await sb.from('reposicao_ia_sinais')
    .select('produto_id, sinais, gerado_em').eq('empresa_id', empresaId)
  const sinaisPorProduto: Record<string, { tipo: string; texto: string }[]> = {}
  for (const s of sinaisIA ?? []) {
    if (Array.isArray(s.sinais)) sinaisPorProduto[s.produto_id] = s.sinais
  }

  const { data: resumoIA } = await sb.from('reposicao_ia_resumo')
    .select('texto, produtos_analisados, gerado_em').eq('empresa_id', empresaId).maybeSingle()

  const lista = linhas.map(m => ({
    ...m,
    nome: produtos[m.produto_id]?.nome ?? '(produto removido)',
    sku: produtos[m.produto_id]?.sku ?? null,
    categoria: produtos[m.produto_id]?.categoria ?? null,
    marca: produtos[m.produto_id]?.marca ?? null,
    unidade: produtos[m.produto_id]?.unidade ?? null,
    motivos: Array.isArray(m.motivos) ? m.motivos as string[] : [],
    sinaisIA: sinaisPorProduto[m.produto_id] ?? [],
  }))

  const calculadoEm = linhas[0]?.calculado_em ?? null

  if (lista.length === 0) {
    return (
      <div>
        <h1 className="text-gray-900 text-xl font-semibold mb-1">Auxiliar de Compras</h1>
        <p className="text-gray-500 text-sm mb-6">Nenhum cálculo feito ainda.</p>
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
          <p className="text-slate-600 text-sm mb-4">
            As métricas são calculadas de madrugada. Para ver a lista agora, mande calcular.
          </p>
          <BotaoRecalcular />
          <p className="text-xs text-slate-400 mt-6">
            Enquanto isso, as <Link href="/dashboard/auxiliar-compras/faltas" className="underline">faltas e encomendas do balcão</Link> já estão disponíveis.
          </p>
        </div>
      </div>
    )
  }

  return (
    <AuxiliarComprasClient
      lista={lista}
      calculadoEm={calculadoEm}
      resumoIA={resumoIA ? { texto: resumoIA.texto, produtosAnalisados: resumoIA.produtos_analisados, geradoEm: resumoIA.gerado_em } : null}
    />
  )
}
