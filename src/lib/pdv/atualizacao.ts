// ATÉ QUE VERSÃO ESTE TERMINAL PODE SE ATUALIZAR SOZINHO.
//
// O teto mora em `pdv_terminais.atualizacao_liberada_ate`. A decisão de baixar
// é do PDV (ele sabe a própria versão e a que a Release oferece); o servidor
// só responde o teto — e só um teto bem formado. Um valor torto no banco vira
// "não liberado", nunca "libera qualquer coisa".

const VERSAO_RE = /^\d+\.\d+\.\d+$/

export function tetoDeAtualizacao(valor: unknown): string | null {
  return typeof valor === 'string' && VERSAO_RE.test(valor.trim()) ? valor.trim() : null
}
