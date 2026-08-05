import { createClient } from '@/lib/supabase/server'
import PrecosClient from '@/components/precos/PrecosClient'
import { produtosDaEntrada } from '@/lib/produtos/filtroEntrada'

export const dynamic = 'force-dynamic'
const POR_PAGINA = 100

export default async function PrecosPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; pagina?: string; aba?: string; categoria?: string; ids?: string; origem?: string
    marca?: string; subcategoria?: string; tag?: string; entrada?: string
    entradaDe?: string; entradaAte?: string; precoDe?: string; precoAte?: string
  }>
}) {
  const {
    q = '', pagina = '1', aba = 'precos', categoria = '', ids = '', origem = '',
    marca = '', subcategoria = '', tag = '', entrada = '',
    entradaDe = '', entradaAte = '', precoDe = '', precoAte = '',
  } = await searchParams
  const pg = Math.max(1, parseInt(pagina))
  const offset = (pg - 1) * POR_PAGINA
  const idList = ids ? ids.split(',').filter(Boolean) : []

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: categoriasRows }, { data: marcasRows }] = await Promise.all([
    supabase.from('categorias').select('id, nome, pai_id').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    supabase.from('marcas').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
  ])
  const categoriasTodas = categoriasRows ?? []
  const categoriasRaiz = categoriasTodas.filter(c => !c.pai_id)
  const marcasTodas = marcasRows ?? []

  const { data: tagsRows } = await supabase.from('produtos').select('tags').eq('empresa_id', empresaId).not('tags', 'eq', '{}')
  const tagsDisponiveis = Array.from(new Set<string>((tagsRows ?? []).flatMap((r: any) => (r.tags ?? []) as string[]))).sort()

  // Resolve categoria/subcategoria em nomes exatos (produtos.categoria é um
  // TEXT com o nome escolhido, raiz ou filha — mesmo padrão de produtos/page.tsx).
  let categoriaNomes: string[] | null = null
  if (subcategoria) {
    categoriaNomes = [subcategoria]
  } else if (categoria) {
    const filhas = categoriasTodas.filter(c => c.pai_id && categoriasTodas.find(r => r.id === c.pai_id)?.nome === categoria).map(c => c.nome)
    categoriaNomes = [categoria, ...filhas]
  }

  // Filtro por entrada de mercadoria (número/NF e/ou período de emissão).
  //
  // Usa o módulo compartilhado com a tela de Produtos. A implementação que
  // morava aqui só enxergava `entradas` (lançamento manual) e casava número
  // por semelhança — nota importada por XML era invisível, e digitar "1"
  // trazia meia dúzia de entradas que nada tinham a ver.
  const resultadoEntrada = await produtosDaEntrada(supabase, empresaId, {
    numero: entrada, de: entradaDe, ate: entradaAte,
  })
  const idsDaEntrada = resultadoEntrada?.produtoIds ?? null
  const entradasCasadas = resultadoEntrada?.entradasCasadas ?? []

  function aplicarFiltros(qb: any): any {
    let out = qb
    if (marca) out = out.eq('marca', marca)
    if (categoriaNomes) out = out.in('categoria', categoriaNomes)
    if (tag) out = out.contains('tags', [tag])
    if (precoDe) out = out.gte('preco_atualizado_em', precoDe)
    if (precoAte) out = out.lte('preco_atualizado_em', `${precoAte}T23:59:59`)
    if (idsDaEntrada !== null) out = out.in('id', idsDaEntrada.length ? idsDaEntrada : ['00000000-0000-0000-0000-000000000000'])
    return out
  }

  let query = supabase
    .from('produtos')
    .select('id, nome, sku, categoria, marca, preco_custo, preco_venda, markup, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, ativo, unidade, preco_atualizado_em', { count: 'exact' })
    .eq('empresa_id', empresaId)

  // Modo "produtos de uma seleção" (veio de Entrada por XML ou da tela de
  // Produtos): lista fixa por ID, sem paginação nem os outros filtros — o
  // conjunto já é pequeno e delimitado pelo botão que trouxe o usuário até aqui.
  if (idList.length > 0) {
    query = query.in('id', idList).order('nome')
  } else {
    query = aplicarFiltros(query).eq('ativo', true).order('nome').range(offset, offset + POR_PAGINA - 1)
    // EAN entra na busca junto com nome/SKU — mesma tríade da tela de
    // Produtos, para quem chega com o código de barras em mãos.
    if (q) query = query.or(`nome.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
  }

  const { data: produtos, count } = await query

  const total = idList.length > 0 ? (produtos ?? []).length : (count ?? 0)
  const totalPaginas = idList.length > 0 ? 1 : Math.ceil(total / POR_PAGINA)

  return (
    <PrecosClient
      produtos={produtos ?? []}
      total={total}
      pagina={pg}
      totalPaginas={totalPaginas}
      q={q}
      abaAtiva={aba}
      categoriaFiltro={categoria}
      categoriasRaiz={categoriasRaiz}
      categoriasTodas={categoriasTodas}
      marcas={marcasTodas}
      marcaFiltro={marca}
      subcategoriaFiltro={subcategoria}
      tagFiltro={tag}
      tagsDisponiveis={tagsDisponiveis}
      entradaFiltro={entrada}
      entradasCasadas={entradasCasadas}
      entradaDeFiltro={entradaDe}
      entradaAteFiltro={entradaAte}
      precoDeFiltro={precoDe}
      precoAteFiltro={precoAte}
      empresaId={empresaId}
      idsFiltro={ids}
      origemFiltro={origem}
    />
  )
}
