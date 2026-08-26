// Leitura do conteúdo EDITÁVEL de um anúncio a partir de `dados_brutos`.
//
// `dados_brutos` guarda o item inteiro como a plataforma devolveu. Quem
// precisa de um pedaço dele — replicar, duplicar, editar — vinha
// reimplementando a mesma leitura, e leitura duplicada de payload de
// terceiro é onde nasce a divergência: um lugar aprende que `value_id: 0`
// significa texto livre, o outro não, e os dois discordam sobre o mesmo
// anúncio.
//
// Aqui é só LEITURA e NORMALIZAÇÃO. Nada neste arquivo fala com marketplace.

// ── Atributos ───────────────────────────────────────────────────────────────

/** Valor escolhido de um atributo da Shopee. Espelha o `ValorEscolhido` da
 *  tela: lista fechada usa `valueIds`, texto livre usa `texto`. */
export type AtributoShopeePreenchido = {
  attributeId: number
  valueIds: number[]
  texto?: string
  unidade?: string
}

export type AtributoMLPreenchido = { id: string; valor: string }

/**
 * A Shopee devolve cada atributo como uma lista de valores escolhidos.
 * `value_id: 0` é texto livre (o nome digitado vai em `original_value_name`);
 * qualquer outro é opção da lista da categoria — e como o id do atributo e o
 * do valor pertencem à CATEGORIA, não à loja, valem igual em qualquer anúncio
 * da mesma categoria.
 */
export function atributosDaShopee(dadosBrutos: any): AtributoShopeePreenchido[] {
  const lista = dadosBrutos?.attribute_list
  if (!Array.isArray(lista)) return []
  const saida: AtributoShopeePreenchido[] = []
  for (const a of lista) {
    const attributeId = Number(a?.attribute_id)
    if (!attributeId) continue
    const valores = Array.isArray(a?.attribute_value_list) ? a.attribute_value_list : []
    const valueIds: number[] = []
    let texto: string | undefined
    let unidade: string | undefined
    for (const v of valores) {
      const id = Number(v?.value_id ?? 0)
      if (id > 0) { valueIds.push(id); continue }
      const nome = v?.original_value_name
      if (typeof nome === 'string' && nome.trim()) {
        texto = nome.trim()
        if (typeof v?.value_unit === 'string' && v.value_unit.trim()) unidade = v.value_unit.trim()
      }
    }
    if (valueIds.length === 0 && !texto) continue
    saida.push({ attributeId, valueIds, texto, unidade })
  }
  return saida
}

/**
 * Atributos do Mercado Livre. Os de catálogo/somente-leitura não podem ser
 * reenviados, e alguns vêm sem `value_name` (só `struct`) — inúteis para
 * edição, então ficam de fora.
 */
export function atributosDoMercadoLivre(dadosBrutos: any): AtributoMLPreenchido[] {
  const lista = dadosBrutos?.attributes
  if (!Array.isArray(lista)) return []
  const atributos: AtributoMLPreenchido[] = []
  for (const a of lista) {
    const id = a?.id
    const valor = a?.value_name
    if (typeof id !== 'string' || typeof valor !== 'string' || !valor.trim()) continue
    atributos.push({ id, valor: valor.trim() })
  }
  return atributos
}

/** Canais de envio ligados no anúncio Shopee. Fazem parte do "resto igual"
 *  numa duplicação: publicar sem eles deixaria o anúncio novo sem frete. */
export function logisticaDaShopee(dadosBrutos: any): number[] {
  const lista = dadosBrutos?.logistic_info
  if (!Array.isArray(lista)) return []
  return lista.filter((l: any) => l?.enabled).map((l: any) => Number(l.logistic_id)).filter(Boolean)
}

// ── Imagens ─────────────────────────────────────────────────────────────────

/**
 * Uma foto do anúncio.
 *
 * `idExterno` é o que separa reordenar de reenviar: a foto que já está na
 * plataforma tem id lá (`image_id` na Shopee, `picture.id` no ML), e mudar a
 * ordem dela é mandar a mesma lista de ids noutra ordem — sem upload nenhum.
 * Foto nova (nossa, do bucket ou de uma URL colada) chega sem id e precisa
 * subir. Perder essa distinção significaria reprocessar 9 imagens a cada
 * troca de capa.
 */
export type ImagemAnuncio = { url: string; idExterno: string | null }

export function imagensDoAnuncio(
  plataforma: string,
  dadosBrutos: any,
  imagensSalvas: unknown,
): ImagemAnuncio[] {
  const urlsSalvas: string[] = Array.isArray(imagensSalvas)
    ? imagensSalvas.filter((u: unknown): u is string => typeof u === 'string' && !!u.trim())
    : []

  if (plataforma === 'shopee') {
    const ids: string[] = Array.isArray(dadosBrutos?.image?.image_id_list) ? dadosBrutos.image.image_id_list : []
    const urls: string[] = Array.isArray(dadosBrutos?.image?.image_url_list) ? dadosBrutos.image.image_url_list : []
    if (urls.length > 0) {
      return urls.map((url: string, i: number) => ({ url, idExterno: ids[i] ?? null }))
    }
  }

  if (plataforma === 'mercadolivre') {
    const pics: any[] = Array.isArray(dadosBrutos?.pictures) ? dadosBrutos.pictures : []
    if (pics.length > 0) {
      return pics
        .map(p => ({
          // `secure_url` porque `url` vem em http — imagem insegura numa
          // página https não carrega em navegador nenhum.
          url: typeof p?.secure_url === 'string' ? p.secure_url : (typeof p?.url === 'string' ? p.url : ''),
          idExterno: typeof p?.id === 'string' ? p.id : null,
        }))
        .filter(p => !!p.url)
    }
  }

  if (plataforma === 'nuvemshop') {
    const imgs: any[] = Array.isArray(dadosBrutos?.images) ? dadosBrutos.images : []
    if (imgs.length > 0) {
      return imgs
        .map(i => ({ url: typeof i?.src === 'string' ? i.src : '', idExterno: i?.id != null ? String(i.id) : null }))
        .filter(i => !!i.url)
    }
  }

  // Sem `dados_brutos` utilizável: a coluna `imagens` é o que sobra. Sem id,
  // então tudo que for enviado a partir daqui sobe de novo.
  return urlsSalvas.map(url => ({ url, idExterno: null }))
}

