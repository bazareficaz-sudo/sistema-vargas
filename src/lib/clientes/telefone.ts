// Telefone de cliente: comparar o que o balconista digita com o cadastro.
//
// O cadastro guarda só dígitos ("21991203602"), mas o que se digita no balcão
// vem de todo jeito: "(21) 99120-3602", "+55 21 99120 3602", sem o DDD...
// Tudo vira dígitos, sem o 55 do país e sem o 0 de discagem, e a comparação
// é pelo FINAL do número — o que permite achar o cliente mesmo quando um dos
// lados está sem DDD.

/** Só os dígitos, sem código do país (55) e sem zero de discagem à frente. */
export function normalizarTelefone(v: string | null | undefined): string {
  let d = (v ?? '').replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  // 0 de discagem antes do DDD: fixo (0 + 10 dígitos) ou celular (0 + 11).
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  return d
}

/** Mínimo de dígitos para valer a pena procurar (um número sem DDD). */
export const DIGITOS_MINIMOS = 8

export function telefoneBuscavel(v: string | null | undefined): boolean {
  return normalizarTelefone(v).length >= DIGITOS_MINIMOS
}

/**
 * O mesmo telefone? Compara o final dos dois números pelo tamanho do menor
 * (até 11 dígitos), exigindo pelo menos 8 — com menos que isso, coincidência
 * vira cliente errado puxado para a venda.
 */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizarTelefone(a), y = normalizarTelefone(b)
  const n = Math.min(x.length, y.length, 11)
  if (n < DIGITOS_MINIMOS) return false
  return x.slice(-n) === y.slice(-n)
}

/** "(21) 99120-3602" para mostrar na tela. */
export function formatarTelefone(v: string | null | undefined): string {
  const d = normalizarTelefone(v)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`
  return d
}
