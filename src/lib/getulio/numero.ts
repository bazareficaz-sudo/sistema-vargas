import type { Destinatario } from './tipos'

/**
 * O mesmo número? WhatsApp no Brasil chega com e sem o 9 extra e com ou sem
 * o 55 — comparar o texto inteiro deixaria o dono sem resposta.
 * Compara DDD + os 8 últimos dígitos.
 */
export function mesmoNumero(a: string, b: string): boolean {
  const norm = (n: string) => {
    let d = String(n ?? '').replace(/\D/g, '')
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
    if (d.length < 10) return null
    return `${d.slice(0, 2)}|${d.slice(-8)}`
  }
  const x = norm(a), y = norm(b)
  return !!x && x === y
}

export function destinatarioDoNumero(destinatarios: Destinatario[], numero: string): Destinatario | null {
  return destinatarios.find(d => mesmoNumero(d.numero, numero)) ?? null
}