// ── Ficha do pacote e identificação ─────────────────────────────────────────

export type FichaAnuncio = {
  pesoKg: number | null
  comprimentoCm: number | null
  larguraCm: number | null
  alturaCm: number | null
  condicao: 'NEW' | 'USED' | null
  marcaId: number | null
  marcaNome: string | null
  categoriaId: string | null
  skuCanal: string | null
}

export function fichaDoAnuncio(plataforma: string, dadosBrutos: any): FichaAnuncio {
  const b: any = dadosBrutos ?? {}

  if (plataforma === 'shopee') {
    return {
      pesoKg: numeroOuNulo(b.weight),
      comprimentoCm: numeroOuNulo(b.dimension?.package_length),
      larguraCm: numeroOuNulo(b.dimension?.package_width),
      alturaCm: numeroOuNulo(b.dimension?.package_height),
      condicao: condicaoNormalizada(b.condition),
      marcaId: numeroOuNulo(b.brand?.brand_id),
      marcaNome: typeof b.brand?.original_brand_name === 'string' ? b.brand.original_brand_name : null,
      categoriaId: b.category_id != null ? String(b.category_id) : null,
      skuCanal: typeof b.item_sku === 'string' ? b.item_sku : null,
    }
  }

  if (plataforma === 'mercadolivre') {
    // No ML peso e medidas são ATRIBUTOS (`SELLER_PACKAGE_*`), com a unidade
    // grudada no valor: "12 cm", "350 g". Vêm em texto, e é assim que voltam.
    const atributos = atributosDoMercadoLivre(b)
    const valor = (id: string) => atributos.find(a => a.id === id)?.valor ?? null
    const gramas = numeroDeTextoComUnidade(valor('SELLER_PACKAGE_WEIGHT'))
    return {
      pesoKg: gramas != null ? gramas / 1000 : null,
      comprimentoCm: numeroDeTextoComUnidade(valor('SELLER_PACKAGE_LENGTH')),
      larguraCm: numeroDeTextoComUnidade(valor('SELLER_PACKAGE_WIDTH')),
      alturaCm: numeroDeTextoComUnidade(valor('SELLER_PACKAGE_HEIGHT')),
      condicao: condicaoNormalizada(b.condition),
      marcaId: null,
      marcaNome: atributos.find(a => a.id === 'BRAND')?.valor ?? null,
      categoriaId: typeof b.category_id === 'string' ? b.category_id : null,
      skuCanal: typeof b.seller_custom_field === 'string' ? b.seller_custom_field : null,
    }
  }

  return {
    pesoKg: null, comprimentoCm: null, larguraCm: null, alturaCm: null,
    condicao: condicaoNormalizada(b.condition), marcaId: null,
    marcaNome: typeof b.brand === 'string' ? b.brand : null,
    categoriaId: null, skuCanal: null,
  }
}

function numeroOuNulo(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "12 cm" → 12 · "350 g" → 350 · null → null. */
function numeroDeTextoComUnidade(v: string | null): number | null {
  if (!v) return null
  const n = Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function condicaoNormalizada(v: unknown): 'NEW' | 'USED' | null {
  if (typeof v !== 'string') return null
  const up = v.toUpperCase()
  return up === 'NEW' || up === 'USED' ? up : null
}

// ── Limites de cada plataforma ──────────────────────────────────────────────

/**
 * O que cada marketplace aceita. Está aqui, e não espalhado pela tela, porque
 * o operador precisa ver o limite ANTES de escrever 140 caracteres de título
 * para a Shopee cortar em 120 — e porque a mesma tela serve as três lojas.
 *
 * Números conferidos contra a documentação de cada API e contra os anúncios
 * já sincronizados (nenhum passa desses tetos).
 */
export const LIMITES: Record<string, { titulo: number; descricao: number; imagens: number }> = {
  shopee: { titulo: 120, descricao: 3000, imagens: 9 },
  mercadolivre: { titulo: 60, descricao: 50000, imagens: 10 },
  nuvemshop: { titulo: 255, descricao: 50000, imagens: 10 },
}

export function limitesDe(plataforma: string) {
  return LIMITES[plataforma] ?? { titulo: 200, descricao: 5000, imagens: 10 }
}

/** Plataformas que sabem receber edição de conteúdo. Nuvemshop ainda não tem
 *  módulo de escrita de conteúdo — melhor ausente do que presente e falhando,
 *  a mesma regra que `canalAceitaEnvio` já aplica na fila. */
export function plataformaAceitaEdicao(plataforma: string): boolean {
  return plataforma === 'shopee' || plataforma === 'mercadolivre'
}
