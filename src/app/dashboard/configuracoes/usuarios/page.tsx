import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { loadPlanData } from '@/lib/plans/access'
import UsuariosClient from '@/components/usuarios/UsuariosClient'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_usuarios')

  if (!guarda.ok) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto text-center bg-white border border-gray-200 rounded-xl p-8">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Sem acesso</h1>
          <p className="text-sm text-gray-500">Só administradores podem gerenciar usuários.</p>
        </div>
      </div>
    )
  }

  const { data: usuarios } = await sb.from('profiles')
    .select('id, nome, telefone, cargo, role, status, avatar_url, data_termino_acesso, observacoes, created_at')
    .eq('empresa_id', guarda.empresaId)
    .order('created_at', { ascending: true })

  const admin = createAdminClient()
  const { data: listaAuth } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emailPorId = new Map((listaAuth?.users ?? []).map(u => [u.id, u.email ?? '']))

  const usuariosComEmail = (usuarios ?? []).map(u => ({ ...u, email: emailPorId.get(u.id) ?? '' }))

  const plano = await loadPlanData(guarda.empresaId, guarda.userId)

  return (
    <UsuariosClient
      usuarios={usuariosComEmail as any[]}
      usuarioAtualId={guarda.userId}
      limiteUsuarios={plano.limites.max_usuarios}
    />
  )
}
