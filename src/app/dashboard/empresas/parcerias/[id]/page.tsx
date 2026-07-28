import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import RevisarVinculosClient from '@/components/empresas/RevisarVinculosClient'

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

  const { data: parceria } = await sb.from('empresa_parcerias').select('id, empresa_id_a, empresa_id_b, status').eq('id', id).maybeSingle()
  if (!parceria || (parceria.empresa_id_a !== guarda.empresaId && parceria.empresa_id_b !== guarda.empresaId)) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto text-center bg-white border border-gray-200 rounded-xl p-8">
          <p className="text-4xl mb-3">❓</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Parceria não encontrada</h1>
        </div>
      </div>
    )
  }

  const empresaParceiraId = parceria.empresa_id_a === guarda.empresaId ? parceria.empresa_id_b : parceria.empresa_id_a
  const { data: empresaParceira } = await sb.from('empresas').select('nome, nome_fantasia').eq('id', empresaParceiraId).maybeSingle()

  return (
    <RevisarVinculosClient
      parceriaId={id}
      empresaId={guarda.empresaId}
      empresaParceiraId={empresaParceiraId}
      empresaParceiraNome={empresaParceira?.nome_fantasia ?? empresaParceira?.nome ?? 'Empresa parceira'}
      minhaEmpresaEhA={parceria.empresa_id_a === guarda.empresaId}
    />
  )
}
