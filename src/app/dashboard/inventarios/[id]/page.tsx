import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import InventarioDetalheClient from '@/components/inventarios/InventarioDetalheClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function InventarioDetalhePage({ params }: { params: { id: string } }) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: inv }, { data: itens }, { data: historico }, { data: categorias }, { data: marcas }] = await Promise.all([
    sb.from('inventarios').select('*').eq('id', params.id).eq('empresa_id', empresaId).single(),
    sb.from('inventario_itens').select('*').eq('inventario_id', params.id).order('produto_nome'),
    sb.from('inventario_historico').select('*').eq('inventario_id', params.id).order('created_at', { ascending: false }).limit(50),
    sb.from('categorias').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    sb.from('marcas').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
  ])

  if (!inv) notFound()

  return (
    <InventarioDetalheClient
      inventario={inv}
      itensIniciais={itens ?? []}
      historicoInicial={historico ?? []}
      empresaId={empresaId}
      operador={user.email ?? ''}
      categorias={categorias ?? []}
      marcas={marcas ?? []}
    />
  )
}
