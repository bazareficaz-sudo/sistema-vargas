// VERSÃO MÍNIMA DO PDV — capacidade de observação, ainda não de corte.
//
// O problema que motiva isto tem nome: `PDV-002`. Uma máquina pode ficar
// desligada o período inteiro de observação e reaparecer depois, com versão
// antiga, escrevendo pelo caminho velho. Enquanto isso for possível, "sete
// dias com zero uso legado" NÃO é prova de que o legado pode ser cortado —
// é prova de que ninguém ligou aquele computador nesses sete dias.
//
// NESTA FASE NADA É RECUSADO POR VERSÃO. As funções abaixo só respondem
// perguntas; nenhuma rota as usa para negar acesso, e nenhuma venda é
// bloqueada. A capacidade existe para que a decisão futura de corte possa
// ser tomada com um piso explícito em vez de com ausência de log.

/** Compara versões `x.y.z`. Devolve -1, 0 ou 1. Trata pedaços faltantes como 0. */
export function compararVersoes(a: string, b: string): number {
  const na = String(a ?? '').split('.').map(n => parseInt(n, 10) || 0)
  const nb = String(b ?? '').split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export type SituacaoVersao = 'sem_minimo' | 'atende' | 'abaixo' | 'desconhecida'

/**
 * A versão deste terminal atende ao piso?
 *
 * `desconhecida` é um estado próprio, e não um sinônimo de `abaixo`. Um
 * terminal sem versão registrada nunca falou conosco pela rota nova — tratá-lo
 * como reprovado misturaria "velho demais" com "nunca apareceu", que exigem
 * ações diferentes.
 */
export function situacaoDaVersao(
  versaoDoTerminal: string | null,
  versaoMinima: string | null,
): SituacaoVersao {
  if (!versaoMinima) return 'sem_minimo'
  if (!versaoDoTerminal) return 'desconhecida'
  return compararVersoes(versaoDoTerminal, versaoMinima) >= 0 ? 'atende' : 'abaixo'
}

/**
 * Simulação: se o piso fosse `versaoMinima`, quem ficaria de fora?
 *
 * É o relatório que torna a decisão de corte informada em vez de otimista.
 * Não altera nada — só conta.
 */
export function quemFicariaDeFora(
  terminais: { nome: string; versao_pdv: string | null }[],
  versaoMinima: string | null,
): { abaixo: string[]; desconhecida: string[] } {
  const abaixo: string[] = []
  const desconhecida: string[] = []
  for (const t of terminais) {
    const s = situacaoDaVersao(t.versao_pdv, versaoMinima)
    if (s === 'abaixo') abaixo.push(t.nome)
    if (s === 'desconhecida') desconhecida.push(t.nome)
  }
  return { abaixo, desconhecida }
}
