// A Loja Online é um canal de venda — mas não é um marketplace.
//
// Ela vive em `marketplace_canais` de propósito: é assim que o pedido da loja
// vai nascer em `marketplace_pedidos` na Fase 3 e aparecer nas telas de
// Pedidos sem nenhum OMS novo. O modelo está certo.
//
// O que NÃO vale é deixá-la cair nas telas e rotinas de integração de
// marketplace. Ela não tem `access_token`, não tem API, não tem anúncio para
// sincronizar. E o código existente tem dois pontos que tratam plataforma
// desconhecida como Shopee por omissão:
//
//   AnunciosClient.tsx      → `PLATAFORMAS_COM_SYNC.includes(p) ? p : 'shopee'`
//   EnviarPrecoEstoqueModal → `p === 'mercadolivre' ? 'mercadolivre' : 'shopee'`
//
// Sem este guarda, clicar em "Sincronizar" no canal da loja dispararia uma
// chamada à API da Shopee com o id errado. Não é hipótese: é o mesmo defeito
// que a Nuvemshop já sofre hoje, registrado no CONTINUIDADE.md.
//
// Os crons não precisam de mudança — todos filtram por plataforma explícita
// ou exigem `access_token`, que a loja nunca terá. Conferido um a um.

export const PLATAFORMA_LOJA_ONLINE = 'loja_online'

/** Plataformas que têm integração de verdade (OAuth, anúncio, sincronização). */
export const PLATAFORMAS_MARKETPLACE = ['shopee', 'mercadolivre', 'nuvemshop'] as const

export function ehLojaOnline(plataforma: string | null | undefined): boolean {
  return plataforma === PLATAFORMA_LOJA_ONLINE
}

/**
 * O canal aceita as operações de marketplace (anúncio, sync, envio de
 * preço/estoque)?
 *
 * Lista branca, não lista negra: plataforma nova que ninguém previu é
 * recusada até alguém decidir o contrário. O contrário — aceitar por omissão
 * — é como a loja acabaria conversando com a API da Shopee.
 */
export function ehCanalMarketplace(plataforma: string | null | undefined): boolean {
  return (PLATAFORMAS_MARKETPLACE as readonly string[]).includes(plataforma ?? '')
}

/** Os interruptores que a fila exige de um canal para enviar qualquer coisa. */
export type CanalComInterruptores = {
  plataforma?: string | null
  sincronizar_estoque?: boolean | null
  atualizar_estoque_canal?: boolean | null
}

/**
 * O canal aceita receber atualização da fila?
 *
 * Reaproveita os interruptores que já existem em Configurar → canal, em vez
 * de inventar um terceiro: é por eles que se liga a fila em um canal só,
 * como planejado, sem precisar de tela nova.
 *
 * MORA AQUI, e não em `envio.ts`, porque a TELA precisa fazer a mesma
 * pergunta e `envio.ts` arrasta os clientes de escrita das três plataformas.
 * Duas cópias do predicado foi exatamente o que deixou a coluna "Regra"
 * dizendo "enviando" para anúncio que a fila recusava.
 */
export function canalAceitaEnvio(canal: CanalComInterruptores): boolean {
  // A Loja Online é um canal de venda, mas não tem API para receber envio:
  // ela lê o estoque do ERP na hora de renderizar. Recusar aqui, e não
  // confiar nos interruptores, porque um clique errado em Configurar → canal
  // colocaria a fila para tentar publicar num destino que não existe — e a
  // fila só desiste depois de 5 tentativas por produto.
  if (!ehCanalMarketplace(canal.plataforma)) return false
  return !!canal.sincronizar_estoque && !!canal.atualizar_estoque_canal
}
