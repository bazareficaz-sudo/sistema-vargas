import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import RevisarSugestoesClient from '@/components/marketplaces/RevisarSugestoesClient'

export const dynamic = 'force-dynamic'

export default async function RevisarSugestoesPage() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')

  if (!guarda.ok) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto text-center bg-white border border-gray-200 rounded-xl p-8">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Sem acesso</h1>
          <p className="text-sm text-gray-500">Você não tem permissão pra revisar sugestões de mapeamento.</p>
        </div>
      </div>
    )
  }

  return <RevisarSugestoesClient />
}
