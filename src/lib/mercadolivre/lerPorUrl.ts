import { refreshAccessTokenIfNeeded } from './client'
import { buscarAnuncioPorUrl, type AnuncioMercadoLivre } from './item'
import type { MLChannel } from './types'

// LER UM ANÚNCIO DO MERCADO LIVRE A PARTIR DA URL.
//
// Estava embutido em `api/marketplace/mercadolivre/importar-url/route.ts`.
// Saiu para cá quando a captura de rascunho por link passou a precisar da
// mesma coisa: são dois caminhos que precisam resolver token e tratar a
// negativa do ML exatamente igual. Duas cópias divergiriam na primeira vez
// que alguém consertasse uma só.

export type LeituraPorUrl =
  | { ok: true; dados: AnuncioMercadoLivre; canalUsado: string }
  | { ok: false; erro: string; negadoPeloML: boolean }

/** Uma linha de `marketplace_canais` com o que a leitura precisa. */
export type CanalParaLeitura = {
  id: string
  empresa_id: string
  seller_id: string
  access_token: string
  refresh_token: string
  token_expira_em: string | null
}

const NEGADO = /access_denied|forbidden|403/i

export const ERRO_NEGADO =
  'O Mercado Livre negou a leitura deste anúncio com as contas conectadas desta empresa. ' +
  'Isso acontece com anúncios de outros vendedores quando a autorização da conta não permite ' +
  'essa leitura — tente reconectar a conta em Marketplaces, ou importe a partir de um anúncio ' +
  'da própria conta.'

/**
 * Tenta cada conta conectada da empresa até uma conseguir ler.
 *
 * POR QUE TENTAR VÁRIAS: o mesmo token lê os próprios anúncios e recebe 403
 * `access_denied` nos de terceiros — confirmado em produção. Uma conta que
 * falha não significa anúncio ilegível; significa que aquela autorização não
 * alcança aquele vendedor.
 *
 * POR QUE PARAR NO PRIMEIRO ERRO QUE NÃO É 403: URL inválida ou anúncio
 * encerrado vão dar o mesmo em qualquer conta. Insistir só gastaria chamadas
 * e faria o operador esperar por uma resposta que já se conhece.
 */
export async function lerAnuncioPorUrl(
  sb: unknown,
  canais: CanalParaLeitura[],
  url: string,
  canalPreferido?: string | null,
): Promise<LeituraPorUrl> {
  if (!canais.length) {
    return {
      ok: false,
      negadoPeloML: false,
      erro: 'Nenhuma conta do Mercado Livre conectada. O Mercado Livre passou a exigir login para ler anúncios — conecte uma conta em Marketplaces para usar a importação.',
    }
  }

  const ordenados = canalPreferido
    ? [...canais].sort((a, b) => (a.id === canalPreferido ? -1 : b.id === canalPreferido ? 1 : 0))
    : canais

  let ultimoErro = 'Erro ao ler o anúncio'
  for (const row of ordenados) {
    const canal: MLChannel = {
      id: row.id, empresaId: row.empresa_id, sellerId: row.seller_id,
      accessToken: row.access_token, refreshToken: row.refresh_token, tokenExpiraEm: row.token_expira_em,
    }
    try {
      const valido = await refreshAccessTokenIfNeeded(sb, canal)
      const dados = await buscarAnuncioPorUrl(url, valido.accessToken)
      return { ok: true, dados, canalUsado: row.id }
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e)
      if (!NEGADO.test(ultimoErro)) break
    }
  }

  const negado = NEGADO.test(ultimoErro)
  return { ok: false, negadoPeloML: negado, erro: negado ? ERRO_NEGADO : ultimoErro }
}
