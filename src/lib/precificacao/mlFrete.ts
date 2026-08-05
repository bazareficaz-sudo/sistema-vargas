import type { FaixaFrete } from './tipos'

// Descobre o frete REAL que o Mercado Livre cobra do vendedor, em vez de
// pedir pro usuário digitar um "custo médio".
//
// Por que um número só não serve — medido na conta de produção:
//
//   por tamanho: 300g custa R$ 16,15 e 20kg custa R$ 75,05;
//   por preço:   o MESMO pacote de 1kg custa R$ 18,45 a R$ 79, R$ 21,55 a
//                R$ 100, R$ 24,65 a R$ 120 e R$ 30,75 de R$ 200 pra cima.
//
// Quem cadastrasse "R$ 22" erraria nos dois eixos: acharia que lucra num
// item grande e barato, e cobraria caro demais num pequeno.
//
// A API responde por preço, não por faixa — mesma situação da comissão. Então
// sondamos alguns preços e agrupamos os que dão o mesmo valor. O resultado é
// uma escada de faixas, que o motor consome igual às faixas de comissão.

const PRECOS_SONDA = [79, 100, 120, 150, 200, 300, 500, 1000]
const VALIDADE_HORAS = 24

// Abaixo deste preço o frete é por conta do comprador — custo zero pro
// vendedor. É a regra do ML, e a própria API confirma: a R$ 78,99 o desconto
// vem 0,3 e a R$ 79 vira 0,5.
const LIMITE_FRETE_GRATIS = 79

export type Embalagem = {
  comprimentoCm: number
  larguraCm: number
  alturaCm: number
  pesoG: number
}

export type ResultadoFreteML = {
  faixas: FaixaFrete[]
  pesoCobravel: number
  origem: 'api' | 'cache'
  buscadoEm: string
}

/**
 * Peso cobrável do ML: o maior entre o peso real e o volumétrico
 * (C × L × A / 6000). Conferido contra a API — uma caixa de 30×30×30 com 1 kg
 * é cobrada como 4,5 kg, e a ordem das medidas não importa.
 *
 * Existe aqui, e não só no servidor do ML, para servir de chave de cache:
 * caixas diferentes com o mesmo peso cobrável pagam o mesmo frete.
 */
export function pesoCobravelML(e: Embalagem): number {
  const volumetricoG = (e.comprimentoCm * e.larguraCm * e.alturaCm / 6000) * 1000
  return Math.round(Math.max(e.pesoG, volumetricoG))
}

/** "54 cm" / "3750 g" / "3.75 kg" → número na unidade pedida. */
function medida(valor: string | null | undefined, para: 'cm' | 'g'): number | null {
  if (!valor) return null
  const n = Number(String(valor).replace(',', '.').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  const u = String(valor).toLowerCase()
  if (para === 'g') return u.includes('kg') ? n * 1000 : n
  return u.includes('mm') ? n / 10 : u.includes('m') && !u.includes('cm') ? n * 100 : n
}

/**
 * A embalagem que o ML usa para cobrar o frete deste anúncio.
 *
 * Prefere os atributos SELLER_PACKAGE_* do próprio anúncio: é o que o ML
 * olha na hora de cobrar, e costuma estar preenchido mesmo quando o nosso
 * cadastro de produto está vazio. O cadastro entra como reserva.
 *
 * Devolve null quando não há medida em lugar nenhum — e aí é melhor não
 * calcular do que inventar uma caixa. Um chute de dimensão vira erro de
 * preço, que é o problema que esta função existe para evitar.
 */
export function embalagemDoAnuncio(
  dadosBrutos: any,
  produto?: { comprimento_cm?: number | null; largura_cm?: number | null; altura_cm?: number | null; peso_kg?: number | null } | null,
): Embalagem | null {
  const attrs: any[] = dadosBrutos?.attributes ?? []
  const attr = (id: string) => attrs.find(a => a?.id === id)?.value_name ?? null

  const comprimentoCm = medida(attr('SELLER_PACKAGE_LENGTH'), 'cm') ?? (produto?.comprimento_cm ? Number(produto.comprimento_cm) : null)
  const larguraCm = medida(attr('SELLER_PACKAGE_WIDTH'), 'cm') ?? (produto?.largura_cm ? Number(produto.largura_cm) : null)
  const alturaCm = medida(attr('SELLER_PACKAGE_HEIGHT'), 'cm') ?? (produto?.altura_cm ? Number(produto.altura_cm) : null)
  const pesoG = medida(attr('SELLER_PACKAGE_WEIGHT'), 'g') ?? (produto?.peso_kg ? Number(produto.peso_kg) * 1000 : null)

  if (!comprimentoCm || !larguraCm || !alturaCm || !pesoG) return null
  return { comprimentoCm, larguraCm, alturaCm, pesoG }
}

/** Tipo de logística do anúncio (muda o preço: fulfillment custa mais). */
export function logisticTypeDoAnuncio(dadosBrutos: any): string {
  return dadosBrutos?.shipping?.logistic_type ?? 'drop_off'
}

/** Tipo de anúncio (clássico/premium) — também entra na conta do frete. */
export function listingTypeDoAnuncio(dadosBrutos: any): string {
  return dadosBrutos?.listing_type_id ?? 'gold_special'
}

async function sondar(
  accessToken: string,
  sellerId: string,
  e: Embalagem,
  logisticType: string,
  listingType: string,
  preco: number,
): Promise<{ custo: number; pesoCobravel: number } | null> {
  const dimensoes = `${Math.round(e.comprimentoCm)}x${Math.round(e.larguraCm)}x${Math.round(e.alturaCm)},${Math.round(e.pesoG)}`
  const url = new URL(`https://api.mercadolibre.com/users/${sellerId}/shipping_options/free`)
  url.searchParams.set('dimensions', dimensoes)
  url.searchParams.set('logistic_type', logisticType)
  url.searchParams.set('listing_type_id', listingType)
  url.searchParams.set('item_price', String(preco))
  url.searchParams.set('mode', 'me2')
  url.searchParams.set('condition', 'new')
  url.searchParams.set('verbose', 'true')

  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!r.ok) return null
  const j = await r.json()
  const c = j?.coverage?.all_country
  if (!c || c.list_cost == null) return null

  // `list_cost` é o que sai do bolso do vendedor. O desconto que vem junto
  // (`discount.rate`, tipicamente 0,5 por reputação) já está aplicado nele:
  // na conta real, list_cost 21,55 vem com promoted_amount 43,10, que é
  // exatamente o dobro.
  return { custo: Number(c.list_cost), pesoCobravel: Number(c.billable_weight ?? 0) }
}

