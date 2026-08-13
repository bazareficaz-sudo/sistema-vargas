import { nuvemshopPost } from './client'
import { paginar } from './catalog'
import { syncSingleItem } from './sync'
import { NuvemshopApiError, textoLocalizado, type NuvemshopChannel } from './types'

// Criação de anúncio novo na Nuvemshop — a fatia que faltava para a
// integração deixar de ser só leitura + atualização de preço/estoque.
//
// A diferença de fundo para Shopee e Mercado Livre: lá o anúncio nasce dentro
// de uma taxonomia da PLATAFORMA (categoria e atributos com ids universais,
// iguais em qualquer conta). Aqui não existe taxonomia comum: as categorias
// são da LOJA, criadas pelo próprio lojista. Por isso não há categoria
// obrigatória, não há atributo obrigatório, e não há o que "adivinhar" —
// o formulário é curto de propósito.
//
// Também não há upload de imagem: a Nuvemshop baixa a foto da URL que a gente
// manda (`images[].src`). As imagens do cadastro já são URLs públicas do
// Storage, então basta enviá-las.

export type CategoriaNuvemshop = {
  id: number
  nome: string
  parentId: number | null
  /** Caminho completo ("Ferramentas > Manuais"), para o select da tela. */
  caminho: string
}

/**
 * Categorias da loja.
 *
 * São da loja, não da plataforma: dois canais Nuvemshop diferentes têm ids
 * diferentes para a mesma "Ferramentas". É por isso que replicar um anúncio
 * entre lojas casa a categoria pelo NOME, não pelo id.
 */
export async function listarCategorias(canal: NuvemshopChannel): Promise<CategoriaNuvemshop[]> {
  const cruas: any[] = []
  for await (const pagina of paginar(canal, '/categories')) cruas.push(...pagina)

  const nomePorId = new Map<number, { nome: string; parentId: number | null }>()
  for (const c of cruas) {
    const id = Number(c?.id)
    if (!id) continue
    const parent = Number(c?.parent ?? 0)
    nomePorId.set(id, {
      nome: textoLocalizado(c?.name) ?? `Categoria ${id}`,
      parentId: parent > 0 ? parent : null,
    })
  }

  const caminhoDe = (id: number): string => {
    const partes: string[] = []
    let atual: number | null = id
    // Teto de profundidade: categoria com pai apontando para si mesma (ou um
    // ciclo) travaria a montagem do caminho, e o dado vem de fora.
    for (let i = 0; atual != null && i < 10; i++) {
      const no = nomePorId.get(atual)
      if (!no) break
      partes.unshift(no.nome)
      atual = no.parentId
    }
    return partes.join(' > ')
  }

  return Array.from(nomePorId.entries())
    .map(([id, no]) => ({ id, nome: no.nome, parentId: no.parentId, caminho: caminhoDe(id) }))
    .sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'))
}

export type CriarAnuncioNuvemshopInput = {
  produtoId: string
  empresaId: string
  titulo: string
  descricao: string
  preco: number
  /** Preço "de", riscado na vitrine. Só entra quando é maior que o preço. */
  precoDe?: number | null
  estoque: number
  sku?: string | null
  ean?: string | null
  marca?: string | null
  categoriaIds?: number[]
  pesoKg?: number | null
  comprimentoCm?: number | null
  larguraCm?: number | null
  alturaCm?: number | null
  /** false publica o produto fora da vitrine (equivalente ao "pausado"). */
  publicado: boolean
  fotoUrls: string[]
}

export type ResultadoCriarAnuncioNuvemshop =
  | { ok: true; anuncioId: string; itemId: string; warning?: string }
  | { ok: false; erro: string }

/**
 * Monta o corpo do POST /products.
 *
 * Preço, estoque, SKU, código de barras, peso e medidas vão na VARIANTE, não
 * no produto — mesma estrutura que `write.ts` já enfrenta na atualização. Um
 * produto sem opções de escolha é, na API, um produto com uma variante só.
 */
