import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DetalheDepositoClient from '@/components/depositos/DetalheDepositoClient'

export const dynamic = 'force-dynamic'

export default async function DetalheDepositoPage({ params }: { params: { id: string } }) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb
    .from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: deposito }, { data: estoque }, { data: movimentacoes }, { data: depositos }] = await Promise.all([
    sb.from('depositos').select('*').eq('id', params.id).eq('empresa_id', empresaId).single(),
    sb.from('produto_estoque')
      .select('*, produtos(id, nome, sku, ean, unidade, marca, categoria, preco_venda, preco_custo)')
      .eq('deposito_id', params.id)
      .eq('empresa_id', empresaId)
      .order('ultima_movimentacao', { ascending: false })
      .limit(500),
    sb.from('estoque_movimentacoes')
      .select('*')
      .eq('deposito_id', params.id)
      .order('created_at', { ascending: false })
      .limit(100),
    sb.from('depositos')
      .select('id, nome')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .neq('id', params.id),
  ])

  if (!deposito) notFound()

  return (
    <DetalheDepositoClient
      deposito={deposito}
      estoqueInicial={estoque ?? []}
      movimentacoesIniciais={movimentacoes ?? []}
      outrosDepositos={depositos ?? []}
      empresaId={empresaId}
      operador={user.email ?? ''}
    />
  )
}
