import { mlGet } from '@/lib/mercadolivre/client'
import type { FaixaComissao } from './tipos'

// Descobre a comissão REAL do Mercado Livre em vez de pedir pro usuário
// digitar um percentual.
//
// Por que isso importa: medido na conta de produção, na mesma categoria, a
// alíquota é 11,5% a R$ 25 e 10,5% a R$ 250. Quem cadastrasse "11%" erraria
// nos dois extremos — pra menos nos itens baratos (achando que lucra mais do
// que lucra) e pra mais nos caros.
//
// A API responde por preço, não por faixa. Então sondamos alguns preços e
// agrupamos os pontos que têm a mesma alíquota — o resultado é a tabela de
// faixas que o motor consome igual a qualquer outra.

const PRECOS_SONDA = [15, 30, 50, 79, 100, 150, 250, 500, 1000]
const VALIDADE_HORAS = 12

export type ResultadoComissaoML = {
  faixas: FaixaComissao[]
  origem: 'api' | 'cache'
  buscadoEm: string
}

async function sondar(accessToken: string, categoriaId: string, listingType: string, preco: number) {
  const dados = await mlGet('/sites/MLB/listing_prices', { price: preco, category_id: categoriaId }, accessToken)
  const lista = Array.isArray(dados) ? dados : [dados]
  const alvo = lista.find((x: any) => x?.listing_type_id === listingType) ?? lista[0]
  if (!alvo) return null
  const det = alvo.sale_fee_details ?? {}
  return {
    percentual: Number(det.percentage_fee ?? 0),
    fixo: Number(det.fixed_fee ?? 0),
  }
}

export async function resolverFaixasML(
  sb: any,
  canal: { id: string; accessToken: string },
  categoriaId: string,
  listingType = 'gold_special',
): Promise<ResultadoComissaoML> {
  const { data: cache } = await sb.from('precificacao_ml_comissao_cache')
    .select('faixas, buscado_em')
    .eq('canal_id', canal.id).eq('categoria_id', categoriaId).eq('listing_type', listingType)
    .maybeSingle()

  if (cache?.buscado_em) {
    const idadeHoras = (Date.now() - new Date(cache.buscado_em).getTime()) / 3_600_000
    if (idadeHoras < VALIDADE_HORAS) {
      return { faixas: cache.faixas ?? [], origem: 'cache', buscadoEm: cache.buscado_em }
    }
  }

  const pontos: { preco: number; percentual: number; fixo: number }[] = []
  for (const preco of PRECOS_SONDA) {
    try {
      const r = await sondar(canal.accessToken, categoriaId, listingType, preco)
      if (r) pontos.push({ preco, ...r })
    } catch {
      // Sonda que falha só reduz a resolução da tabela — não invalida as
      // outras. Se todas falharem, devolvemos o cache antigo (ver abaixo).
    }
  }

  if (pontos.length === 0) {
    if (cache?.faixas) return { faixas: cache.faixas, origem: 'cache', buscadoEm: cache.buscado_em }
    throw new Error('Não foi possível consultar a comissão do Mercado Livre para esta categoria.')
  }

  // Agrupa pontos vizinhos com a mesma alíquota numa faixa só.
  const faixas: FaixaComissao[] = []
  for (const p of pontos) {
    const ultima = faixas[faixas.length - 1]
    if (ultima && ultima.percentual === p.percentual && ultima.fixo === p.fixo) {
      ultima.max = p.preco
    } else {
      if (ultima) ultima.max = p.preco - 0.01
      faixas.push({ min: faixas.length === 0 ? 0 : p.preco, max: p.preco, percentual: p.percentual, fixo: p.fixo })
    }
  }
  // A última faixa vale daí pra cima — a sonda mais alta é só o último ponto
  // observado, não um teto real.
  if (faixas.length > 0) faixas[faixas.length - 1].max = null

  const buscadoEm = new Date().toISOString()
  await sb.from('precificacao_ml_comissao_cache').upsert({
    canal_id: canal.id, categoria_id: categoriaId, listing_type: listingType,
    faixas, buscado_em: buscadoEm,
  }, { onConflict: 'canal_id,categoria_id,listing_type' })

  return { faixas, origem: 'api', buscadoEm }
}
