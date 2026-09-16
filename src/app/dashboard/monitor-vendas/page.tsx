import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { buscarTudo } from '@/lib/supabase/paginar'
import { ABERTOS } from '@/lib/faltas/status'
import MonitorVendasClient from '@/components/monitor-vendas/MonitorVendasClient'

export const dynamic = 'force-dynamic'

// Painel de acompanhamento de vendas, quase em tempo real — pensado tanto
// para uma tela normal do painel quanto para ficar ligado numa TV do balcão
// (modo monitor, em tela cheia).
//
// As últimas 5000 vendas e o catálogo inteiro podem passar de 1000 linhas —
// o teto do PostgREST por requisição — por isso as duas consultas usam
// `buscarTudo`. Foi a falta disso, em outra tela, que fez o card de
// faturamento do mês mostrar só as 1000 vendas mais antigas (ver
// CONTINUIDADE.md). O cálculo de lucro daqui depende de somar TODAS as
// vendas do período, então o mesmo defeito aqui seria pior: lucro errado sem
// nenhum aviso.
const LIMITE_VENDAS = 5000

export default async function MonitorVendasPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id ?? ''

  const [vendas, produtosBrutos, faltasRes] = await Promise.all([
    buscarTudo(
      (de, ate) => sb.from('vendas')
        .select('id, cliente_nome, vendedor_nome, status, total, desconto_total, canal, terminal_id, created_at, itens')
        .eq('empresa_id', empresaId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(de, ate),
      { teto: LIMITE_VENDAS, rotulo: 'monitor-vendas/vendas' },
    ),
    // Catálogo inteiro: é o que permite achar o custo/estoque de um item
    // mesmo que o produto tenha sido renomeado ou trocado de SKU depois da
    // venda (ver `buscarProduto` em lib/monitor-vendas/calculos.ts).
    buscarTudo(
      (de, ate) => sb.from('produtos')
        .select('id, nome, sku, preco_custo, estoque, estoque_minimo, tipo, ativo')
        .eq('empresa_id', empresaId)
        .order('id', { ascending: true })
        .range(de, ate),
      { rotulo: 'monitor-vendas/produtos' },
    ),
    sb.from('faltas')
      .select('id, produto_id, produto_nome, quantidade_solicitada, status')
      .eq('empresa_id', empresaId)
      .in('status', ABERTOS)
      .order('created_at', { ascending: false })
      .limit(1000),
  ])

  const produtos = produtosBrutos.map(p => ({
    id: p.id as string,
    nome: p.nome as string,
    sku: (p.sku as string | null) ?? null,
    custo: Number(p.preco_custo ?? 0),
    estoque: Number(p.estoque ?? 0),
    estoqueMinimo: Number(p.estoque_minimo ?? 0),
    tipo: (p.tipo as string | null) ?? 'simples',
    ativo: p.ativo !== false,
  }))

  const kitIds = produtos.filter(p => p.tipo === 'kit').map(p => p.id)
  const kitItens = kitIds.length > 0
    ? await buscarTudo(
        (de, ate) => sb.from('kit_itens')
          .select('kit_id, produto_id, quantidade, controla_estoque')
          .in('kit_id', kitIds)
          .order('id', { ascending: true })
          .range(de, ate),
        { rotulo: 'monitor-vendas/kit_itens' },
      )
    : []

  return (
    <MonitorVendasClient
      vendasIniciais={vendas as any}
      produtosIniciais={produtos}
      kitItensIniciais={kitItens as any}
      faltasIniciais={faltasRes.data ?? []}
      empresaId={empresaId}
      operador={user.email ?? ''}
      limiteVendas={LIMITE_VENDAS}
    />
  )
}
