import { shopeeGet, getIntegracaoCredentials } from './client'
import type { ShopeeChannel } from './types'

// Campanhas de desconto da Shopee — LEITURA.
//
// Fatia 1 de propósito não escreve nada. Antes de criar a primeira campanha
// pela API vale saber como as campanhas reais desta loja são: quantas, com
// que janelas, quantos itens, e quais anúncios já estão dentro de alguma.
// Foi a falta desse passo que fez a publicação de anúncio ser descoberta a
// erro por erro ("condition is required", "ValueId is required").
//
// Confiança do contrato: endpoints e nomes de campo conferidos contra o SDK
// congminh1254/shopee-sdk — a mesma fonte usada para `add_item`, já que a
// doc oficial (open.shopee.com) é inacessível daqui. O que NÃO dá para
// conferir sem chamar de verdade é o comportamento: fuso do timestamp,
// tamanho de página aceito e o que ela devolve em loja sem campanha nenhuma.

type CallCtx = { sb: any; canal: ShopeeChannel }

async function callOpts(ctx: CallCtx) {
  const { partnerId, partnerKey } = await getIntegracaoCredentials(ctx.sb)
  return { partnerId, partnerKey, accessToken: ctx.canal.accessToken, shopId: ctx.canal.sellerId }
}

/** `discount_status` aceito pela Shopee. 'all' traz as três. */
export type SituacaoDesconto = 'upcoming' | 'ongoing' | 'expired' | 'all'

// A Shopee fala upcoming/ongoing/expired; o resto do sistema fala português
// e usa esses mesmos nomes na coluna `status`. Traduzir num lugar só evita
// que metade das telas compare com a palavra dela e metade com a nossa.
const SITUACAO: Record<string, string> = {
  upcoming: 'programada',
  ongoing: 'ativa',
  expired: 'encerrada',
}
export function traduzirSituacao(status?: string): string {
  return SITUACAO[String(status ?? '').toLowerCase()] ?? 'rascunho'
}

/** Segundos (o que a Shopee usa) → Date. Zero e nulo viram nulo, não 1970. */
function paraData(segundos: unknown): string | null {
  const n = Number(segundos)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

export type DescontoResumo = {
  discountId: string
  nome: string
  status: string
  inicio: string | null
  fim: string | null
  bruto: any
}

/**
 * Lista as campanhas da loja.
 *
 * Pagina até esgotar em vez de confiar numa página só: uma loja com muitas
 * campanhas expiradas devolveria as primeiras e nada indicaria que faltou
 * o resto — o mesmo modo de falha que o catálogo já teve com o teto de 1000
 * linhas do PostgREST.
 */
export async function listarDescontos(
  ctx: CallCtx, situacao: SituacaoDesconto = 'all', maxPaginas = 20,
): Promise<DescontoResumo[]> {
  const opts = await callOpts(ctx)
  const TAMANHO = 100
  const saida: DescontoResumo[] = []

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const data = await shopeeGet('/api/v2/discount/get_discount_list', {
      discount_status: situacao, page_no: pagina, page_size: TAMANHO,
    }, opts)

    const lista: any[] = data?.response?.discount_list ?? []
    for (const d of lista) {
      saida.push({
        discountId: String(d.discount_id),
        nome: d.discount_name ?? `Campanha ${d.discount_id}`,
        status: traduzirSituacao(d.status),
        inicio: paraData(d.start_time),
        fim: paraData(d.end_time),
        bruto: d,
      })
    }

    // `more` é a resposta dela sobre haver próxima página. Sem ele, cair no
    // tamanho da página é o critério que sobra.
    const temMais = data?.response?.more ?? (lista.length === TAMANHO)
    if (!temMais || lista.length === 0) break
  }

  return saida
}

export type ItemDesconto = {
  itemId: string
  nome: string | null
  modelId: string | null
  precoOriginal: number | null
  precoPromocional: number | null
  limitePorCompra: number | null
  estoquePromocao: number | null
}

export type DescontoDetalhe = DescontoResumo & { itens: ItemDesconto[] }

/**
 * Detalhe de uma campanha, com os itens.
 *
 * `get_discount` é GET e pagina os ITENS (não as campanhas): a resposta traz
 * `item_list` e `more`. Anúncio sem variação cobra por `item_promotion_price`;
 * anúncio com variação traz `model_list`, e o preço mora em cada modelo — por
 * isso um item da campanha vira N linhas aqui, uma por variação.
 */
export async function buscarDesconto(
  ctx: CallCtx, discountId: string, maxPaginas = 50,
): Promise<DescontoDetalhe | null> {
  const opts = await callOpts(ctx)
  const TAMANHO = 100
  const itens: ItemDesconto[] = []
  let cabecalho: DescontoResumo | null = null

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const data = await shopeeGet('/api/v2/discount/get_discount', {
      discount_id: Number(discountId), page_no: pagina, page_size: TAMANHO,
    }, opts)

    const r = data?.response
    if (!r) return null

    if (!cabecalho) {
      cabecalho = {
        discountId: String(r.discount_id ?? discountId),
        nome: r.discount_name ?? `Campanha ${discountId}`,
        status: traduzirSituacao(r.status),
        inicio: paraData(r.start_time),
        fim: paraData(r.end_time),
        bruto: { ...r, item_list: undefined },
      }
    }

    const lista: any[] = r.item_list ?? []
    for (const it of lista) {
      const modelos: any[] = it.model_list ?? []
      if (modelos.length > 0) {
        for (const m of modelos) {
          itens.push({
            itemId: String(it.item_id),
            nome: it.item_name ?? null,
            modelId: String(m.model_id),
            precoOriginal: numeroOuNulo(m.model_original_price),
            precoPromocional: numeroOuNulo(m.model_promotion_price),
            limitePorCompra: numeroOuNulo(it.purchase_limit),
            estoquePromocao: numeroOuNulo(m.model_promotion_stock ?? it.item_promotion_stock),
          })
        }
      } else {
        itens.push({
          itemId: String(it.item_id),
          nome: it.item_name ?? null,
          modelId: null,
          precoOriginal: numeroOuNulo(it.item_original_price),
          precoPromocional: numeroOuNulo(it.item_promotion_price),
          limitePorCompra: numeroOuNulo(it.purchase_limit),
          estoquePromocao: numeroOuNulo(it.item_promotion_stock),
        })
      }
    }

    const temMais = r.more ?? (lista.length === TAMANHO)
    if (!temMais || lista.length === 0) break
  }

  if (!cabecalho) return null
  return { ...cabecalho, itens }
}

// Zero é valor legítimo aqui (`purchase_limit: 0` significa "sem limite" na
// convenção da Shopee), então `|| null` estragaria o dado. Só ausência vira
// nulo.
function numeroOuNulo(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
