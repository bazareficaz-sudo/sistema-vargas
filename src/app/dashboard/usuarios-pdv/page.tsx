import { createClient } from '@/lib/supabase/server'
import UsuariosPdvClient from '@/components/usuarios-pdv/UsuariosPdvClient'

export const dynamic = 'force-dynamic'

export default async function UsuariosPdvPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, role, tenant_id')
    .eq('id', user!.id)
    .single()

  const empresaAtualId = profile?.empresa_id ?? ''

  const { data: usuarios, error: erroUsuarios } = await supabase
    .from('usuarios_pdv')
    .select('*')
    .eq('empresa_id', empresaAtualId)
    .order('created_at', { ascending: false })

  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, nome, nome_fantasia')
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
