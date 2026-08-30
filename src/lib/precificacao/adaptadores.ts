import type { CampanhaCanonica, ItemCampanha } from './campanhas'

// ADAPTADORES DE CAMPANHA — a fronteira entre o modelo canônico e cada
// marketplace.
//
//   INTELIGÊNCIA COMERCIAL
//           ↓
//     MODELO CANÔNICO        (campanhas.ts)
//           ↓
//   ADAPTADOR SHOPEE · ADAPTADOR MERCADO LIVRE
//           ↓
//        APIs
//
// O núcleo entende campanha, preço, janela, status e elegibilidade. O
// adaptador entende os detalhes de cada plataforma. Nada de específico de
// marketplace entra em `motor.ts` nem em `cenarios.ts`.
//
// FASE 2: só LEITURA. Nenhuma operação de escrita foi implementada — entrar
// em campanha, sair, alterar preço promocional. É decisão do prompt desta
// fase, e também a única postura honesta enquanto a matemática nova não foi
// validada contra dados reais.

export type ResultadoSincronizacao = {
  ok: boolean
  campanhas: number
  itens: number
  avisos: string[]
  erro?: string
}

/**
 * O que um adaptador de campanha precisa saber fazer.
 *
 * Só leitura por enquanto. Quando a escrita entrar (Fase 3+), ela vem como
 * métodos NOVOS e opcionais — participar, sair, atualizar —, para que um
 * adaptador que só lê continue sendo um adaptador válido.
 */
export type AdaptadorCampanhas = {
  plataforma: string
  /** A plataforma expõe campanhas para este canal, com as credenciais atuais? */
  disponivel: boolean
  /** Quando `disponivel` é falso, o porquê — para a tela poder dizer. */
  indisponivelPorque?: string
  /** Traz as campanhas da plataforma para o espelho local. */
  sincronizar?(): Promise<ResultadoSincronizacao>
  /** Itens que a plataforma convidou/considera elegíveis, quando ela informa. */
  listarElegiveis?(): Promise<{ itemIdExterno: string; campanhaIdExterna: string }[]>
}

export type CampanhaNormalizada = { campanha: CampanhaCanonica; itens: ItemCampanha[] }

// ── SHOPEE ───────────────────────────────────────────────────────────────────
//
// Implementada, e não é novidade desta fase: `lib/shopee/discount.ts` já lia
// `get_discount_list` e `get_discount`, e `lib/marketplace/promocoesSync.ts`
// já gravava o espelho reconciliado. A Fase 2 não reescreveu nada disso —
// apenas passou a LER esse espelho para resolver o preço efetivo.
//
// O que ainda falta na Shopee, e não é código:
//
//   - A sincronização é MANUAL (botão em Marketplaces → Promoções). Não há
//     cron. Enquanto for assim, o espelho envelhece e `vigenciaDaCampanha`
//     confia na janela, não no status.
//   - `marketplace_promocoes` está com 0 linha medida até 27/08/2026: a
//     leitura nunca foi exercitada contra uma loja com campanha ativa.

export const ADAPTADOR_SHOPEE: AdaptadorCampanhas = {
  plataforma: 'shopee',
  disponivel: true,
}

