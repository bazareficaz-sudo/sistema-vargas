import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const fornecedorId = req.nextUrl.searchParams.get('fornecedor_id')
  const empresaId = req.nextUrl.searchParams.get('empresa_id')

  if (!fornecedorId || !empresaId)
    return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 })

  const supabase = await createClient()

  // Busca todos os itens de entradas deste fornecedor
  const { data: itensCompra } = await supabase
    .from('entrada_itens')
    .select('produto_id, quantidade, custo_unitario, entradas!inner(data_entrada, fornecedor_id, empresa_id, status)')
    .eq('entradas.fornecedor_id', fornecedorId)
    .eq('entradas.empresa_id', empresaId)
    .eq('entradas.status', 'confirmada')

  // Agrega estatísticas por produto
  const aggMap: Record<string, {
    custos: number[]
    datas: string[]
    ultimoCusto: number
    ultimaCompra: string
    ultimaQtd: number
  }> = {}

  for (const item of (itensCompra ?? [])) {
    const entrada = Array.isArray(item.entradas) ? item.entradas[0] : item.entradas as { data_entrada: string }
    const data = entrada?.data_entrada ?? ''
    const custo = Number(item.custo_unitario ?? 0)
    const qtd = Number(item.quantidade ?? 0)

    if (!aggMap[item.produto_id]) {
      aggMap[item.produto_id] = { custos: [], datas: [], ultimoCusto: 0, ultimaCompra: '', ultimaQtd: 0 }
    }
    const agg = aggMap[item.produto_id]
    agg.custos.push(custo)
    agg.datas.push(data)
    if (!agg.ultimaCompra || data > agg.ultimaCompra) {
      agg.ultimaCompra = data
      agg.ultimoCusto = custo
      agg.ultimaQtd = qtd
    }
  }

  const produtoIdsDoFornecedor = Object.keys(aggMap)

  // Busca produtos do fornecedor
  const { data: prodsForn } = produtoIdsDoFornecedor.length > 0
    ? await supabase
        .from('produtos')
        .select('id, nome, sku, ean, categoria, marca, estoque, estoque_minimo, estoque_maximo, preco_venda, preco_custo, unidade, ativo')
        .eq('empresa_id', empresaId)
        .in('id', produtoIdsDoFornecedor)
        .eq('ativo', true)
        .order('nome')
    : { data: [] }

  // Busca demais produtos ativos (sem histórico com este fornecedor)
  const { data: prodsExtras } = await supabase
    .from('produtos')
    .select('id, nome, sku, ean, categoria, marca, estoque, estoque_minimo, estoque_maximo, preco_venda, preco_custo, unidade, ativo')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .not('id', 'in', produtoIdsDoFornecedor.length > 0 ? `(${produtoIdsDoFornecedor.map(id => `"${id}"`).join(',')})` : '("")')
    .order('nome')
    .limit(300)

  function buildProduto(p: Record<string, unknown>, fromForn: boolean) {
    const agg = aggMap[p.id as string]
    const custoMedio = agg ? agg.custos.reduce((a, b) => a + b, 0) / agg.custos.length : 0
    const menorCusto = agg ? Math.min(...agg.custos) : 0
    const maiorCusto = agg ? Math.max(...agg.custos) : 0
    const estAtual = Number(p.estoque ?? 0)
    const estMin = Number(p.estoque_minimo ?? 0)
    const estMax = Number(p.estoque_maximo ?? 0)
    const qtdSugerida = estMax > 0
      ? Math.max(0, estMax - estAtual)
      : estMin > 0
        ? Math.max(0, estMin * 2 - estAtual)
        : 0

    return {
      ...p,
      estoque: estAtual,
      estoque_minimo: estMin,
      estoque_maximo: estMax,
      preco_venda: Number(p.preco_venda ?? 0),
      preco_custo: Number(p.preco_custo ?? 0),
      compradoDoFornecedor: fromForn,
      ultimoCusto: agg?.ultimoCusto ?? 0,
      ultimaCompra: agg?.ultimaCompra ?? null,
      ultimaQtd: agg?.ultimaQtd ?? 0,
      custoMedio: Math.round(custoMedio * 100) / 100,
      menorCusto,
      maiorCusto,
      qtdSugerida: Math.ceil(qtdSugerida),
    }
  }

  const produtos = [
    ...(prodsForn ?? []).map(p => buildProduto(p as Record<string, unknown>, true)),
    ...(prodsExtras ?? []).map(p => buildProduto(p as Record<string, unknown>, false)),
  ]

  return NextResponse.json({ produtos })
}
