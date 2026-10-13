import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { empresaAtivaDaGuarda } from '@/lib/auth/empresaAtiva'
import ParceriaDetalheTabsClient from '@/components/empresas/ParceriaDetalheTabsClient'

export const dynamic = 'force-dynamic'

export default async function ParceriaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')

  if (!guarda.ok) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto text-center bg-white border border-gray-200 rounded-xl p-8">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Sem acesso</h1>
          <p className="text-sm text-gray-500">Você não tem permissão pra gerenciar parcerias entre empresas.</p>
        </div>
      </div>
    )
  }

  // A empresa em que o usuário ESTÁ (seletor), não a do cadastro — senão,
  // logado na outra empresa do grupo, os lados da parceria saem trocados.
  const empresaAtiva = await empresaAtivaDaGuarda(sb, guarda)

  const { data: parceria } = await sb.from('empresa_parcerias').select('id, empresa_id_a, empresa_id_b, status, sincronizar_preco').eq('id', id).maybeSingle()
  if (!parceria || (parceria.empresa_id_a !== empresaAtiva && parceria.empresa_id_b !== empresaAtiva)) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto text-center bg-white border border-gray-200 rounded-xl p-8">
          <p className="text-4xl mb-3">❓</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Parceria não encontrada</h1>
        </div>
      </div>
    )
  }

  const empresaParceiraId = parceria.empresa_id_a === empresaAtiva ? parceria.empresa_id_b : parceria.empresa_id_a
  const [{ data: empresaParceira }, { data: minhaEmpresa }] = await Promise.all([
    sb.from('empresas').select('nome, nome_fantasia').eq('id', empresaParceiraId).maybeSingle(),
    sb.from('empresas').select('nome, nome_fantasia').eq('id', empresaAtiva).maybeSingle(),
  ])

  // Categorias das DUAS empresas — filtro da aba "Duplicar catálogo". O lado
  // que vale é o de ORIGEM, que depende da direção escolhida na tela
  // (enviar para a parceira ou trazer dela).
  const [{ data: categorias }, { data: categoriasParceira }] = await Promise.all([
    sb.from('categorias').select('id, nome, pai_id').eq('empresa_id', empresaAtiva).eq('ativo', true).order('nome'),
    sb.from('categorias').select('id, nome, pai_id').eq('empresa_id', empresaParceiraId).eq('ativo', true).order('nome'),
  ])

  return (
    <ParceriaDetalheTabsClient
      parceriaId={id}
      empresaId={empresaAtiva}
      empresaParceiraId={empresaParceiraId}
      empresaParceiraNome={empresaParceira?.nome_fantasia ?? empresaParceira?.nome ?? 'Empresa parceira'}
      minhaEmpresaEhA={parceria.empresa_id_a === empresaAtiva}
      categorias={categorias ?? []}
      categoriasParceira={categoriasParceira ?? []}
      minhaEmpresaNome={minhaEmpresa?.nome_fantasia ?? minhaEmpresa?.nome ?? 'Sua empresa'}
      sincronizarPrecoInicial={parceria.sincronizar_preco ?? false}
    />
  )
}
