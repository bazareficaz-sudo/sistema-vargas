import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import PrecificacaoClient from '@/components/precificacao/PrecificacaoClient'

export const dynamic = 'force-dynamic'

export default async function PrecificacaoPage() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')

  if (!guarda.ok) {
    return (
      <div className="p-8">
        <div className="max-w-md bg-white border border-gray-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-gray-900">Sem acesso</h1>
          <p className="text-sm text-gray-500 mt-1">
            Você não tem permissão para ver a precificação dos marketplaces.
          </p>
        </div>
      </div>
    )
  }

  return <PrecificacaoClient empresaId={guarda.empresaId} />
}
