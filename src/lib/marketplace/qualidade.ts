// Qualidade do anúncio — o que falta para ele competir bem na busca.
//
// Duas coisas diferentes, deliberadamente separadas:
//
//  - `health`: o índice OFICIAL do Mercado Livre (0 a 1), que vem pronto na
//    sincronização. É o número que o ML usa; a tela mostra ele como sendo
//    deles. A Shopee não publica equivalente na API, então lá é null.
//
//  - `score`: nota do NOSSO checklist (0 a 100), com os mesmos critérios nas
//    duas plataformas. Serve pra ordenar o trabalho e pra Shopee ter alguma
//    medida. A tela chama de "checklist", não de "nota da Shopee" — dar a um
//    número nosso o nome da plataforma seria passar por oficial o que não é.
//
// Os pesos abaixo são escolha nossa. MEDIDO contra os 7.692 anúncios de
// produção: o score NÃO acompanha o health do ML — anúncios com health ≥0,80
// dão score médio 56, e os abaixo de 0,80 dão 54. Ou seja, este checklist
// não serve pra prever o número do ML, e a tela não pode sugerir que sirva.
//
// Por que não bate: 'video' falta em 100% dos anúncios, então não separa
// ninguém de ninguém; e o health do ML pesa coisas que não estão no item
// (reputação, ficha de catálogo). Os pesos internos reais só o endpoint
// /items/{id}/health devolve, item a item — 7.692 chamadas, uma passada à
// parte que fica pra fase 2 e vai substituir estes pesos no lado do ML.
//
// O que o checklist continua valendo: a lista de faltas é factual (sem EAN é
// sem EAN) e serve pra ordenar trabalho e pra dar à Shopee alguma medida,
// onde não existe número oficial nenhum.

export type Falta = {
  codigo: string
  titulo: string
  /** Por que isso importa, em uma linha, para quem não é do ramo. */
  porque: string
  peso: number
  /** Onde o operador resolve — a tela usa pra oferecer o botão certo. */
  ondeResolver: 'imagens' | 'produto' | 'anuncio' | 'video'
}

export type Qualidade = {
  health: number | null
  score: number
  faltas: Falta[]
  /** Sinal próprio da plataforma, quando existe. Hoje só o deboost Shopee. */
  penalizado: boolean
}

const CATALOGO: Record<string, Omit<Falta, 'peso'> & { peso: number }> = {
  fotos: {
    codigo: 'fotos', titulo: 'Menos de 3 fotos', peso: 20, ondeResolver: 'imagens',
    porque: 'Anúncio com poucas fotos converte menos e as duas plataformas o mostram menos.',
  },
  ean: {
    codigo: 'ean', titulo: 'Sem código de barras (EAN/GTIN)', peso: 20, ondeResolver: 'produto',
    porque: 'É o que liga seu anúncio à ficha do produto e às buscas por código.',
  },
  atributos: {
    codigo: 'atributos', titulo: 'Poucos atributos preenchidos', peso: 20, ondeResolver: 'anuncio',
    porque: 'Atributo vazio tira o anúncio dos filtros que o comprador usa.',
  },
  video: {
    codigo: 'video', titulo: 'Sem vídeo', peso: 15, ondeResolver: 'video',
    porque: 'Vídeo é hoje o item de maior peso no índice do Mercado Livre.',
  },
  marca: {
    codigo: 'marca', titulo: 'Sem marca informada', peso: 10, ondeResolver: 'anuncio',
    porque: 'Sem marca o anúncio some do filtro de marca, muito usado na busca.',
  },
  descricao: {
    codigo: 'descricao', titulo: 'Descrição curta ou vazia', peso: 10, ondeResolver: 'anuncio',
    porque: 'A descrição responde a dúvida que faria o comprador desistir.',
  },
  titulo: {
    codigo: 'titulo', titulo: 'Título curto', peso: 5, ondeResolver: 'anuncio',
    porque: 'Título curto usa menos palavras de busca do que a plataforma permite.',
  },
}

const MIN_FOTOS = 3
const MIN_ATRIBUTOS = 5
const MIN_DESCRICAO = 200
const MIN_TITULO = 40

function montar(codigos: string[]): { faltas: Falta[]; score: number } {
  const faltas = codigos.map(c => CATALOGO[c]).filter(Boolean) as Falta[]
  const perdido = faltas.reduce((s, f) => s + f.peso, 0)
  return { faltas, score: Math.max(0, 100 - perdido) }
}

export function avaliarMercadoLivre(brutos: any): Qualidade {
  const b = brutos ?? {}
  const atributos = Array.isArray(b.attributes) ? b.attributes : []
  const preenchidos = atributos.filter((a: any) => a?.value_name)
  const gtin = atributos.find((a: any) => a?.id === 'GTIN')?.value_name
  const marca = atributos.find((a: any) => a?.id === 'BRAND')?.value_name

  const codigos: string[] = []
  if ((b.pictures?.length ?? 0) < MIN_FOTOS) codigos.push('fotos')
  if (!gtin) codigos.push('ean')
  if (preenchidos.length < MIN_ATRIBUTOS) codigos.push('atributos')
  if (!b.video_id) codigos.push('video')
  if (!marca) codigos.push('marca')
  // O ML guarda a descrição fora do item (endpoint próprio), então aqui só
  // dá pra checar quando ela veio junto. Sem o dado, não acuso falta — dizer
  // "sem descrição" de um anúncio que tem seria pior que não dizer nada.
  if (typeof b.descriptions === 'string' && b.descriptions.length < MIN_DESCRICAO) codigos.push('descricao')
  if ((b.title?.length ?? 0) < MIN_TITULO) codigos.push('titulo')

  const { faltas, score } = montar(codigos)
  return {
    health: typeof b.health === 'number' ? b.health : null,
    score, faltas, penalizado: false,
  }
}

export function avaliarShopee(brutos: any): Qualidade {
  const b = brutos ?? {}
  const codigos: string[] = []
  if ((b.image?.image_url_list?.length ?? 0) < MIN_FOTOS) codigos.push('fotos')
  if (!(b.attribute_list?.length)) codigos.push('atributos')
  if (!b.brand?.original_brand_name) codigos.push('marca')
  const desc = typeof b.description === 'string' ? b.description : ''
  if (desc.length < MIN_DESCRICAO) codigos.push('descricao')
  if ((b.item_name?.length ?? 0) < MIN_TITULO) codigos.push('titulo')
  // A Shopee não expõe EAN nem vídeo no get_item_base_info desta conta.
  // Fica de fora do cálculo em vez de virar falta permanente que ninguém
  // consegue resolver — checklist que não fecha nunca as pessoas ignoram.

  const { faltas, score } = montar(codigos)
  return {
    health: null,
    score, faltas,
    // Sinal da própria Shopee: anúncio rebaixado na busca. Vem como string.
    penalizado: String(b.deboost ?? '').toUpperCase() === 'TRUE',
  }
}

export function avaliarAnuncio(plataforma: string, brutos: any): Qualidade {
  return plataforma === 'mercadolivre' ? avaliarMercadoLivre(brutos) : avaliarShopee(brutos)
}

/** Colunas de marketplace_anuncios, prontas para o upsert do sync. */
export function colunasQualidade(plataforma: string, brutos: any) {
  const q = avaliarAnuncio(plataforma, brutos)
  return {
    qualidade_health: q.health,
    qualidade_score: q.score,
    qualidade_faltas: q.faltas.map(f => f.codigo),
    qualidade_em: new Date().toISOString(),
  }
}

export const FALTAS_CATALOGO = CATALOGO
