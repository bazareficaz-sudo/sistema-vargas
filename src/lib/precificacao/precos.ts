import { vigenciaDaCampanha, itemDoAnuncio, proximidadeDoFim, type CampanhaDoAnuncio, type ProximidadeFim } from './campanhas'

// Vocabulário canônico de preços de anúncio.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// "Preço do anúncio" era resolvido em cada tela com a mesma expressão copiada
// (`preco_promocional || preco_venda`) e uma leitura errada do que cada coluna
// significa. Medido no código em 28/08/2026:
//
//   `marketplace_anuncios.preco_venda` NÃO é o preço "de tabela": é o preço
//   VIGENTE espelhado do canal. A Shopee grava `current_price` (já com o
//   desconto da campanha aplicado) e o Mercado Livre grava `rawItem.price`,
//   que é o preço que o comprador vê hoje. Ver `lib/shopee/sync.ts` e
//   `lib/mercadolivre/sync.ts`.
//
//   `marketplace_anuncios.preco_promocional`, `promo_inicio` e `promo_fim`
//   NÃO são alimentados por sincronização nenhuma. São campos LOCAIS, escritos
//   só pelo editor manual de anúncio. O comentário de
//   `supabase-marketplace-promocoes.sql` registra a medição de 27/08/2026: os
//   1.286 anúncios Shopee tinham os três nulos, "ninguém nunca escreveu
//   neles".
//
//   A campanha de verdade da Shopee mora em `marketplace_promocoes` +
//   `marketplace_promocao_itens`, com janela e itens próprios — tabela criada
//   justamente porque três colunas no anúncio não cabem no modelo.
//
// Então o vocabulário correto é:
//
//   BASE        `preco_venda` — o que o canal está cobrando, espelhado.
//   PROMOCIONAL `preco_promocional` — intenção LOCAL, dentro da janela local.
//   EFETIVO     o que vale agora: o promocional local quando vigente, senão a
//               base.
//
// A Fase 2 (campanhas) vai acrescentar uma quarta origem — o preço vindo de
// `marketplace_promocao_itens`. O formato de `PrecoAnuncio` já prevê isso em
// `origemEfetivo`, para a tela não precisar mudar de forma quando acontecer.

export type AnuncioComPreco = {
  preco_venda?: number | null
  preco_promocional?: number | null
  promo_inicio?: string | null
  promo_fim?: string | null
}

export type OrigemPrecoEfetivo = 'base' | 'promocional_local' | 'campanha'

export type PrecoAnuncio = {
  /** `preco_venda`: o preço espelhado do canal. */
  base: number
  /** `preco_promocional` quando existe, esteja vigente ou não. */
  promocionalLocal: number | null
  /** A promoção local está dentro da janela agora? */
  promocaoLocalVigente: boolean
  /** O preço que vale neste instante — é sobre ele que a margem é medida. */
  efetivo: number
  origemEfetivo: OrigemPrecoEfetivo
}

