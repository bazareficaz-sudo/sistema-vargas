import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Produtos disponíveis para montar um pedido de compra, com o histórico de
// compra deste fornecedor anexado a cada um.
//
// Duas colunas estavam erradas e deixavam a tela inteira vazia — as consultas
// falhavam e o resultado virava lista vazia em silêncio, sem nada na tela que
// indicasse erro:
//   entrada_itens.custo_unitario  -> não existe; o custo unitário é preco_custo_novo
//   produtos.estoque_maximo       -> não existe; só há estoque e estoque_minimo
//
// Por isso agora todo erro de consulta vira resposta 500 com a mensagem do
// banco, em vez de lista vazia.

const CAMPOS_PRODUTO =
  'id, nome, sku, ean, categoria, marca, estoque, estoque_minimo, preco_venda, preco_custo, unidade, ativo'

// Teto de produtos "sem histórico com este fornecedor" devolvidos de uma vez.
// O catálogo passa de 14 mil itens — mandar tudo trava o navegador. Quem
// procura algo fora dessa fatia usa a busca, que agora vai ao banco (ver
// `busca` abaixo) em vez de filtrar só o que já veio.
const LIMITE_EXTRAS = 300

export async function GET(req: NextRequest) {
  const fornecedorId = req.nextUrl.searchParams.get('fornecedor_id')
  const busca = (req.nextUrl.searchParams.get('busca') ?? '').trim()

  if (!fornecedorId) {
    return NextResponse.json({ error: 'Fornecedor não informado' }, { status: 400 })
  }

  const supabase = await createClient()

  // A empresa vem da sessão, não da query. Antes vinha do parâmetro
  // `empresa_id` mandado pelo navegador — qualquer usuário logado podia trocar
  // esse valor e ler o catálogo de outra empresa.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(supabase, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Usuário sem empresa vinculada' }, { status: 400 })

  // ── Histórico de compra deste fornecedor ──────────────────────────────────
  //
  // São DUAS origens de compra, e ler só uma esconde metade do histórico:
  // lançamento manual (entradas) e importação de XML (nfe_entradas). Há
  // fornecedor que só aparece numa delas — a DIME, por exemplo, tem 7 notas
  // por XML e nenhuma entrada manual.

  const aggMap: Record<string, {
    custos: number[]
    ultimoCusto: number
    ultimaCompra: string
    ultimaQtd: number
  }> = {}

  function registrar(produtoId: string | null, data: string, custo: number, qtd: number) {
    if (!produtoId) return
    const agg = (aggMap[produtoId] ??= { custos: [], ultimoCusto: 0, ultimaCompra: '', ultimaQtd: 0 })
    agg.custos.push(custo)
    if (!agg.ultimaCompra || data > agg.ultimaCompra) {
      agg.ultimaCompra = data
      agg.ultimoCusto = custo
      agg.ultimaQtd = qtd
    }
  }

  const { data: itensManuais, error: erroManuais } = await supabase
    .from('entrada_itens')
    .select('produto_id, quantidade, preco_custo_novo, entradas!inner(data_entrada, fornecedor_id, empresa_id, status)')
    .eq('entradas.fornecedor_id', fornecedorId)
    .eq('entradas.empresa_id', empresaId)
    .eq('entradas.status', 'confirmada')

  if (erroManuais) {
    return NextResponse.json({ error: `Histórico (entradas manuais): ${erroManuais.message}` }, { status: 500 })
  }

  for (const item of (itensManuais ?? [])) {
    const entrada = Array.isArray(item.entradas) ? item.entradas[0] : item.entradas as { data_entrada: string }
    registrar(
      item.produto_id,
      entrada?.data_entrada ?? '',
      Number(item.preco_custo_novo ?? 0),
      Number(item.quantidade ?? 0),
    )
  }

  // Nota importada: 'cancelada' fica de fora; 'aguardando_precos' entra,
  // porque a mercadoria chegou — só o preço ainda não foi fechado.
  const { data: itensNfe, error: erroNfe } = await supabase
    .from('nfe_itens')
    .select('produto_id, quantidade_entrada, custo_unitario, nfe_entradas!inner(data_emissao, data_entrada, fornecedor_id, empresa_id, status)')
    .eq('nfe_entradas.fornecedor_id', fornecedorId)
    .eq('nfe_entradas.empresa_id', empresaId)
    .neq('nfe_entradas.status', 'cancelada')

  if (erroNfe) {
    return NextResponse.json({ error: `Histórico (notas importadas): ${erroNfe.message}` }, { status: 500 })
  }

  for (const item of (itensNfe ?? [])) {
    const nota = Array.isArray(item.nfe_entradas) ? item.nfe_entradas[0] : item.nfe_entradas as { data_emissao: string; data_entrada: string }
    registrar(
      item.produto_id,
      nota?.data_emissao || nota?.data_entrada || '',
      Number(item.custo_unitario ?? 0),
      Number(item.quantidade_entrada ?? 0),
    )
  }

  const idsDoFornecedor = Object.keys(aggMap)

  // ── Produtos já comprados deste fornecedor ────────────────────────────────

  const { data: prodsForn, error: erroForn } = idsDoFornecedor.length > 0
    ? await supabase
        .from('produtos')
        .select(CAMPOS_PRODUTO)
        .eq('empresa_id', empresaId)
        .in('id', idsDoFornecedor)
        .eq('ativo', true)
        .order('nome')
    : { data: [] as Record<string, unknown>[], error: null }

  if (erroForn) {
    return NextResponse.json({ error: `Produtos do fornecedor: ${erroForn.message}` }, { status: 500 })
  }

  // ── Demais produtos do catálogo ───────────────────────────────────────────
  //
  // A exclusão dos já listados acima é feita aqui em JavaScript, e não com um
  // `not.in` no banco: aquela lista vai inteira na URL da consulta, e um
  // fornecedor com centenas de produtos gerava uma URL grande o bastante para
  // a requisição falhar.

  let consultaExtras = supabase
    .from('produtos')
    .select(CAMPOS_PRODUTO)
    .eq('empresa_id', empresaId)
    .eq('ativo', true)

  if (busca) {
    // Vírgula e parênteses são separadores da sintaxe do `or` do PostgREST —
    // deixá-los passar quebraria a consulta.
    const termo = busca.replace(/[,()%]/g, ' ').trim()
    if (termo) {
      consultaExtras = consultaExtras.or(`nome.ilike.%${termo}%,sku.ilike.%${termo}%,ean.ilike.%${termo}%`)
    }
  }

  const { data: extrasBrutos, error: erroExtras } = await consultaExtras
    .order('nome')
    .limit(LIMITE_EXTRAS + idsDoFornecedor.length)

  if (erroExtras) {
    return NextResponse.json({ error: `Catálogo: ${erroExtras.message}` }, { status: 500 })
  }

  const jaListados = new Set(idsDoFornecedor)
  const brutos = (extrasBrutos ?? []) as Record<string, unknown>[]
  const prodsExtras = brutos.filter(p => !jaListados.has(p.id as string)).slice(0, LIMITE_EXTRAS)

  function montar(p: Record<string, unknown>, doFornecedor: boolean) {
    const agg = aggMap[p.id as string]
    const custoMedio = agg && agg.custos.length > 0
      ? agg.custos.reduce((a, b) => a + b, 0) / agg.custos.length
      : 0
    const estAtual = Number(p.estoque ?? 0)
    const estMin = Number(p.estoque_minimo ?? 0)

    // Quantidade sugerida. Só 2 dos 14.298 produtos ativos têm estoque mínimo
    // cadastrado, então a regra do mínimo sozinha praticamente nunca dispara —
    // por isso a segunda regra, que usa o que de fato existe: o que se comprou
    // da última vez deste mesmo fornecedor.
    const qtdSugerida =
      estMin > 0 && estAtual < estMin ? Math.max(0, estMin * 2 - estAtual)
      : doFornecedor && estAtual <= 0 ? (agg?.ultimaQtd ?? 0)
      : 0

    return {
      ...p,
      estoque: estAtual,
      estoque_minimo: estMin,
      preco_venda: Number(p.preco_venda ?? 0),
      preco_custo: Number(p.preco_custo ?? 0),
      compradoDoFornecedor: doFornecedor,
      ultimoCusto: agg?.ultimoCusto ?? 0,
      ultimaCompra: agg?.ultimaCompra || null,
      ultimaQtd: agg?.ultimaQtd ?? 0,
      custoMedio: Math.round(custoMedio * 100) / 100,
      menorCusto: agg && agg.custos.length > 0 ? Math.min(...agg.custos) : 0,
      maiorCusto: agg && agg.custos.length > 0 ? Math.max(...agg.custos) : 0,
      qtdSugerida: Math.ceil(qtdSugerida),
    }
  }

  const produtos = [
    ...((prodsForn ?? []) as Record<string, unknown>[]).map(p => montar(p, true)),
    ...prodsExtras.map(p => montar(p, false)),
  ]

  return NextResponse.json({
    produtos,
    // Avisa a tela que o catálogo foi cortado, para ela pedir uma busca mais
    // específica em vez de deixar o operador achar que o produto não existe.
    limiteExtras: prodsExtras.length >= LIMITE_EXTRAS,
  })
}
