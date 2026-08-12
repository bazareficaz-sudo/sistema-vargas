import { nuvemshopGet, nuvemshopPut } from './client'
import type { NuvemshopChannel } from './types'

// Escrita na Nuvemshop: preço e estoque de volta para a loja.
//
// Até aqui a integração era só leitura — importava catálogo e pedidos e não
// devolvia nada. Com 95% dos 235 anúncios já mapeados, a fila passa a ter o
// que enviar.
//
// A diferença estrutural para Shopee e Mercado Livre: na Nuvemshop preço e
// estoque NÃO ficam no produto, ficam na variante. Todo produto tem pelo
// menos uma variante, mesmo os "simples" — o que a loja mostra como produto
// sem variação é, na API, um produto com uma variante só. Por isso toda
// escrita precisa do id da variante, não do produto.

export type ResultadoEscrita =
  | { ok: true; variantesAtualizadas: number }
  | { ok: false; erro: string }

type Variante = { id: number | string; price?: string | number; stock?: number | null }

/**
 * Ids das variantes do produto. Usa as que o sync já guardou quando existem;
 * senão vai buscar na Nuvemshop.
 *
 * Produto sem variação não gera linha em marketplace_anuncio_variacoes no
 * nosso lado, então nesses casos a consulta é obrigatória — é onde está a
 * variante única que carrega preço e estoque.
 */
async function idsDasVariantes(
  canal: NuvemshopChannel,
  produtoExternoId: string,
  conhecidos: string[],
): Promise<string[]> {
  if (conhecidos.length > 0) return conhecidos

  const produto = await nuvemshopGet(canal, `/products/${produtoExternoId}`)
  const variantes: Variante[] = Array.isArray(produto?.variants) ? produto.variants : []
  return variantes.map(v => String(v.id))
}

/**
 * Atualiza preço e/ou estoque de um anúncio.
 *
 * `variantesConhecidas` vem de marketplace_anuncio_variacoes.model_id. Passar
 * vazio é válido: aí as variantes são buscadas na hora.
 *
 * Quando o anúncio tem várias variantes e não se diz qual, o mesmo valor vai
 * para todas. É o comportamento certo para o caso que a fila cobre — o
 * produto do sistema é um só, com um preço e um estoque —, mas seria errado
 * num anúncio de tamanhos com preços diferentes. Por isso o retorno diz
 * quantas variantes foram tocadas, em vez de só "deu certo".
 */
export async function atualizarPrecoEstoque(
  canal: NuvemshopChannel,
  args: {
    produtoExternoId: string
    variantesConhecidas?: string[]
    preco?: number | null
    estoque?: number | null
  },
): Promise<ResultadoEscrita> {
  const { produtoExternoId, preco, estoque } = args

  if (preco == null && estoque == null) {
    return { ok: false, erro: 'Nada a enviar: informe preço, estoque ou os dois.' }
  }
  if (preco != null && !(preco > 0)) {
    return { ok: false, erro: `Preço inválido (${preco}). A Nuvemshop recusa preço zerado ou negativo.` }
  }

  try {
    const variantes = await idsDasVariantes(canal, produtoExternoId, args.variantesConhecidas ?? [])
    if (variantes.length === 0) {
      return { ok: false, erro: 'Produto sem variantes na Nuvemshop — não há onde gravar preço e estoque.' }
    }

    const corpo: Record<string, unknown> = {}
    // A API espera preço como string; number vira "1.0E+2" em alguns casos.
    if (preco != null) corpo.price = preco.toFixed(2)
    if (estoque != null) corpo.stock = Math.max(0, Math.trunc(estoque))

    let atualizadas = 0
    for (const idVariante of variantes) {
      await nuvemshopPut(canal, `/products/${produtoExternoId}/variants/${idVariante}`, corpo)
      atualizadas++
    }

    return { ok: true, variantesAtualizadas: atualizadas }
  } catch (e: unknown) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao enviar para a Nuvemshop' }
  }
}

/**
 * Publica ou despublica o produto na loja.
 *
 * A Nuvemshop não tem "pausado" como a Shopee: o equivalente é sair da
 * vitrine (`published: false`). O produto continua existindo e volta com o
 * mesmo id — não é exclusão.
 */
export async function publicarProduto(
  canal: NuvemshopChannel,
  produtoExternoId: string,
  publicado: boolean,
): Promise<ResultadoEscrita> {
  try {
    await nuvemshopPut(canal, `/products/${produtoExternoId}`, { published: publicado })
    return { ok: true, variantesAtualizadas: 0 }
  } catch (e: unknown) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao publicar/despublicar na Nuvemshop' }
  }
}
