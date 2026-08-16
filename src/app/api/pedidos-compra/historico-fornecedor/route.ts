import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Histórico de compras de um fornecedor.
//
// O sistema tem DUAS origens de compra, e ler só uma delas esconde metade do
// histórico:
//   entradas + entrada_itens   → lançamento manual de mercadoria
//   nfe_entradas + nfe_itens   → importação do XML da nota
//
// A primeira versão desta tela lia só a manual. O fornecedor DIME, por
// exemplo, tem 7 notas por XML e nenhuma entrada manual — a aba aparecia
// vazia como se ele nunca tivesse vendido nada.

type ItemHistorico = {
  produtoId: string | null
  nome: string
  sku: string | null
  quantidade: number
  custoAnterior: number
  custo: number
  subtotal: number
}

type CompraHistorico = {
  id: string
  origem: 'manual' | 'xml'
  numero: string | null
  numeroNf: string | null
  serie: string | null
  data: string | null
  valorProdutos: number
  valorFrete: number
  valorDesconto: number
  valorOutros: number
  valorTotal: number
  status: string
  observacoes: string | null
  itens: ItemHistorico[]
}

/** Compra que não entra nos totais: foi desfeita, não aconteceu. */
function ehCancelada(status: string) {
  return status === 'cancelada' || status === 'cancelado'
}

