import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import ParceriasClient from '@/components/empresas/ParceriasClient'

export const dynamic = 'force-dynamic'

export default async function ParceriasPage() {
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

  const { data: empresasDoTenant } = guarda.tenantId
    ? await sb.from('empresas').select('id, nome, nome_fantasia').eq('tenant_id', guarda.tenantId).neq('id', guarda.empresaId).order('nome')
    : { data: [] as any[] }

  return (
    <ParceriasClient
      empresaId={guarda.empresaId}
      empresasDisponiveis={(empresasDoTenant ?? []).map((e: any) => ({ id: e.id, nome: e.nome_fantasia ?? e.nome }))}
    />
  )
}