// ── MERCADO LIVRE ────────────────────────────────────────────────────────────
//
// NÃO IMPLEMENTADO, DE PROPÓSITO.
//
// A auditoria de 29/08/2026 encontrou zero código de promoção na integração do
// ML: `grep -niE "promotion|deal|campaign|discount|oferta" src/lib/mercadolivre/*.ts`
// não retorna nada. Seria terreno virgem — e não foi possível fundamentá-lo:
//
//   1. A documentação oficial do Mercado Livre responde HTTP 403 a este
//      ambiente, em todos os domínios testados (developers.mercadolivre.com.br,
//      .com.ar, .com.co e global-selling.mercadolibre.com).
//   2. Não houve como sondar a API real: a máquina onde este código foi
//      escrito não tem `.env.local`, logo não tem token nem seller_id. Foi
//      sondando a conta de produção que a comissão e o frete reais foram
//      descobertos na Fase 1 (ver mlComissao.ts e mlFrete.ts); aqui esse
//      caminho estava fechado.
//
// Escrever o cliente a partir de resumo de mecanismo de busca repetiria o erro
// que a publicação na Shopee já custou: contrato descoberto erro a erro
// ("condition is required", "ValueId is required"), contra a API de produção.
//
// O QUE OS RESUMOS INDICAM — NÃO VERIFICADO, NÃO USAR SEM CONFERIR:
//
//   GET /seller-promotions/users/{user_id}            campanhas do vendedor
//   GET /seller-promotions/promotions/{id}/items      itens de uma campanha
//   GET /seller-promotions/items/{item_id}            promoções de um anúncio
//   GET /seller-promotions/candidates                 itens convidados
//   query obrigatória: app_version=v2
//   promotion_type: DEAL · MARKETPLACE_CAMPAIGN · SELLER_CAMPAIGN · DOD ·
//                   LIGHTNING · VOLUME · PRICE_DISCOUNT · PRE_NEGOTIATED ·
//                   SMART · PRICE_MATCHING · UNHEALTHY_STOCK ·
//                   SELLER_COUPON_CAMPAIGN
//
// O QUE PRECISA SER RESPONDIDO ANTES DE IMPLEMENTAR (Fase 3):
//
//   1. O token atual tem escopo para `seller-promotions`? O OAuth deste
//      sistema foi autorizado para itens, pedidos e envios; promoções podem
//      exigir escopo adicional, e isso significa REAUTORIZAR a conta.
//   2. Qual `promotion_type` interessa? "Campanha do marketplace" (a loja é
//      convidada) e "campanha do vendedor" (a loja cria) são objetos
//      diferentes, com regras de entrada diferentes.
//   3. O preço promocional é informado por item ou por variação, como na
//      Shopee? Isso decide se `marketplace_promocao_itens.model_id` serve
//      como está.
//   4. A API informa subsídio/participação (quanto o ML banca do desconto)?
//      Se informar, a margem real de uma campanha é melhor que a aparente, e
//      o modelo canônico precisa de um campo para isso.
//   5. Existe webhook/notificação de mudança de promoção, ou só polling?
//      Decide se a sincronização entra na fila existente ou vira cron.
//   6. Rate limit da família `/seller-promotions`.
//
// COMO RESPONDER: a sonda existe desde 30/08/2026 —
// `GET /api/precificacao/sondar-ml` (src/app/api/precificacao/sondar-ml/route.ts).
// Ela roda no servidor com o token que já está guardado no canal, faz só GET,
// e reporta o STATUS CRU de cada chamada: 403 significa falta de escopo (e
// portanto reautorizar a conta), 404 significa que o caminho do resumo de
// busca estava errado. São coisas diferentes e não podem virar "erro".
//
// Enquanto a sonda não for executada contra a conta real, este adaptador
// continua `disponivel: false` e as capacidades seguem `nao_verificado`. Ter
// a sonda não é o mesmo que ter a medição.

export const ADAPTADOR_MERCADOLIVRE: AdaptadorCampanhas = {
  plataforma: 'mercadolivre',
  disponivel: false,
  indisponivelPorque:
    'A leitura de campanhas do Mercado Livre ainda não foi implementada: a documentação oficial está inacessível a partir deste ambiente e a API não pôde ser sondada com credenciais reais. Ver as perguntas em src/lib/precificacao/adaptadores.ts.',
}

const POR_PLATAFORMA: Record<string, AdaptadorCampanhas> = {
  shopee: ADAPTADOR_SHOPEE,
  mercadolivre: ADAPTADOR_MERCADOLIVRE,
}

/**
 * O adaptador de uma plataforma.
 *
 * Plataforma desconhecida devolve um adaptador indisponível em vez de
 * `undefined`: a tela precisa poder dizer "não dá, e por isto" sem tratar
 * ausência.
 */
export function adaptadorDe(plataforma: string): AdaptadorCampanhas {
  return POR_PLATAFORMA[plataforma] ?? {
    plataforma,
    disponivel: false,
    indisponivelPorque: `O sistema ainda não lê campanhas de ${plataforma}.`,
  }
}