export async function GET(req: NextRequest) {
  const fornecedorId = req.nextUrl.searchParams.get('fornecedor_id')
  if (!fornecedorId) {
    return NextResponse.json({ error: 'Fornecedor não informado' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(supabase, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Usuário sem empresa vinculada' }, { status: 400 })

  // ── Entradas manuais ──────────────────────────────────────────────────────

  const { data: entradas, error: erroEntradas } = await supabase
    .from('entradas')
    .select('id, numero_entrada, numero_nf, serie, data_entrada, data_emissao, valor_produtos, valor_frete, valor_desconto, valor_outros, valor_total, status, observacoes')
    .eq('empresa_id', empresaId)
    .eq('fornecedor_id', fornecedorId)
    .order('data_entrada', { ascending: false })
    .limit(200)

  if (erroEntradas) {
    return NextResponse.json({ error: `Entradas manuais: ${erroEntradas.message}` }, { status: 500 })
  }

  const idsManuais = (entradas ?? []).map(e => e.id)
  const { data: itensManuais, error: erroItensManuais } = idsManuais.length > 0
    ? await supabase
        .from('entrada_itens')
        .select('entrada_id, produto_id, nome_produto, sku, quantidade, preco_custo_anterior, preco_custo_novo, subtotal')
        .in('entrada_id', idsManuais)
    : { data: [] as Record<string, unknown>[], error: null }

  if (erroItensManuais) {
    return NextResponse.json({ error: `Itens das entradas manuais: ${erroItensManuais.message}` }, { status: 500 })
  }

  // ── Entradas por XML ──────────────────────────────────────────────────────

  const { data: nfes, error: erroNfe } = await supabase
    .from('nfe_entradas')
    .select('id, numero, serie, data_emissao, data_entrada, valor_produtos, valor_frete, valor_desconto, outras_despesas, valor_total, status, justificativa')
    .eq('empresa_id', empresaId)
    .eq('fornecedor_id', fornecedorId)
    .order('data_emissao', { ascending: false })
    .limit(200)

  if (erroNfe) {
    return NextResponse.json({ error: `Entradas por XML: ${erroNfe.message}` }, { status: 500 })
  }

  const idsNfe = (nfes ?? []).map(e => e.id)
  const { data: itensNfe, error: erroItensNfe } = idsNfe.length > 0
    ? await supabase
        .from('nfe_itens')
        .select('entrada_id, produto_id, produto_nome, produto_sku, descricao_xml, quantidade_entrada, custo_anterior, custo_unitario, custo_total')
        .in('entrada_id', idsNfe)
    : { data: [] as Record<string, unknown>[], error: null }

  if (erroItensNfe) {
    return NextResponse.json({ error: `Itens das notas: ${erroItensNfe.message}` }, { status: 500 })
  }

  // ── Junta as duas origens num histórico só ────────────────────────────────

  const porEntradaManual: Record<string, ItemHistorico[]> = {}
  for (const i of (itensManuais ?? []) as Record<string, any>[]) {
    (porEntradaManual[i.entrada_id] ??= []).push({
      produtoId: i.produto_id ?? null,
      nome: i.nome_produto ?? 'Item sem nome',
      sku: i.sku ?? null,
      quantidade: Number(i.quantidade ?? 0),
      custoAnterior: Number(i.preco_custo_anterior ?? 0),
      custo: Number(i.preco_custo_novo ?? 0),
      subtotal: Number(i.subtotal ?? 0),
    })
  }

  const porEntradaNfe: Record<string, ItemHistorico[]> = {}
  for (const i of (itensNfe ?? []) as Record<string, any>[]) {
    (porEntradaNfe[i.entrada_id] ??= []).push({
      produtoId: i.produto_id ?? null,
      // Item de XML nem sempre está casado com um produto do cadastro; aí
      // vale a descrição que veio na nota, para a linha não sair vazia.
      nome: i.produto_nome ?? i.descricao_xml ?? 'Item sem nome',
      sku: i.produto_sku ?? null,
      quantidade: Number(i.quantidade_entrada ?? 0),
      custoAnterior: Number(i.custo_anterior ?? 0),
      custo: Number(i.custo_unitario ?? 0),
      // `custo_total` vem gravado pelo importador e nem sempre é
      // quantidade × custo unitário: em item vendido por embalagem (ex.
      // "C/20KG"), a quantidade é de pacotes e o total é do conteúdo.
      // Recalcular aqui produziria um número que discorda do resto do
      // sistema — então o valor mostrado é o que ele gravou.
      subtotal: Number(i.custo_total ?? 0),
    })
  }

  const lista: CompraHistorico[] = [
    ...(entradas ?? []).map(e => ({
      id: e.id,
      origem: 'manual' as const,
      numero: e.numero_entrada,
      numeroNf: e.numero_nf,
      serie: e.serie,
      data: e.data_emissao || e.data_entrada,
      valorProdutos: Number(e.valor_produtos ?? 0),
      valorFrete: Number(e.valor_frete ?? 0),
      valorDesconto: Number(e.valor_desconto ?? 0),
      valorOutros: Number(e.valor_outros ?? 0),
      valorTotal: Number(e.valor_total ?? 0),
      status: e.status,
      observacoes: e.observacoes,
      itens: porEntradaManual[e.id] ?? [],
    })),
    ...(nfes ?? []).map(e => ({
      id: e.id,
      origem: 'xml' as const,
      numero: null,
      numeroNf: e.numero != null ? String(e.numero) : null,
      serie: e.serie != null ? String(e.serie) : null,
      data: e.data_emissao || e.data_entrada,
      valorProdutos: Number(e.valor_produtos ?? 0),
      valorFrete: Number(e.valor_frete ?? 0),
      valorDesconto: Number(e.valor_desconto ?? 0),
      valorOutros: Number(e.outras_despesas ?? 0),
      valorTotal: Number(e.valor_total ?? 0),
      status: e.status,
      observacoes: e.justificativa ?? null,
      itens: porEntradaNfe[e.id] ?? [],
    })),
  ].sort((a, b) => String(b.data ?? '').localeCompare(String(a.data ?? '')))

  const validas = lista.filter(e => !ehCancelada(e.status))
  const datas = validas.map(e => e.data).filter(Boolean).sort() as string[]
  const produtosDistintos = new Set(
    validas.flatMap(e => e.itens.map(i => i.produtoId).filter(Boolean)),
  )

  return NextResponse.json({
    resumo: {
      totalCompras: validas.length,
      canceladas: lista.length - validas.length,
      manuais: validas.filter(e => e.origem === 'manual').length,
      porXml: validas.filter(e => e.origem === 'xml').length,
      valorTotal: validas.reduce((s, e) => s + e.valorTotal, 0),
      primeiraCompra: datas[0] ?? null,
      ultimaCompra: datas[datas.length - 1] ?? null,
      produtosDistintos: produtosDistintos.size,
    },
    entradas: lista,
  })
}
