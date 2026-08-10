import { createClient } from '@/lib/supabase/server'
import FilaClient from '@/components/marketplaces/FilaClient'

export const dynamic = 'force-dynamic'

export default async function FilaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: config } = await supabase
    .from('marketplace_fila_config')
    .select('*').eq('empresa_id', empresaId).maybeSingle()

  // Pendentes: sujou depois do último envio.
  const { data: pendentes } = await supabase
    .from('marketplace_fila')
    .select('id, produto_id, sujo_em, motivo, prioridade, enviado_em, produtos(nome, sku, estoque)')
    .eq('empresa_id', empresaId)
    .or('enviado_em.is.null,sujo_em.gt.enviado_em')
    .order('prioridade', { ascending: false })
    .order('sujo_em', { ascending: true })
    .limit(100)

  const { count: totalPendentes } = await supabase
    .from('marketplace_fila')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .or('enviado_em.is.null,sujo_em.gt.enviado_em')

  // Últimas simulações — o que a fila TERIA enviado.
  const { data: simulacoes } = await supabase
    .from('marketplace_fila_simulacao')
    .select('id, rodada_em, acao, estoque_sistema, estoque_canal, estoque_enviaria, preco_canal, preco_enviaria, detalhe, canal_id, produto_id, produtos(nome, sku), marketplace_canais(nome, plataforma)')
    .eq('empresa_id', empresaId)
    .order('rodada_em', { ascending: false })
    .limit(200)

  return (
    <FilaClient
      empresaId={empresaId}
      config={config ?? null}
      pendentes={(pendentes ?? []) as any}
      totalPendentes={totalPendentes ?? 0}
      simulacoes={(simulacoes ?? []) as any}
    />
  )
}
