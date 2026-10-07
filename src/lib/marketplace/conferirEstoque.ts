// CONFERIR O ENVIO NA PLATAFORMA, logo depois de mandar.
//
// `precisaEnviar` reenvia quando a última leitura da plataforma
// (`estoque_reservado`) contradiz o espelho. Só que essa leitura só muda
// quando a sincronização de catálogo passa pelo anúncio — uma vez por dia na
// TikTok. MEDIDO EM 06/10/2026 (NEOSIN 3,5KG): o mesmo 4 foi reenviado a cada
// 20 min para a TikTok (9 vezes numa manhã) e para dois anúncios do ML
// (30 vezes desde 04/10), sempre "enviado", sempre de novo.
//
// A conferência fecha esse ciclo: depois de um REENVIO, lê o número na
// plataforma e grava como a nova medida. Bateu → para de reenviar. Não bateu
// → a plataforma aceitou e não aplicou, e isso vira erro visível em vez de um
// "enviado" eterno.

import { mlGet, refreshAccessTokenIfNeeded as refreshML } from '@/lib/mercadolivre/client'
import type { MLChannel } from '@/lib/mercadolivre/types'
import { getDetalheProduto } from '@/lib/tiktok/catalog'
import { refreshAccessTokenIfNeeded as refreshTiktok } from '@/lib/tiktok/client'
import { COLUNAS_CANAL as COLUNAS_CANAL_TIKTOK, montarCanal as montarCanalTiktok } from '@/lib/tiktok/canal'
import { estoqueDoProduto } from '@/lib/tiktok/sync'
import type { CanalEnvio } from './envio'

/** Plataformas em que dá para ler o estoque de um anúncio simples na hora. */
export const PLATAFORMAS_CONFERIVEIS = new Set(['mercadolivre', 'tiktok'])

/**
 * Estoque do anúncio (simples) como a plataforma devolve agora.
 * `null` = plataforma sem leitura implementada ou leitura sem número.
 */
export async function lerEstoqueNoCanal(sb: any, canal: CanalEnvio, idExterno: string): Promise<number | null> {
  if (canal.plataforma === 'mercadolivre') {
    const c = await refreshML(sb, {
      id: canal.id, empresaId: canal.empresa_id, sellerId: canal.seller_id,
      accessToken: canal.access_token, refreshToken: canal.refresh_token,
      tokenExpiraEm: canal.token_expira_em,
    } as MLChannel)
    const item = await mlGet(`/items/${idExterno}`, { attributes: 'available_quantity' }, c.accessToken)
    return typeof item?.available_quantity === 'number' ? item.available_quantity : null
  }
  if (canal.plataforma === 'tiktok') {
    const { data: canalRow } = await sb.from('marketplace_canais').select(COLUNAS_CANAL_TIKTOK).eq('id', canal.id).single()
    if (!canalRow?.shop_cipher) return null
    const c = await refreshTiktok(sb, montarCanalTiktok(canalRow))
    const produto = await getDetalheProduto(c, idExterno)
    return produto ? estoqueDoProduto(produto) : null
  }
  return null
}

export type Conferencia = { confirmado: boolean; detalhe: string }

/** O que a leitura logo depois do envio diz sobre ele. */
export function conferencia(enviado: number, medido: number): Conferencia {
  if (medido === enviado) return { confirmado: true, detalhe: `conferido na plataforma: ${medido}` }
  return {
    confirmado: false,
    detalhe: `a plataforma aceitou o envio de ${enviado}, mas a leitura logo depois ainda mostra ${medido} — ` +
      'o número não está sendo aplicado nesse anúncio (confira no painel do canal)',
  }
}
