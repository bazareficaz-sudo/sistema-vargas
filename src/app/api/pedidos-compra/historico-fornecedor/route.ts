import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Histórico de compras de um fornecedor: as entradas de mercadoria já lançadas,
// com os itens de cada uma.
//
// A aba "Histórico do fornecedor" da tela de novo pedido mostrava um texto
// "em desenvolvimento" — nunca foi construída. Os dados sempre estiveram lá,
// em `entradas` + `entrada_itens`.
//
// Entradas canceladas vêm junto, marcadas: some do total, mas continua
// visível. Sumir com ela sem dizer nada faria a soma não bater com o que a
// tela de Entradas mostra, e a diferença ficaria sem explicação.

export async function GET(req: NextRequest) {
  const fornecedorId = req.nextUrl.searchParams.get('fornecedor_id')
  if (!fornecedorId) {
    return NextResponse.json({ error: 'Fornecedor não informado' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Usuário sem empresa vinculada' }, { status: 400 })

  const { data: entradas, error: erroEntradas } = await supabase
    .from('entradas')
    .select('id, numero_entrada, numero_nf, serie, data_entrada, data_emissao, valor_produtos, valor_frete, valor_desconto, valor_outros, valor_total, status, observacoes')
    .eq('empresa_id', empresaId)
    .eq('fornecedor_id', fornecedorId)
    .order('data_entrada', { ascending: false })
    .limit(200)

  if (erroEntradas) {
    return NextResponse.json({ error: `Entradas: ${erroEntradas.message}` }, { status: 500 })
  }

  const ids = (entradas ?? []).map(e => e.id)

  const { data: itens, error: erroItens } = ids.length > 0
    ? await supabase
        .from('entrada_itens')
        .select('entrada_id, produto_id, nome_produto, sku, quantidade, preco_custo_anterior, preco_custo_novo, subtotal')
        .in('entrada_id', ids)
    : { data: [] as Record<string, unknown>[], error: null }

  if (erroItens) {
    return NextResponse.json({ error: `Itens das entradas: ${erroItens.message}` }, { status: 500 })
  }

  const itensPorEntrada: Record<string, Record<string, unknown>[]> = {}
  for (const i of (itens ?? []) as Record<string, unknown>[]) {
    (itensPorEntrada[i.entrada_id as string] ??= []).push(i)
  }

  const lista = (entradas ?? []).map(e => ({
    id: e.id,
    numero: e.numero_entrada,
    numeroNf: e.numero_nf,
    serie: e.serie,
    // data_emissao costuma vir vazia em lançamento manual; a data que sempre
    // existe é a do recebimento.
    data: e.data_emissao || e.data_entrada,
    valorProdutos: Number(e.valor_produtos ?? 0),
    valorFrete: Number(e.valor_frete ?? 0),
    valorDesconto: Number(e.valor_desconto ?? 0),
    valorOutros: Number(e.valor_outros ?? 0),
    valorTotal: Number(e.valor_total ?? 0),
    status: e.status,
    observacoes: e.observacoes,
    itens: (itensPorEntrada[e.id] ?? []).map(i => ({
      produtoId: i.produto_id,
      nome: i.nome_produto,
      sku: i.sku,
      quantidade: Number(i.quantidade ?? 0),
      custoAnterior: Number(i.preco_custo_anterior ?? 0),
      custo: Number(i.preco_custo_novo ?? 0),
      subtotal: Number(i.subtotal ?? 0),
    })),
  }))

  // O resumo ignora canceladas — elas não representam compra que aconteceu.
  const validas = lista.filter(e => e.status !== 'cancelada')
  const datas = validas.map(e => e.data).filter(Boolean).sort()
  const produtosDistintos = new Set(
    validas.flatMap(e => e.itens.map(i => i.produtoId).filter(Boolean)),
  )

  return NextResponse.json({
    resumo: {
      totalCompras: validas.length,
      canceladas: lista.length - validas.length,
      valorTotal: validas.reduce((s, e) => s + e.valorTotal, 0),
      primeiraCompra: datas[0] ?? null,
      ultimaCompra: datas[datas.length - 1] ?? null,
      produtosDistintos: produtosDistintos.size,
    },
    entradas: lista,
  })
}
