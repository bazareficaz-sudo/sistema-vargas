// Formato do que a vitrine enxerga.
//
// Repare no que NÃO existe aqui: custo, margem, fornecedor, dado fiscal,
// estoque bruto. Não é esquecimento — é a lista branca do projeto, e ela
// começa no tipo. Se um campo desses aparecer nesta interface um dia, é sinal
// de que alguém furou a camada.

export type Loja = {
  id: string
  empresaId: string
  canalId: string
  subdominio: string
  dominioProprio: string | null
  ativo: boolean
  emManutencao: boolean
  indexavel: boolean

  nome: string
  descricao: string | null
  logoUrl: string | null
  faviconUrl: string | null
  telefone: string | null
  whatsapp: string | null
  email: string | null
  cidade: string | null
  uf: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  horarioAtendimento: string | null

  corPrimaria: string
  corDestaque: string

  seoTitle: string | null
  metaDescription: string | null
  ogImageUrl: string | null

  /** Como a vitrine trata item sem saldo. Decide listagem, busca e botão. */
  semEstoqueComportamento: 'ocultar' | 'mostrar_indisponivel'
  permitirVendaSemEstoque: boolean
  limiteMaximoPorCompra: number | null
  entregaAtiva: boolean
  retiradaAtiva: boolean
}

/** O que um card precisa. Nada além disso — card é para decidir o clique. */
export type ProdutoCard = {
  lojaProdutoId: string
  produtoId: string
  slug: string
  nome: string
  marca: string | null
  imagemUrl: string | null
  preco: number
  /** Riscado. Só vem preenchido quando é MAIOR que `preco`. */
  precoDe: number | null
  precoPix: number | null
  estoquePublicavel: number
  destaque: boolean
}

/** A página do produto. Aqui a disponibilidade é AO VIVO, não cache. */
export type ProdutoDetalhe = ProdutoCard & {
  descricaoCurta: string | null
  descricaoCompleta: string | null
  caracteristicas: string[]
  especificacoes: Record<string, string>
  aplicacoes: string | null
  sku: string | null
  ean: string | null
  unidade: string | null
  categoriaId: string | null
  seoTitle: string
  metaDescription: string | null
  imagens: { url: string; alt: string | null }[]
  limiteMaximoPorCompra: number | null
  /** Quanto dá para comprar agora, conferido no momento da renderização. */
  disponivelAgora: number
}

export type Categoria = {
  id: string
  nome: string
  slug: string
  paiId: string | null
  imagemUrl: string | null
  descricao: string | null
  destaque: boolean
  filhos: Categoria[]
}

export type BlocoHome = {
  id: string
  tipo: 'destaques' | 'ofertas' | 'novidades' | 'mais_vendidos' | 'categorias' | 'marcas' | 'selecao'
  titulo: string
  subtitulo: string | null
  limite: number
  produtos: ProdutoCard[]
}

export type Banner = {
  id: string
  titulo: string | null
  subtitulo: string | null
  imagemUrl: string | null
  imagemMobileUrl: string | null
  linkUrl: string | null
  ctaTexto: string | null
}

export type Ordenacao = 'relevancia' | 'menor_preco' | 'maior_preco' | 'novidades' | 'nome'

export type FiltrosBusca = {
  termo?: string
  categoriaId?: string
  marca?: string
  precoMin?: number
  precoMax?: number
  soPromocao?: boolean
  soDisponivel?: boolean
  ordem?: Ordenacao
  pagina?: number
  porPagina?: number
}

export type ResultadoBusca = {
  produtos: ProdutoCard[]
  total: number
  pagina: number
  porPagina: number
  paginas: number
}

/**
 * Item do carrinho, já reconferido contra o banco.
 *
 * `precoMudou` e `quantidadeAjustada` existem porque o carrinho do visitante
 * vive no navegador: o preço e o saldo que ele guardou podem ter envelhecido.
 * Trocar os valores por baixo do cliente seria pior que avisar.
 */
export type ItemCarrinhoConferido = {
  produto: ProdutoCard
  quantidade: number
  quantidadeSolicitada: number
  disponivel: number
  precoAnterior: number | null
  precoMudou: boolean
  quantidadeAjustada: boolean
  indisponivel: boolean
  subtotal: number
}