function montarCorpo(input: CriarAnuncioNuvemshopInput, comCategorias: boolean): Record<string, unknown> {
  const variante: Record<string, unknown> = {
    // String, não número: `price: 100` volta como "1.0E+2" em algumas
    // respostas — o mesmo cuidado que já existe em write.ts.
    price: input.preco.toFixed(2),
    stock: Math.max(0, Math.trunc(input.estoque)),
    // Explícito de propósito: com `stock_management` desligado a Nuvemshop
    // trata o estoque como infinito e ignora o número enviado — a loja
    // continuaria vendendo o que acabou, sem erro nenhum aparecer.
    stock_management: true,
  }
  // Preço "de" só faz sentido acima do preço de venda; abaixo, a vitrine
  // mostraria um desconto negativo.
  if (input.precoDe != null && input.precoDe > input.preco) {
    variante.promotional_price = input.preco.toFixed(2)
    variante.price = input.precoDe.toFixed(2)
  }
  if (input.sku) variante.sku = String(input.sku)
  if (input.ean) variante.barcode = String(input.ean)
  if (input.pesoKg) variante.weight = String(input.pesoKg)
  // depth = comprimento. A Nuvemshop usa profundidade/largura/altura em cm.
  if (input.comprimentoCm) variante.depth = String(input.comprimentoCm)
  if (input.larguraCm) variante.width = String(input.larguraCm)
  if (input.alturaCm) variante.height = String(input.alturaCm)

  const corpo: Record<string, unknown> = {
    // Texto por idioma. A loja é pt-BR; `textoLocalizado` na leitura já lida
    // com lojas em outro idioma.
    name: { pt: input.titulo },
    published: input.publicado,
    variants: [variante],
  }
  if (input.descricao.trim()) corpo.description = { pt: input.descricao }
  if (input.marca) corpo.brand = input.marca
  if (input.fotoUrls.length > 0) corpo.images = input.fotoUrls.map(src => ({ src }))
  if (comCategorias && input.categoriaIds?.length) corpo.categories = input.categoriaIds

  return corpo
}

export async function criarAnuncio(
  sb: any,
  canal: NuvemshopChannel,
  input: CriarAnuncioNuvemshopInput,
): Promise<ResultadoCriarAnuncioNuvemshop> {
  if (!input.titulo.trim()) return { ok: false, erro: 'Título obrigatório.' }
  if (!(input.preco > 0)) return { ok: false, erro: `Preço inválido (${input.preco}). A Nuvemshop recusa preço zerado ou negativo.` }

  let avisoCategoria: string | null = null

  try {
    let criado: any
    try {
      criado = await nuvemshopPost(canal, '/products', montarCorpo(input, true))
    } catch (e: unknown) {
      // O formato (lista de ids) está confirmado contra a loja real. O que
      // sobra de risco é o id em si: categoria apagada na loja depois que a
      // tela carregou a lista, ou casada por nome numa replicação. Nesses
      // casos, publicar sem categoria e avisar é melhor que perder o anúncio
      // inteiro — o operador arruma a categoria na Nuvemshop em dois cliques.
      const msg = e instanceof Error ? e.message : ''
      const foiCategoria = /categor/i.test(msg) && !!input.categoriaIds?.length
      if (!foiCategoria) throw e
      criado = await nuvemshopPost(canal, '/products', montarCorpo(input, false))
      avisoCategoria = `A Nuvemshop recusou a categoria (${msg}). O produto foi criado sem categoria — escolha uma direto no painel da loja.`
    }

    const idExterno = criado?.id
    if (!idExterno) throw new NuvemshopApiError('A Nuvemshop não devolveu o id do produto criado.', undefined, criado)

    // Reaproveita o sync para trazer o produto de volta já mapeado para
    // marketplace_anuncios (mesmo caminho da Shopee): evita duplicar o
    // mapeamento raw→linha que sync.ts já faz, e o anúncio nasce com os dados
    // reais da loja, não com o que a gente achou que mandou.
    const sincronizado = await syncSingleItem(sb, canal, String(idExterno))
    if (!sincronizado.ok) {
      return {
        ok: true, anuncioId: '', itemId: String(idExterno),
        warning: `Produto criado na Nuvemshop (id ${idExterno}), mas falhou ao sincronizar de volta: ${sincronizado.error}. Use "Sincronizar" na tela de Anúncios.`,
      }
    }

    // Vincular o produto na volta só é correto aqui porque a criação é nossa
    // — num sync comum, produto_id pode ser um vínculo manual do operador e
    // não pode ser sobrescrito.
    await sb.from('marketplace_anuncios').update({ produto_id: input.produtoId }).eq('id', sincronizado.anuncioId)

    // Peso e medidas digitados na tela valem para o cadastro também: é o
    // mesmo pacote em qualquer canal, e sem isso o operador redigita a cada
    // anúncio novo.
    if (input.pesoKg || input.comprimentoCm) {
      await sb.from('produtos').update({
        peso_kg: input.pesoKg || null,
        comprimento_cm: input.comprimentoCm || null,
        largura_cm: input.larguraCm || null,
        altura_cm: input.alturaCm || null,
      }).eq('id', input.produtoId)
    }

    return { ok: true, anuncioId: sincronizado.anuncioId, itemId: String(idExterno), warning: avisoCategoria ?? undefined }
  } catch (e: unknown) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Erro ao criar anúncio na Nuvemshop' }
  }
}
