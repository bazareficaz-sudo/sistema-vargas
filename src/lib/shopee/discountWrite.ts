import { shopeePost, getIntegracaoCredentials } from './client'
import type { ShopeeChannel } from './types'

// CAMPANHAS DE DESCONTO — ESCRITA.
//
// Separado de `discount.ts` de propósito. Aquele arquivo é leitura e pode ser
// chamado de qualquer lugar sem consequência; este mexe em PREÇO NO AR. A
// separação em arquivos faz a diferença aparecer no import de quem chama.
//
// O CONTRATO, e o que se sabe de cada parte:
//
//   MEDIDO (sonda de 03/09/2026, contra a conta real): os três caminhos
//   existem. Chamados sem parâmetro, os três responderam
//   `common.error_param — "discount_id: This field is required"`, que é a
//   Shopee reconhecendo o endpoint e cobrando o campo. Se o nome estivesse
//   errado viria "path not found".
//
//   MEDIDO (sincronização da campanha "Bota Fora"): item COM variação tem um
//   `item_id` e vários `model_id`, cada modelo com preço próprio. A leitura
//   devolve `model_list`; a escrita monta a mesma estrutura.
//
//   INFORMADO PELO GESTOR, não medido: a Shopee aceita acrescentar item em
//   campanha JÁ EM ANDAMENTO (ele observou um concorrente fazendo). É
//   plausível e destrava o trabalho, mas o primeiro POST real é que prova. Por
//   isso `adicionarItens` devolve o erro cru da Shopee em vez de traduzir: se
//   a recusa vier por causa do status da campanha, quem chamou precisa
//   enxergar a mensagem dela, não uma frase nossa por cima.

type CallCtx = { sb: unknown; canal: ShopeeChannel }

async function callOpts(ctx: CallCtx) {
  const { partnerId, partnerKey } = await getIntegracaoCredentials(ctx.sb)
  return { partnerId, partnerKey, accessToken: ctx.canal.accessToken, shopId: ctx.canal.sellerId }
}

/** Um item a entrar na campanha. Sem variação, `modelos` vem vazio. */
export type ItemParaCampanha = {
  itemId: number
  /** Preço promocional do item inteiro. Ignorado quando há `modelos`. */
  precoPromocional?: number
  /** Zero é "sem limite" na convenção da Shopee, não "nenhum permitido". */
  limitePorCompra?: number
  /** Estoque reservado para a promoção. Zero = usa o estoque do anúncio. */
  estoquePromocao?: number
  /** Uma entrada por variação. O preço mora AQUI quando o anúncio tem variação. */
  modelos?: { modelId: number; precoPromocional: number; estoquePromocao?: number }[]
}

export type ResultadoEscritaDesconto = {
  ok: boolean
  /** Código cru da Shopee. Vazio quando deu certo. */
  erro: string
  mensagem: string
  /** Itens que a Shopee recusou individualmente, com o motivo dela. */
  recusados: { itemId: number; erro: string; mensagem: string }[]
  /** A resposta inteira, para o chamador registrar. */
  bruto: unknown
}

/** Monta o `item_list` no formato que a API espera. */
function corpoDosItens(itens: ItemParaCampanha[]) {
  return itens.map(i => {
    const base: Record<string, unknown> = { item_id: i.itemId }
    if (i.limitePorCompra != null) base.purchase_limit = i.limitePorCompra
    if (i.modelos?.length) {
      // COM VARIAÇÃO O PREÇO NÃO VAI NO ITEM. Mandar os dois seria ambíguo, e
      // a leitura mostrou que a Shopee guarda por modelo.
      base.model_list = i.modelos.map(m => ({
        model_id: m.modelId,
        model_promotion_price: m.precoPromocional,
        ...(m.estoquePromocao != null ? { model_promotion_stock: m.estoquePromocao } : {}),
      }))
    } else {
      if (i.precoPromocional != null) base.item_promotion_price = i.precoPromocional
      if (i.estoquePromocao != null) base.item_promotion_stock = i.estoquePromocao
    }
    return base
  })
}

/**
 * Lê a resposta sem esconder recusa individual.
 *
 * A Shopee pode aceitar a chamada (`error` vazio) e recusar ITENS dentro dela,
 * numa lista de falhas. Reportar só o `error` do envelope faria a tela dizer
 * "adicionado" para um item que ficou de fora.
 */
function lerResposta(body: Record<string, unknown> | null): ResultadoEscritaDesconto {
  const erro = String(body?.error ?? '')
  const resposta = (body?.response ?? {}) as Record<string, unknown>
  const falhas = Array.isArray(resposta.fail_list) ? resposta.fail_list : []
  return {
    ok: !erro && falhas.length === 0,
    erro,
    mensagem: String(body?.message ?? ''),
    recusados: falhas.map((f: Record<string, unknown>) => ({
      itemId: Number(f.item_id ?? 0),
      erro: String(f.fail_error ?? f.error ?? ''),
      mensagem: String(f.fail_message ?? f.message ?? ''),
    })),
    bruto: body,
  }
}

/** Acrescenta itens a uma campanha existente. */
export async function adicionarItens(
  ctx: CallCtx, discountId: string, itens: ItemParaCampanha[],
): Promise<ResultadoEscritaDesconto> {
  if (itens.length === 0) return { ok: true, erro: '', mensagem: 'nada a enviar', recusados: [], bruto: null }
  const opts = await callOpts(ctx)
  const body = await shopeePost('/api/v2/discount/add_discount_item', {
    discount_id: Number(discountId),
    item_list: corpoDosItens(itens),
  }, opts).catch((e: unknown) => ({ error: 'excecao', message: e instanceof Error ? e.message : String(e) }))
  return lerResposta(body as Record<string, unknown>)
}

/** Altera o preço promocional de itens que já estão na campanha. */
export async function atualizarItens(
  ctx: CallCtx, discountId: string, itens: ItemParaCampanha[],
): Promise<ResultadoEscritaDesconto> {
  if (itens.length === 0) return { ok: true, erro: '', mensagem: 'nada a enviar', recusados: [], bruto: null }
  const opts = await callOpts(ctx)
  const body = await shopeePost('/api/v2/discount/update_discount_item', {
    discount_id: Number(discountId),
    item_list: corpoDosItens(itens),
  }, opts).catch((e: unknown) => ({ error: 'excecao', message: e instanceof Error ? e.message : String(e) }))
  return lerResposta(body as Record<string, unknown>)
}

/**
 * Tira um item da campanha.
 *
 * A API remove UM item por chamada — não há lista. Quem precisa tirar vários
 * chama em sequência, com espaço entre as chamadas; é o mesmo throttle das
 * outras escritas na Shopee, e rajada é o jeito mais rápido de tomar bloqueio.
 */
export async function removerItem(
  ctx: CallCtx, discountId: string, itemId: number, modelId?: number,
): Promise<ResultadoEscritaDesconto> {
  const opts = await callOpts(ctx)
  const body = await shopeePost('/api/v2/discount/delete_discount_item', {
    discount_id: Number(discountId),
    item_id: itemId,
    ...(modelId ? { model_id: modelId } : {}),
  }, opts).catch((e: unknown) => ({ error: 'excecao', message: e instanceof Error ? e.message : String(e) }))
  return lerResposta(body as Record<string, unknown>)
}
