import { mlGet } from '@/lib/mercadolivre/client'

// Competitividade no Mercado Livre pela via oficial.
//
// A busca pública (/sites/MLB/search) passou a devolver 403 — o ML fechou
// esse endpoint. O que continua aberto, e é melhor, é a sugestão de preço do
// próprio ML para OS SEUS anúncios: ele compara com os concorrentes que
// disputam a mesma posição e diz se você está caro, competitivo, e qual
// preço deixaria você bem colocado.
//
// Medido na conta real: um anúncio a R$ 49,99 voltou
// status "with_benchmark_highest", sugerido R$ 49,20, menor R$ 49,20.
// Nem todo anúncio tem benchmark — os sem comparação devolvem 404, e isso
// é informação, não erro.

export type Competitividade = {
  itemId: string
  status: string
  precoAtual: number | null
  precoSugerido: number | null
  precoMenor: number | null
  temBenchmark: boolean
}

// Tradução dos status que o ML devolve. Mantém o original quando aparecer
// algo novo, em vez de esconder atrás de um rótulo genérico.
const ROTULOS: Record<string, string> = {
  with_benchmark_highest: 'acima do mercado',
  with_benchmark_lowest: 'abaixo do mercado',
  with_benchmark_ok: 'competitivo',
  no_benchmark_lowest: 'sem concorrência direta (você é o mais barato)',
  no_benchmark_highest: 'sem concorrência direta (você é o mais caro)',
  not_enough_information: 'o ML ainda não tem dados suficientes',
}

export function rotuloCompetitividade(status: string): string {
  return ROTULOS[status] ?? status
}

export async function buscarCompetitividade(accessToken: string, itemId: string): Promise<Competitividade | null> {
  try {
    const d = await mlGet(`/suggestions/items/${itemId}/details`, {}, accessToken)
    return {
      itemId,
      status: d?.status ?? 'desconhecido',
      precoAtual: d?.current_price?.amount != null ? Number(d.current_price.amount) : null,
      precoSugerido: d?.suggested_price?.amount != null ? Number(d.suggested_price.amount) : null,
      precoMenor: d?.lowest_price?.amount != null ? Number(d.lowest_price.amount) : null,
      temBenchmark: String(d?.status ?? '').startsWith('with_benchmark'),
    }
  } catch {
    // 404 = o ML não tem comparação pra este item. Não é falha nossa.
    return null
  }
}
