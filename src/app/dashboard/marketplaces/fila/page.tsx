import { createClient } from '@/lib/supabase/server'
import FilaClient from '@/components/marketplaces/FilaClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function FilaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: config } = await supabase
    .from('marketplace_fila_config')
    .select('*').eq('empresa_id', empresaId).maybeSingle()

  // OS CANAIS, com a escolha de simulacao de cada um. `fila_simulacao` nula
  // significa "herda da empresa" — a coluna e nulavel justamente para isso.
  const { data: canaisFila } = await supabase
    .from('marketplace_canais')
    .select('id, nome, plataforma, ativo, fila_simulacao, atualizar_estoque_canal')
    .eq('empresa_id', empresaId).eq('ativo', true).order('nome')

  // Pendentes: sujou depois do último envio.
  const { data: pendentes } = await supabase
    .from('marketplace_fila')
    .select('id, produto_id, sujo_em, motivo, prioridade, enviado_em, produtos(nome, sku, estoque)')
    .eq('empresa_id', empresaId)
    .is('enviado_em', null)
    .order('prioridade', { ascending: false })
    .order('sujo_em', { ascending: true })
    .limit(100)

  const { count: totalPendentes } = await supabase
    .from('marketplace_fila')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .is('enviado_em', null)

  // Últimas simulações — o que a fila TERIA enviado.
  const { data: simulacoes } = await supabase
    .from('marketplace_fila_simulacao')
    .select('id, rodada_em, acao, estoque_sistema, estoque_canal, estoque_enviaria, preco_canal, preco_enviaria, detalhe, canal_id, produto_id, produtos(nome, sku), marketplace_canais(nome, plataforma)')
    .eq('empresa_id', empresaId)
    .order('rodada_em', { ascending: false })
    .limit(200)

  return (
    <FilaClient
      canais={canaisFila ?? []}
      empresaId={empresaId}
      config={config ?? null}
      pendentes={(pendentes ?? []) as any}
      totalPendentes={totalPendentes ?? 0}
      simulacoes={(simulacoes ?? []) as any}
    />
  )
}
