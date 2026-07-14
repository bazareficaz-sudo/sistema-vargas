import { shopeePost, getIntegracaoCredentials } from './client'
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
      await shopeePost('/api/v2/product/update_price', { item_id: itemId, price_list: precoList }, callOptions)
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
      await shopeePost('/api/v2/product/update_stock', { item_id: itemId, stock_list: estoqueList }, callOptions)
    } catch (e: any) {
      resultado.estoqueOk = false
      resultado.erroEstoque = e instanceof ShopeeApiError ? e.message : (e?.message ?? 'Erro ao atualizar estoque')
    }
  }

  return resultado
}
