import { createClient } from '@/lib/supabase/server'
import UsuariosPdvClient from '@/components/usuarios-pdv/UsuariosPdvClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function UsuariosPdvPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, role, tenant_id')

  const empresaAtualId = profile?.empresa_id ?? ''

  const { data: usuarios, error: erroUsuarios } = await supabase
    .from('usuarios_pdv')
    .select('*')
    .eq('empresa_id', empresaAtualId)
    .order('created_at', { ascending: false })

  // Sem filtro de tenant_id aqui, essa consulta trazia as empresas de
  // QUALQUER cliente do sistema pro seletor — não só as do próprio grupo
  // empresarial de quem está logado.
  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, nome, nome_fantasia')
    .eq('tenant_id', profile?.tenant_id ?? '')
    .order('nome')

  const { data: depositos } = await supabase
    .from('depositos')
    .select('id, empresa_id, nome, principal')
    .order('principal', { ascending: false })
    .order('nome')

  const empresaAtual = (empresas ?? []).find(e => e.id === empresaAtualId)

  return (
    <UsuariosPdvClient
      usuarios={(usuarios ?? []) as any[]}
      empresas={(empresas ?? []) as any[]}
      depositos={(depositos ?? []) as any[]}
      empresaAtualId={empresaAtualId}
      empresaAtualNome={empresaAtual?.nome_fantasia ?? empresaAtual?.nome ?? ''}
      erroCarregamento={erroUsuarios?.message}
    />
  )
}
