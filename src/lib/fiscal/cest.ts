// Consulta de CEST a partir do NCM, contra a tabela do Convênio ICMS 142/2018
// carregada em `cest_tabela` (ver supabase-cest-tabela.sql).
//
// Por que consulta em vez de IA: o CEST é tabela, não dedução. Pedir para um
// modelo lembrar um código entre ~1.100 é a forma menos confiável de obter o
// dado — ele acerta a maioria e erra em silêncio, e CEST errado em produto com
// ST gera recusa na SEFAZ ou recolhimento errado.
//
// Medido contra o catálogo real (13.990 produtos ativos com NCM):
//   6.958 sem candidato  → o NCM não está na tabela de ST; CEST não se aplica
//   4.567 com 1 candidato → resposta determinística, sem IA
//   2.465 com 2+          → sobram 2 ou 3; aí sim a IA escolhe pela descrição
//
// Ou seja, 82% do catálogo é respondido sem chamada de IA nenhuma.

export type CandidatoCest = {
  cest: string
  ncmPrefixo: string
  descricao: string
}

/**
 * CESTs cujo NCM do convênio é prefixo do NCM do produto, do mais específico
 * para o mais genérico.
 *
 * A busca é por prefixo porque o convênio lista NCM em tamanhos diferentes:
 * dos 1.335 pares carregados, 462 (35%) usam prefixo de família — `3917` para
 * "tubos de plástico e acessórios", por exemplo. Comparar por igualdade
 * perderia um terço da tabela.
 */
export async function buscarCandidatosCest(sb: any, ncm: string | null | undefined): Promise<CandidatoCest[]> {
  const limpo = String(ncm ?? '').replace(/\D/g, '')
  if (limpo.length < 4) return []

  // Todo prefixo possível do NCM, de 2 a 8 dígitos. Comparar por igualdade
  // contra essa lista usa o índice; um `LIKE` invertido ('NCM' LIKE coluna||'%')
  // não usaria, e a tabela é consultada a cada abertura de produto.
  const prefixos: string[] = []
  for (let n = 2; n <= limpo.length; n++) prefixos.push(limpo.slice(0, n))

  const { data, error } = await sb
    .from('cest_tabela')
    .select('cest, ncm_prefixo, descricao')
    .in('ncm_prefixo', prefixos)
  if (error || !data) return []

  return (data as any[])
    .map(r => ({ cest: r.cest, ncmPrefixo: r.ncm_prefixo, descricao: r.descricao }))
    .sort((a, b) => b.ncmPrefixo.length - a.ncmPrefixo.length)
}

/**
 * Resolve o CEST quando dá para resolver sozinho.
 *
 * `certeza` distingue três situações que a tela precisa tratar de forma
 * diferente — e que um simples `string | null` esconderia:
 *
 *   'unico'      um candidato só: é esse, sem margem para dúvida
 *   'nao_aplica' nenhum candidato: o NCM não consta na tabela de ST
 *   'ambiguo'    dois ou mais: alguém precisa escolher (IA sugere, humano confirma)
 */
export type ResolucaoCest =
  | { certeza: 'unico'; cest: string; descricao: string }
  | { certeza: 'nao_aplica' }
  | { certeza: 'ambiguo'; candidatos: CandidatoCest[] }

export function resolverCest(candidatos: CandidatoCest[]): ResolucaoCest {
  if (candidatos.length === 0) return { certeza: 'nao_aplica' }

  // Mais de uma linha pode apontar o mesmo CEST (NCMs diferentes do mesmo
  // item). Só é ambíguo se os CÓDIGOS divergirem.
  const distintos = [...new Set(candidatos.map(c => c.cest))]
  if (distintos.length === 1) {
    return { certeza: 'unico', cest: distintos[0], descricao: candidatos[0].descricao }
  }
  return { certeza: 'ambiguo', candidatos }
}
