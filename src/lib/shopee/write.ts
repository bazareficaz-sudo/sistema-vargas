import { shopeePost, getIntegracaoCredentials } from './client'
import { sleep, THROTTLE_MS } from './catalog'
import { ShopeeApiError, type ShopeeChannel } from './types'

// Limitações conhecidas (documentação oficial inacessível durante a
// implementação, ver plano da Fase 6): shape dos endpoints confirmado só por
// fontes secundárias (confiança média); comportamento de sucesso parcial em
// lote (uma variação falhar dentro do mesmo item) não documentado em lugar
// nenhum — tratamos cada chamada (preço/estoque) isoladamente do nosso lado,
// mas dentro de uma chamada só a Shopee decide se é tudo-ou-nada.

type CallCtx = { sb: any; canal: ShopeeChannel }

async function callOpts(ctx: CallCtx) {
  const { partnerId, partnerKey } = await getIntegracaoCredentials(ctx.sb)
  return { partnerId, partnerKey, accessToken: ctx.canal.accessToken, shopId: ctx.canal.sellerId }
}

export type AlvoPush = { modelId?: string; preco?: number; estoque?: number }

export type ResultadoPush = {
  precoOk: boolean
  estoqueOk: boolean
  erroPreco?: string
  erroEstoque?: string
}

/**
 * As recusas que vêm DENTRO de uma resposta aceita.
 *
 * MEDIDO EM 04/09/2026, a partir de um anúncio que não subia: a Shopee pode
 * responder `error: ""` no envelope — e `parseShopeeResponse` só lança quando
 * esse campo vem preenchido — e recusar o item ou o modelo numa
 * `failure_list` dentro de `response`. O corpo era descartado aqui, então a
 * recusa virava sucesso.
 *
 * O ESTRAGO NÃO ERA O ENVIO PERDIDO, era o que vinha depois: a fila grava
 * `estoque_externo` com o número "enviado" e tira o produto da fila. Toda
 * rodada seguinte comparava o espelho com ele mesmo, concluía "já igual" e
 * pulava. Um anúncio travado para sempre, sem um erro em lugar nenhum.
 *
 * É a mesma leitura que `discountWrite.ts` faz do `fail_list` das campanhas,
 * pelo mesmo motivo — lá foi escrita antes de este defeito aparecer aqui.
 */
export function falhasNaResposta(body: unknown): string | null {
  const resposta = (body as { response?: Record<string, unknown> } | null)?.response
  if (!resposta) return null
  // Os dois nomes: a Shopee usa `failure_list` no catálogo e `fail_list` no
  // desconto. Aceitar os dois custa uma linha e evita depender de qual
  // endpoint mudou de vocabulário.
  const bruto = resposta.failure_list ?? resposta.fail_list
  const lista = Array.isArray(bruto) ? bruto : []
  if (lista.length === 0) return null

  return lista.map((f: Record<string, unknown>) => {
    const alvo = f.model_id ? `modelo ${f.model_id}` : f.item_id ? `item ${f.item_id}` : 'item'
    const razao = f.failed_reason ?? f.fail_message ?? f.failed_message ?? f.message ?? f.fail_error ?? 'sem motivo informado'
    return `${alvo}: ${razao}`
  }).join(' · ')
}

// Envia preço e/ou estoque de um item (e, opcionalmente, várias variações
// do mesmo item numa única chamada por endpoint) para a Shopee. Preço e
// estoque são chamadas separadas — uma falhar não impede a outra de ser
// tentada. Erros da Shopee (ex: "item em promoção") propagam a mensagem
// original, sem reformular, já que é informação acionável para o usuário.
export async function pushPrecoEstoque(ctx: CallCtx, itemId: number, alvos: AlvoPush[]): Promise<ResultadoPush> {
  const callOptions = await callOpts(ctx)
  const resultado: ResultadoPush = { precoOk: true, estoqueOk: true }

  const precoList = alvos
    .filter(a => a.preco != null)
    .map(a => ({ ...(a.modelId ? { model_id: Number(a.modelId) } : {}), original_price: a.preco }))

  if (precoList.length > 0) {
    try {
      const body = await shopeePost('/api/v2/product/update_price', { item_id: itemId, price_list: precoList }, callOptions)
      const falhas = falhasNaResposta(body)
      if (falhas) {
        resultado.precoOk = false
        resultado.erroPreco = `A Shopee recusou o preço — ${falhas}`
      }
    } catch (e: any) {
      resultado.precoOk = false
      resultado.erroPreco = e instanceof ShopeeApiError ? e.message : (e?.message ?? 'Erro ao atualizar preço')
    }
  }

  const estoqueList = alvos
    .filter(a => a.estoque != null)
    .map(a => ({ ...(a.modelId ? { model_id: Number(a.modelId) } : {}), seller_stock: [{ stock: a.estoque }] }))

  if (estoqueList.length > 0) {
    try {
      const body = await shopeePost('/api/v2/product/update_stock', { item_id: itemId, stock_list: estoqueList }, callOptions)
      const falhas = falhasNaResposta(body)
      if (falhas) {
        resultado.estoqueOk = false
        resultado.erroEstoque = `A Shopee recusou o estoque — ${falhas}`
      }
    } catch (e: any) {
      resultado.estoqueOk = false
      resultado.erroEstoque = e instanceof ShopeeApiError ? e.message : (e?.message ?? 'Erro ao atualizar estoque')
    }
  }

  return resultado
}

export type ResultadoUnlist = { itemId: number; ok: boolean; erro?: string }

const UNLIST_BATCH_SIZE = 50

// Liga/desliga o anúncio inteiro na Shopee (pausar = unlist:true, ativar =
// unlist:false) — diferente de preço/estoque, é por item, não por variação.
// Mesmo nível de confiança do resto deste arquivo (shape confirmado por
// fonte secundária, não pela doc oficial).
export async function unlistItems(ctx: CallCtx, itemIds: number[], unlist: boolean): Promise<ResultadoUnlist[]> {
  const callOptions = await callOpts(ctx)
  const resultados: ResultadoUnlist[] = []

  for (let i = 0; i < itemIds.length; i += UNLIST_BATCH_SIZE) {
    const lote = itemIds.slice(i, i + UNLIST_BATCH_SIZE)
    try {
      const data = await shopeePost('/api/v2/product/unlist_item', {
        item_list: lote.map(item_id => ({ item_id, unlist })),
      }, callOptions)
      const falhas = new Map<number, string>(
        (data?.response?.failure_list ?? []).map((f: any) => [Number(f.item_id), f.failed_reason ?? 'Falha ao atualizar status'])
      )
      for (const itemId of lote) {
        const erro = falhas.get(itemId)
        resultados.push(erro ? { itemId, ok: false, erro } : { itemId, ok: true })
      }
    } catch (e: any) {
      const erro = e instanceof ShopeeApiError ? e.message : (e?.message ?? 'Erro ao atualizar status')
      for (const itemId of lote) resultados.push({ itemId, ok: false, erro })
    }
    if (i + UNLIST_BATCH_SIZE < itemIds.length) await sleep(THROTTLE_MS)
  }

  return resultados
}
