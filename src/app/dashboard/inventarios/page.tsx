import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import InventariosClient from '@/components/inventarios/InventariosClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function InventariosPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id, 'empresa_id, role')
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: inventarios }, { data: depositos }, { data: categorias }, { data: marcas }] = await Promise.all([
    sb.from('inventarios')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('depositos')
      .select('id, nome')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .order('nome'),
    sb.from('categorias')
      .select('id, nome')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .order('nome'),
    sb.from('marcas')
      .select('id, nome')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .order('nome'),
  ])

  return (
    <InventariosClient
      empresaId={empresaId}
      operador={user.email ?? ''}
      inventarios={inventarios ?? []}
      depositos={depositos ?? []}
      categorias={categorias ?? []}
      marcas={marcas ?? []}
    />
  )
}
