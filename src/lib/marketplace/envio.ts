import { pushPrecoEstoque, unlistItems } from '@/lib/shopee/write'
import { atualizarPrecoEstoque, pausarAnuncio } from '@/lib/mercadolivre/write'
import type { ShopeeChannel } from '@/lib/shopee/types'
import type { MLChannel } from '@/lib/mercadolivre/types'
import { atualizarPrecoEstoque as atualizarPrecoEstoqueNuvemshop, publicarProduto } from '@/lib/nuvemshop/write'
import type { NuvemshopChannel } from '@/lib/nuvemshop/types'

// Envio de preço/estoque para o canal, escolhendo a plataforma.
//
// Fica separado do processador da fila de propósito: a fila decide O QUE
// enviar, este arquivo sabe COMO enviar em cada plataforma. Misturar as duas
// coisas faria cada plataforma nova mexer na lógica de fila.

export type CanalEnvio = {
  id: string
  empresa_id: string
  plataforma: string
  seller_id: string
  access_token: string
  refresh_token: string | null
  token_expira_em: string | null
  atualizar_estoque_canal: boolean | null
  sincronizar_estoque: boolean | null
}

export type AlvoEnvio = { preco?: number | null; estoque?: number | null; pausar?: boolean }
export type ResultadoEnvio = { ok: boolean; erro?: string; pausado?: boolean }

/** Espaço entre chamadas ao mesmo marketplace. Rajada é o jeito mais rápido
 *  de tomar bloqueio por excesso de requisições. */
export const THROTTLE_ENVIO_MS = 300

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function enviarParaAnuncio(
  sb: any, canal: CanalEnvio, idExterno: string, alvo: AlvoEnvio,
): Promise<ResultadoEnvio> {
  const preco = alvo.preco != null ? Number(alvo.preco) : undefined
  const estoque = alvo.estoque != null ? Number(alvo.estoque) : undefined

  if (preco == null && estoque == null && !alvo.pausar) return { ok: true }

  try {
    if (canal.plataforma === 'shopee') {
      const c: ShopeeChannel = {
        id: canal.id, empresaId: canal.empresa_id, sellerId: canal.seller_id,
        accessToken: canal.access_token, refreshToken: canal.refresh_token,
        tokenExpiraEm: canal.token_expira_em,
        sincronizarEstoque: canal.sincronizar_estoque ?? undefined,
      } as ShopeeChannel
      const ctx = { sb, canal: c }
      const itemId = Number(idExterno)

      const r = await pushPrecoEstoque(ctx, itemId, [{ preco, estoque }])
      if (!r.precoOk || !r.estoqueOk) {
        // Preço e estoque são chamadas separadas na Shopee — uma pode falhar
        // sozinha. Junta os dois motivos para não esconder metade do problema.
        const motivos = [r.erroPreco, r.erroEstoque].filter(Boolean)
        return { ok: false, erro: motivos.join(' · ') || 'A Shopee recusou a atualização' }
      }
      if (alvo.pausar) {
        await sleep(THROTTLE_ENVIO_MS)
        await unlistItems(ctx, [itemId], true)
        return { ok: true, pausado: true }
      }
      return { ok: true }
    }

    if (canal.plataforma === 'mercadolivre') {
      const c: MLChannel = {
        id: canal.id, empresaId: canal.empresa_id, sellerId: canal.seller_id,
        accessToken: canal.access_token, refreshToken: canal.refresh_token,
        tokenExpiraEm: canal.token_expira_em,
      } as MLChannel

      const r = await atualizarPrecoEstoque(sb, c, idExterno, { preco, estoque })
      if (!r.ok) return { ok: false, erro: r.erro ?? 'O Mercado Livre recusou a atualização' }
      if (alvo.pausar) {
        await sleep(THROTTLE_ENVIO_MS)
        await pausarAnuncio(sb, c, idExterno)
        return { ok: true, pausado: true }
      }
      return { ok: true }
    }

    if (canal.plataforma === 'nuvemshop') {
      const c = {
        id: canal.id, empresaId: canal.empresa_id,
        storeId: String(canal.seller_id), accessToken: canal.access_token,
      } as NuvemshopChannel

      // Na Nuvemshop preço e estoque ficam na VARIANTE, não no produto —
      // até o produto "simples" tem uma variante lá. Aqui só temos o id
      // externo do produto, então o módulo busca as variantes na hora: uma
      // chamada a mais, contra duas consultas ao banco pra chegar no mesmo
      // lugar. Se isso pesar quando a fila crescer, o caminho é passar o
      // anúncio inteiro pra cá, não remendar aqui.
      const r = await atualizarPrecoEstoqueNuvemshop(c, {
        produtoExternoId: idExterno, preco, estoque,
      })
      if (!r.ok) return { ok: false, erro: r.erro ?? 'A Nuvemshop recusou a atualização' }

      // Sem "pausado" na Nuvemshop: o equivalente é tirar da vitrine.
      if (alvo.pausar) {
        await sleep(THROTTLE_ENVIO_MS)
        await publicarProduto(c, idExterno, false)
        return { ok: true, pausado: true }
      }
      return { ok: true }
    }

    // Plataforma futura sem módulo de escrita: recusar com motivo é melhor
    // que devolver sucesso para um envio que nunca aconteceu — a fila
    // marcaria o produto como resolvido.
    return { ok: false, erro: `Envio para "${canal.plataforma}" ainda não implementado` }
  } catch (e: unknown) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Erro ao enviar para o canal' }
  }
}

/**
 * O canal aceita receber atualização da fila?
 *
 * Reaproveita os interruptores que já existem em Configurar → canal, em vez
 * de inventar um terceiro: é por eles que se liga a fila em um canal só,
 * como planejado, sem precisar de tela nova.
 */
export function canalAceitaEnvio(canal: CanalEnvio): boolean {
  return !!canal.sincronizar_estoque && !!canal.atualizar_estoque_canal
}
