import { db } from './db'
import type { Loja } from './tipos'

// Proteção do fechamento de pedido contra abuso.
//
// Cada pedido da loja reserva estoque SEM prazo (ver supabase-loja-checkout.sql),
// então um script que dispare pedidos falsos trava mercadoria de verdade e
// enche a fila de separação. Três travas, da mais barata à mais cara:
//
//   1. por IP, em memória — corta rajada; é por instância do servidor, então
//      é só a primeira peneira, nunca a garantia;
//   2. por telefone, no banco — vale em qualquer instância;
//   3. por loja, no banco — disjuntor para ataque que troca IP e telefone.
//
// As consultas ao banco FALHAM ABERTAS: se o limitador quebrar, a venda
// continua. Perder pedido real por defeito do anti-abuso é pior que deixar
// passar uma tentativa.

const JANELA_IP_MS = 10 * 60_000
const MAX_POR_IP = 6
const MAX_POR_TELEFONE_HORA = 5
const MAX_POR_LOJA_10MIN = 40

const porIp = new Map<string, number[]>()

/** IP de quem chamou. Atrás da Vercel, o primeiro item de x-forwarded-for. */
export function ipDe(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  return (xff?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'desconhecido').trim()
}

/** Registra a tentativa e diz se estourou o limite do IP. */
export function ipEstourou(ip: string, agora = Date.now()): boolean {
  const recentes = (porIp.get(ip) ?? []).filter(t => agora - t < JANELA_IP_MS)
  recentes.push(agora)
  porIp.set(ip, recentes)

  // Varredura ocasional: sem ela o mapa cresce com cada IP que já passou.
  if (porIp.size > 2000) {
    for (const [k, v] of porIp) {
      if (v.every(t => agora - t >= JANELA_IP_MS)) porIp.delete(k)
    }
  }
  return recentes.length > MAX_POR_IP
}

async function contar(loja: Loja, desdeMs: number, telefone?: string): Promise<number> {
  let q = db()
    .from('marketplace_pedidos')
    .select('id', { count: 'exact', head: true })
    .eq('canal_id', loja.canalId)
    .gte('data_pedido', new Date(Date.now() - desdeMs).toISOString())
  if (telefone) q = q.eq('dados_brutos->>telefone', telefone)
  const { count, error } = await q
  if (error) {
    console.error('[loja] limitador falhou', { lojaId: loja.id, erro: error.message })
    return 0
  }
  return count ?? 0
}

export type MotivoLimite = 'telefone' | 'loja'

/** Confere as travas do banco. `telefone` precisa vir só com dígitos. */
export async function limiteDoBancoEstourou(
  loja: Loja,
  telefone: string,
): Promise<MotivoLimite | null> {
  const [doTelefone, daLoja] = await Promise.all([
    contar(loja, 60 * 60_000, telefone),
    contar(loja, 10 * 60_000),
  ])
  if (doTelefone >= MAX_POR_TELEFONE_HORA) return 'telefone'
  if (daLoja >= MAX_POR_LOJA_10MIN) return 'loja'
  return null
}
