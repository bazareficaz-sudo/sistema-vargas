import { tiktokPost, getIntegracaoCredentials, refreshAccessTokenIfNeeded } from './client'
import { getDetalheProduto } from './catalog'
import type { TiktokChannel, TiktokProduct, TiktokSku } from './types'

// Escrita na TikTok Shop: preço, estoque, pausar e reativar.
//
// Na TikTok TODO produto tem SKU — até o "simples" tem um. Preço e estoque
// moram no SKU, e o estoque ainda é por armazém. Por isso o envio sempre lê o
// produto na hora (Get Product): é de lá que saem os ids de SKU e de armazém
// atuais, e a doc exige que todo armazém do SKU vá junto na atualização.

// Teto da doc para `quantity` em Update Inventory.
const LIMITE_ESTOQUE = 99_999

export type AlvoSku = {
  /** Id do SKU na TikTok. Ausente = o único SKU do produto. */
  skuId?: string | null
  preco?: number | null
  estoque?: number | null
}

export type ResultadoPrecoEstoque = {
  ok: boolean
  precoOk: boolean
  estoqueOk: boolean
  erroPreco?: string
  erroEstoque?: string
  erro?: string
}

export type ResultadoStatus = { ok: boolean; falhas: { productId: string; erro: string }[] }

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro ao chamar a TikTok Shop'
}

// Update Inventory e Activate/Deactivate respondem `code: 0` mesmo quando
// parte dos itens foi recusada — o que falhou vem em `data.errors`. Tratar só
// o `code` repetiria o defeito da Shopee: gravar como enviado o que o canal
// recusou.
function errosDaResposta(resp: any): { id: string; erro: string }[] {
  const erros: any[] = resp?.data?.errors ?? []
  return erros.map(e => ({
    id: String(e?.detail?.sku_id ?? e?.detail?.product_id ?? '?'),
    erro: String(e?.detail?.extra_errors?.[0]?.message ?? e?.message ?? 'recusado pela TikTok Shop'),
  }))
}

function resolverSkus(
  produto: TiktokProduct, alvos: AlvoSku[],
): { pares: { sku: TiktokSku; alvo: AlvoSku }[]; erro?: string } {
  const skus = produto.skus ?? []
  const pares: { sku: TiktokSku; alvo: AlvoSku }[] = []
  for (const alvo of alvos) {
    if (alvo.skuId) {
      const sku = skus.find(s => String(s.id) === String(alvo.skuId))
      if (!sku) return { pares, erro: `SKU ${alvo.skuId} não existe mais no produto — sincronize o anúncio` }
      pares.push({ sku, alvo })
      continue
    }
    // Um número só para um produto com várias variações não diz qual delas
    // recebe — mesma recusa que o Mercado Livre faz com item com variação.
    if (skus.length !== 1) {
      return { pares, erro: `Produto com ${skus.length} SKUs na TikTok: o envio precisa ser por variação` }
    }
    pares.push({ sku: skus[0], alvo })
  }
  return { pares }
}

export async function atualizarPrecoEstoque(
  sb: any, canalInicial: TiktokChannel, productId: string, alvos: AlvoSku[],
): Promise<ResultadoPrecoEstoque> {
  const comValor = alvos.filter(a => a.preco != null || a.estoque != null)
  if (comValor.length === 0) return { ok: true, precoOk: true, estoqueOk: true }

  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const produto = await getDetalheProduto(canal, productId)
  if (!produto) {
    return { ok: false, precoOk: false, estoqueOk: false, erro: 'Produto não encontrado na TikTok Shop' }
  }

  const { pares, erro } = resolverSkus(produto, comValor)
  if (erro) return { ok: false, precoOk: false, estoqueOk: false, erro }

  const { appKey, appSecret } = await getIntegracaoCredentials()
  const opts = { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher }

  // ESTOQUE PRIMEIRO. Preço é recusado em produto com promoção no ar ou fora
  // de ACTIVATE; estoque não. Um não pode impedir o outro de ser tentado —
  // quem está em promoção vende, e vender sem baixar estoque é sobrevenda.
  let estoqueOk = true
  let erroEstoque: string | undefined
  const estoques = pares.filter(p => p.alvo.estoque != null)
  if (estoques.length > 0) {
    const multiArmazem = estoques.find(p => (p.sku.inventory ?? []).length > 1)
    if (multiArmazem) {
      // A doc exige TODOS os armazéns do SKU, cada um com sua quantidade — e
      // o sistema tem um número só. Dividir por conta própria seria inventar
      // a distribuição do vendedor.
      estoqueOk = false
      erroEstoque = `SKU ${multiArmazem.sku.seller_sku || multiArmazem.sku.id} está em mais de um armazém na TikTok — envio por armazém ainda não é suportado`
    } else {
      try {
        const resp = await tiktokPost(`/product/202309/products/${productId}/inventory/update`, {
          skus: estoques.map(({ sku, alvo }) => {
            const armazem = sku.inventory?.[0]?.warehouse_id
            const quantidade = Math.min(LIMITE_ESTOQUE, Math.max(0, Math.round(Number(alvo.estoque))))
            return {
              id: String(sku.id),
              inventory: [{ ...(armazem ? { warehouse_id: String(armazem) } : {}), quantity: quantidade }],
            }
          }),
        }, opts)
        const recusas = errosDaResposta(resp)
        if (recusas.length > 0) {
          estoqueOk = false
          erroEstoque = recusas.map(r => `SKU ${r.id}: ${r.erro}`).join(' · ')
        }
      } catch (e) {
        estoqueOk = false
        erroEstoque = mensagem(e)
      }
    }
  }

  let precoOk = true
  let erroPreco: string | undefined
  // Preço zero não é "sem preço", é preço inválido — a TikTok recusa.
  const precos = pares.filter(p => p.alvo.preco != null && Number(p.alvo.preco) > 0)
  if (precos.length > 0) {
    try {
      await tiktokPost(`/product/202309/products/${productId}/prices/update`, {
        skus: precos.map(({ sku, alvo }) => ({
          id: String(sku.id),
          price: { amount: Number(alvo.preco).toFixed(2), currency: sku.price?.currency ?? 'BRL' },
        })),
      }, opts)
    } catch (e) {
      precoOk = false
      erroPreco = mensagem(e)
    }
  }

  return { ok: precoOk && estoqueOk, precoOk, estoqueOk, erroPreco, erroEstoque }
}

async function alterarStatus(
  sb: any, canalInicial: TiktokChannel, productIds: string[], acao: 'activate' | 'deactivate',
): Promise<ResultadoStatus> {
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const { appKey, appSecret } = await getIntegracaoCredentials()
  const opts = { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher }

  const falhas: { productId: string; erro: string }[] = []
  // A doc limita a 20 ids por chamada.
  for (let i = 0; i < productIds.length; i += 20) {
    const lote = productIds.slice(i, i + 20)
    try {
      const resp = await tiktokPost(`/product/202309/products/${acao}`, { product_ids: lote }, opts)
      for (const r of errosDaResposta(resp)) falhas.push({ productId: r.id, erro: r.erro })
    } catch (e) {
      for (const id of lote) falhas.push({ productId: id, erro: mensagem(e) })
    }
  }
  return { ok: falhas.length === 0, falhas }
}

export function pausarProdutos(sb: any, canal: TiktokChannel, productIds: string[]) {
  return alterarStatus(sb, canal, productIds, 'deactivate')
}

export function reativarProdutos(sb: any, canal: TiktokChannel, productIds: string[]) {
  return alterarStatus(sb, canal, productIds, 'activate')
}