export async function resolverFreteML(
  sb: any,
  canal: { id: string; sellerId: string; accessToken: string },
  embalagem: Embalagem,
  logisticType = 'drop_off',
  listingType = 'gold_special',
): Promise<ResultadoFreteML> {
  const pesoChave = pesoCobravelML(embalagem)

  const { data: cache } = await sb.from('precificacao_ml_frete_cache')
    .select('faixas, buscado_em')
    .eq('canal_id', canal.id).eq('peso_cobravel', pesoChave)
    .eq('logistic_type', logisticType).eq('listing_type', listingType)
    .maybeSingle()

  if (cache?.buscado_em) {
    const idadeHoras = (Date.now() - new Date(cache.buscado_em).getTime()) / 3_600_000
    if (idadeHoras < VALIDADE_HORAS) {
      return { faixas: cache.faixas ?? [], pesoCobravel: pesoChave, origem: 'cache', buscadoEm: cache.buscado_em }
    }
  }

  const pontos: { preco: number; custo: number }[] = []
  let pesoCobravelApi = pesoChave
  for (const preco of PRECOS_SONDA) {
    try {
      const r = await sondar(canal.accessToken, canal.sellerId, embalagem, logisticType, listingType, preco)
      if (r) {
        pontos.push({ preco, custo: r.custo })
        if (r.pesoCobravel > 0) pesoCobravelApi = r.pesoCobravel
      }
    } catch {
      // Sonda que falha só reduz a resolução da escada — não invalida as
      // outras. Se todas falharem, devolvemos o cache antigo (abaixo).
    }
  }

  if (pontos.length === 0) {
    if (cache?.faixas) return { faixas: cache.faixas, pesoCobravel: pesoChave, origem: 'cache', buscadoEm: cache.buscado_em }
    throw new Error('Não foi possível consultar o frete do Mercado Livre para esta embalagem.')
  }

  // Primeira faixa: abaixo do limite quem paga é o comprador.
  const faixas: FaixaFrete[] = [{ min: 0, max: LIMITE_FRETE_GRATIS - 0.01, valor: 0 }]
  for (const p of pontos) {
    const ultima = faixas[faixas.length - 1]
    if (ultima && ultima.valor === p.custo) {
      ultima.max = p.preco
    } else {
      if (ultima) ultima.max = p.preco - 0.01
      faixas.push({ min: p.preco, max: p.preco, valor: p.custo })
    }
  }
  // A última faixa vale daí pra cima — a sonda mais alta é só o último ponto
  // observado, não um teto real. Conferido: de R$ 200 a R$ 1.000 o valor não
  // muda mais.
  faixas[faixas.length - 1].max = null

  const buscadoEm = new Date().toISOString()
  await sb.from('precificacao_ml_frete_cache').upsert({
    canal_id: canal.id, peso_cobravel: pesoChave,
    logistic_type: logisticType, listing_type: listingType,
    faixas, buscado_em: buscadoEm,
  }, { onConflict: 'canal_id,peso_cobravel,logistic_type,listing_type' })

  return { faixas, pesoCobravel: pesoCobravelApi, origem: 'api', buscadoEm }
}
