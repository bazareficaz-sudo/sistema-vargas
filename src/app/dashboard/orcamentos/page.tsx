import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OrcamentosClient from '@/components/orcamentos/OrcamentosClient'

export const dynamic = 'force-dynamic'

export default async function OrcamentosPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb
    .from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: orcamentos } = await sb
    .from('orcamentos')
    .select('*, clientes(nome, telefone), orcamento_itens(id, produto_nome, quantidade, preco_unitario, desconto, total)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(100)

  return <OrcamentosClient empresaId={empresaId} orcamentos={orcamentos ?? []} />
}