function numero(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function dentroDaJanela(inicio: string | null | undefined, fim: string | null | undefined, agora: Date): boolean {
  if (inicio) {
    const d = new Date(inicio)
    if (!Number.isNaN(d.getTime()) && agora < d) return false
  }
  if (fim) {
    const d = new Date(fim)
    if (!Number.isNaN(d.getTime()) && agora > d) return false
  }
  return true
}

/**
 * Decompõe os preços de um anúncio.
 *
 * MUDANÇA DE COMPORTAMENTO DELIBERADA NA FASE 1: a expressão antiga
 * (`preco_promocional || preco_venda`) ignorava `promo_inicio` e `promo_fim`,
 * exatamente como a etiqueta de prateleira ignorava a vigência da promoção do
 * ERP. Promoção vencida continuava valendo para sempre no cálculo de margem.
 * Aqui a janela é respeitada; fora dela, vale a base.
 *
 * Também exige que o promocional seja MENOR que a base — mesma regra de
 * `lib/produtos/promocao.ts`. Um "promocional" maior que o preço do canal é
 * dado sujo, não uma promoção.
 */
export function precosDoAnuncio(a: AnuncioComPreco, agora: Date = new Date()): PrecoAnuncio {
  const base = numero(a.preco_venda)
  const promoBruto = a.preco_promocional == null ? null : numero(a.preco_promocional)
  const promocionalLocal = promoBruto != null && promoBruto > 0 ? promoBruto : null

  const vigente = promocionalLocal != null
    && (base <= 0 || promocionalLocal < base)
    && dentroDaJanela(a.promo_inicio, a.promo_fim, agora)

  return {
    base,
    promocionalLocal,
    promocaoLocalVigente: vigente,
    efetivo: vigente ? promocionalLocal! : base,
    origemEfetivo: vigente ? 'promocional_local' : 'base',
  }
}

/** Atalho para quem só quer o número que vale agora. */
export function precoEfetivo(a: AnuncioComPreco, agora: Date = new Date()): number {
  return precosDoAnuncio(a, agora).efetivo
}

// ── PREÇO EFETIVO COM CAMPANHA (Fase 2) ─────────────────────────────────────
//
// `precosDoAnuncio` acima enxerga só o que está na linha do anúncio. A partir
// daqui entra a campanha real da plataforma, que é a terceira origem possível
// do preço vigente — e a mais confiável, porque é datada e veio de fora.
//
// A ARMADILHA DO DESCONTO DUPLO
//
// Na Shopee, `preco_venda` recebe `current_price`, que JÁ É o preço com o
// desconto da campanha aplicado. Se alguém tratasse `preco_venda` como preço
// estrutural e aplicasse por cima o desconto da campanha, o resultado seria o
// desconto contado duas vezes — e a margem apareceria muito pior do que é,
// levando a subir preço sem motivo.
//
// Aqui isso é impossível por construção: NENHUM percentual é aplicado sobre
// nenhum preço. O preço da campanha é LIDO de `preco_promocional`, e o preço
// base é LIDO de `preco_original`. Multiplicação não existe neste arquivo.
//
// De quebra, a campanha melhora o que sabíamos: `preco_original` é o preço
// estrutural que o espelho do anúncio não guarda em lugar nenhum.

export type CampanhaVigenteResumo = {
  id: string
  nome: string
  idExterno: string | null
  plataforma: string
  inicio: string | null
  fim: string | null
  precoCampanha: number
  precoBase: number | null
  proximidade: ProximidadeFim
  diasRestantes: number | null
  horasRestantes: number | null
}

export type PrecoResolvido = PrecoAnuncio & {
  /** De onde veio o preço base: da campanha (preço original) ou do espelho. */
  origemBase: 'campanha' | 'espelho'
  /** A campanha que está mandando no preço agora, se houver. */
  campanha: CampanhaVigenteResumo | null
  /** Até quando este preço vale, quando há prazo declarado. */
  validadeAte: string | null
  avisos: string[]
}

/**
 * O preço que vale agora, considerando campanha real, promoção local e
 * espelho — nesta ordem de precedência.
 *
 * POR QUE ESTA ORDEM
 *
 * 1. CAMPANHA REAL. É a única origem confirmada pela plataforma, com janela
 *    datada e preço que ela mesma informou. Ganha de tudo.
 * 2. PROMOÇÃO LOCAL. É intenção do operador digitada aqui dentro; nenhuma
 *    sincronização confirma que a plataforma a esteja praticando.
 * 3. ESPELHO (`preco_venda`). O que a última sincronização viu.
 *
 * Campanha expirada, futura, encerrada ou em rascunho não entra — e o motivo
 * vai nos avisos em vez de sumir.
 */
export function resolverPrecoEfetivo(entrada: {
  anuncio: AnuncioComPreco & { id?: string }
  campanhas?: CampanhaDoAnuncio[]
  agora?: Date
}): PrecoResolvido {
  const agora = entrada.agora ?? new Date()
  const local = precosDoAnuncio(entrada.anuncio, agora)
  const avisos: string[] = []
  const anuncioId = entrada.anuncio.id ?? null

  // ── Candidatas: campanhas vigentes com preço para ESTE anúncio ──
  const candidatas: CampanhaVigenteResumo[] = []
  for (const c of entrada.campanhas ?? []) {
    const vigencia = vigenciaDaCampanha(c.campanha, agora)
    avisos.push(...vigencia.avisos)
    if (!vigencia.vigente) continue
    if (!anuncioId) continue

    const { item, aviso } = itemDoAnuncio(c.itens, anuncioId)
    if (aviso) avisos.push(aviso)
    if (!item?.precoCampanha) continue

    const prox = proximidadeDoFim(vigencia.restaMs)
    candidatas.push({
      id: c.campanha.id,
      nome: c.campanha.nome,
      idExterno: c.campanha.idExterno,
      plataforma: c.campanha.plataforma,
      inicio: c.campanha.inicio,
      fim: c.campanha.fim,
      precoCampanha: item.precoCampanha,
      precoBase: item.precoBase,
      proximidade: prox.estado,
      diasRestantes: prox.diasRestantes,
      horasRestantes: prox.horasRestantes,
    })
  }

  if (candidatas.length === 0) {
    return { ...local, origemBase: 'espelho', campanha: null, validadeAte: local.promocaoLocalVigente ? (entrada.anuncio.promo_fim ?? null) : null, avisos }
  }

  // Mais de uma campanha valendo: o comprador paga a menor. Escolher a menor
  // é o que descreve a realidade — e o aviso existe porque duas campanhas
  // simultâneas sobre o mesmo item costumam ser erro de cadastro.
  candidatas.sort((a, b) => a.precoCampanha - b.precoCampanha)
  const vencedora = candidatas[0]
  if (candidatas.length > 1) {
    avisos.push(`Há ${candidatas.length} campanhas vigentes para este anúncio. Vale a de menor preço (${vencedora.nome}).`)
  }

  // O preço base melhora: `preco_original` da campanha é o preço estrutural,
  // que o espelho do anúncio não guarda.
  const base = vencedora.precoBase ?? local.base
  const origemBase = vencedora.precoBase != null ? 'campanha' as const : 'espelho' as const

  // Divergência entre o espelho e a campanha. Na Shopee os dois deveriam
  // bater, porque `preco_venda` recebe `current_price` — se não batem, uma
  // das duas leituras está velha, e quem decide olhando a tela precisa saber.
  if (local.base > 0 && Math.abs(local.base - vencedora.precoCampanha) > 0.01 && Math.abs(local.base - base) > 0.01) {
    avisos.push(
      `O preço espelhado do anúncio (R$ ${local.base.toFixed(2)}) não bate com o da campanha ` +
      `(R$ ${vencedora.precoCampanha.toFixed(2)}) nem com o preço original dela. Alguma das duas sincronizações está atrasada.`,
    )
  }

  if (local.promocaoLocalVigente && Math.abs(local.efetivo - vencedora.precoCampanha) > 0.01) {
    avisos.push('Existe promoção local vigente além da campanha da plataforma. Vale a campanha — a promoção local não é confirmada pelo canal.')
  }

  return {
    base,
    origemBase,
    promocionalLocal: local.promocionalLocal,
    promocaoLocalVigente: local.promocaoLocalVigente,
    efetivo: vencedora.precoCampanha,
    origemEfetivo: 'campanha',
    campanha: vencedora,
    validadeAte: vencedora.fim,
    avisos,
  }
}
