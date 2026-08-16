import { createClient } from '@/lib/supabase/server'
import { produtosDaEntrada } from '@/lib/produtos/filtroEntrada'
import ProdutosClient from '@/components/produtos/ProdutosClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

const POR_PAGINA = 50

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; pagina?: string; aba?: string; promo?: string; ativos?: string
    marca?: string; categoria?: string; subcategoria?: string
    estoque?: string; imagem?: string; ncm?: string; tag?: string; entrada?: string
    // Abre o cadastro de um produto direto, sem obrigar a procurá-lo na
    // lista. Usado por quem chega de outra tela com um problema apontado —
    // a venda cuja nota foi recusada por falta de dado fiscal, por exemplo.
    editar?: string; abaProduto?: string
  }>
}) {
  const {
    q = '', pagina = '1', aba = 'todos', promo = '', ativos = '1',
    marca = '', categoria = '', subcategoria = '', estoque = '', imagem = '', ncm = '',
    tag = '', entrada = '', editar = '', abaProduto = '',
  } = await searchParams
  const promoFiltro = promo === '1'
  const apenasAtivos = ativos !== '0'
  const pg = Math.max(1, parseInt(pagina))
  const offset = (pg - 1) * POR_PAGINA

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  // Categorias/marcas da empresa — alimentam os selects de filtro e a
  // resolução de hierarquia categoria → subcategorias (produtos.categoria é
  // um TEXT com o nome escolhido, raiz ou filha; não há coluna própria de
  // subcategoria — ver plano).
  const [{ data: categoriasRows }, { data: marcasRows }, { data: canaisShopeeRows }] = await Promise.all([
    supabase.from('categorias').select('id, nome, pai_id').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    supabase.from('marcas').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    supabase.from('marketplace_canais').select('id, nome').eq('empresa_id', empresaId).eq('plataforma', 'shopee'),
  ])
  const categoriasTodas = categoriasRows ?? []
  const categoriasRaiz = categoriasTodas.filter(c => !c.pai_id)
  const marcasTodas = marcasRows ?? []
  const canaisShopee = canaisShopeeRows ?? []

  // Ids-com-imagem — só busca quando o filtro de imagem está ativo.
  let idsComImagem: string[] | null = null
  if (imagem === 'com' || imagem === 'sem') {
    const { data: imgRows } = await supabase
      .from('produto_imagens')
      .select('produto_id')
      .eq('empresa_id', empresaId)
      .limit(20000)
    idsComImagem = [...new Set((imgRows ?? []).map(r => r.produto_id))]
  }

  // Resolve o filtro de categoria/subcategoria em uma lista de nomes exatos
  // a comparar com produtos.categoria.
  let categoriaNomes: string[] | null = null
  if (subcategoria) {
    categoriaNomes = [subcategoria]
  } else if (categoria) {
    const filhas = categoriasTodas.filter(c => c.pai_id && categoriasTodas.find(r => r.id === c.pai_id)?.nome === categoria).map(c => c.nome)
    categoriaNomes = [categoria, ...filhas]
  }

  // Todas as tags já usadas na empresa, para alimentar o select de filtro.
  const { data: tagsRows } = await supabase.from('produtos').select('tags').eq('empresa_id', empresaId).not('tags', 'eq', '{}')
  const tagsDisponiveis = Array.from(new Set<string>((tagsRows ?? []).flatMap((r: any) => (r.tags ?? []) as string[]))).sort()

  // Filtro por entrada de mercadoria — lógica compartilhada com a tela de
  // Gestão de Preços (número exato primeiro, e as duas origens: lançamento
  // manual e nota importada por XML).
  const resultadoEntrada = await produtosDaEntrada(supabase, empresaId, { numero: entrada })
  const idsDaEntrada = resultadoEntrada?.produtoIds ?? null
  const entradasCasadas = resultadoEntrada?.entradasCasadas ?? []

  function aplicarFiltros(qb: any): any {
    let out = qb
    if (apenasAtivos) out = out.eq('ativo', true)
    if (q) out = out.or(`nome.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
    if (promoFiltro) out = out.eq('promocao_ativa', true)
    if (marca) out = out.eq('marca', marca)
    if (categoriaNomes) out = out.in('categoria', categoriaNomes)
    if (estoque === 'com') out = out.gt('estoque', 0)
    if (estoque === 'sem') out = out.lte('estoque', 0)
    // ncm é sempre gravado como null quando vazio (EditarProdutoModal normaliza
    // '' -> null ao salvar), então basta checar IS NULL / IS NOT NULL.
    if (ncm === 'com') out = out.not('ncm', 'is', null)
    if (ncm === 'sem') out = out.is('ncm', null)
    if (tag) out = out.contains('tags', [tag])
    if (idsComImagem !== null) {
      if (imagem === 'com') out = out.in('id', idsComImagem.length ? idsComImagem : ['00000000-0000-0000-0000-000000000000'])
      if (imagem === 'sem') out = idsComImagem.length ? out.not('id', 'in', `(${idsComImagem.map(id => `"${id}"`).join(',')})`) : out
    }
    if (idsDaEntrada !== null) out = out.in('id', idsDaEntrada.length ? idsDaEntrada : ['00000000-0000-0000-0000-000000000000'])
    return out
  }

  let query = supabase
    .from('produtos')
    .select('id, nome, sku, ean, preco_venda, preco_custo, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, unidade, categoria, marca, estoque, estoque_minimo, ativo, disponivel_pdv, permite_fracao, ncm, cest, tipo, ibs_cst, ibs_cclasstrib, ibs_aliquota, cbs_aliquota, tags', { count: 'exact' })
    .eq('empresa_id', empresaId)
    .order('nome')
    .range(offset, offset + POR_PAGINA - 1)

  query = aplicarFiltros(query)
  if (aba !== 'todos') {
    if (aba === 'simples') query = query.in('tipo', ['simples', 'normal', null as unknown as string])
    else query = query.eq('tipo', aba)
  }

  const { data: produtos, count } = await query

  // Imagens principais dos produtos desta página
  const produtoIds = (produtos ?? []).map(p => p.id)
  let imagensMap: Record<string, string> = {}
  if (produtoIds.length > 0) {
    const { data: imgs } = await supabase
      .from('produto_imagens')
      .select('produto_id, url')
      .in('produto_id', produtoIds)
      .eq('principal', true)
    for (const img of imgs ?? []) imagensMap[img.produto_id] = img.url
  }

  // Onde cada produto desta página está anunciado.
  //
  // Conta os anúncios diretos e também as variações — uma variação é um
  // anúncio de verdade do ponto de vista de quem vende, e ignorá-la faria o
  // selo dizer "sem anúncio" para produto que está à venda.
  //
  // Anúncio encerrado não entra: ele não está mais à venda, e contá-lo
  // faria o selo prometer presença num canal onde o produto já saiu.
  const anunciosMap: Record<string, Record<string, { total: number; ativos: number }>> = {}
  if (produtoIds.length > 0) {
    const [{ data: diretos }, { data: variacoes }] = await Promise.all([
      supabase.from('marketplace_anuncios')
        .select('produto_id, status, marketplace_canais(plataforma)')
        .in('produto_id', produtoIds).neq('status', 'encerrado'),
      supabase.from('marketplace_anuncio_variacoes')
        .select('produto_id, marketplace_anuncios!inner(status, marketplace_canais(plataforma))')
        .in('produto_id', produtoIds),
    ])

    const somar = (produtoId: string, plataforma: string, status: string) => {
      if (!produtoId || !plataforma) return
      const porProduto = anunciosMap[produtoId] ??= {}
      const alvo = porProduto[plataforma] ??= { total: 0, ativos: 0 }
      alvo.total++
      if (status === 'ativo') alvo.ativos++
    }
    for (const a of (diretos ?? []) as any[]) {
      const canal = Array.isArray(a.marketplace_canais) ? a.marketplace_canais[0] : a.marketplace_canais
      somar(a.produto_id, canal?.plataforma, a.status)
    }
    for (const v of (variacoes ?? []) as any[]) {
      const anuncio = Array.isArray(v.marketplace_anuncios) ? v.marketplace_anuncios[0] : v.marketplace_anuncios
      if (!anuncio || anuncio.status === 'encerrado') continue
      const canal = Array.isArray(anuncio.marketplace_canais) ? anuncio.marketplace_canais[0] : anuncio.marketplace_canais
      somar(v.produto_id, canal?.plataforma, anuncio.status)
    }
  }

  // Contagens para as abas — aplicam os mesmos filtros (busca, promoção e os
  // novos filtros de marca/categoria/estoque/imagem/ncm), exceto a aba em si.
  function baseCount() {
    let q2 = supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId)
    return aplicarFiltros(q2)
  }
  const [todosRes, simplesRes, kitsRes, promoRes] = await Promise.all([
    baseCount(),
    baseCount().in('tipo', ['simples', 'normal']),
    baseCount().eq('tipo', 'kit'),
    aplicarFiltros(supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId)).eq('promocao_ativa', true),
  ])
  const totalSimples = simplesRes.count ?? 0
  const totalKits = kitsRes.count ?? 0
  const totalEmPromocao = promoRes.count ?? 0

  // total da aba ativa (usado para paginação); todosRes conta sem filtro de aba
  const total = count ?? 0
  const totalTodos = todosRes.count ?? 0
  const totalPaginas = Math.ceil(total / POR_PAGINA)

  return (
    <ProdutosClient
      produtos={produtos ?? []}
      imagensMap={imagensMap}
      total={total}
      totalAtivos={total}
      totalInativos={0}
      totalTodos={totalTodos}
      totalSimples={totalSimples}
      totalKits={totalKits}
      totalEmPromocao={totalEmPromocao}
      pagina={pg}
      totalPaginas={totalPaginas}
      q={q}
      abaAtiva={aba}
      promoFiltro={promoFiltro}
      apenasAtivos={apenasAtivos}
      empresaId={empresaId}
      anunciosMap={anunciosMap}
      abrirProdutoId={editar}
      abrirProdutoAba={abaProduto}
      categoriasRaiz={categoriasRaiz}
      categoriasTodas={categoriasTodas}
      marcas={marcasTodas}
      marcaFiltro={marca}
      categoriaFiltro={categoria}
      subcategoriaFiltro={subcategoria}
      estoqueFiltro={estoque}
      imagemFiltro={imagem}
      ncmFiltro={ncm}
      tagFiltro={tag}
      entradaFiltro={entrada}
      entradasCasadas={entradasCasadas}
      tagsDisponiveis={tagsDisponiveis}
      canaisShopee={canaisShopee}
    />
  )
}
