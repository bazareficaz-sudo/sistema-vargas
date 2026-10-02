// Vendas agregadas para o Vargas Marketing (contrato v1).
//
// O Marketing mede se um Status/Story trouxe venda comparando o produto antes
// e depois da postagem. Para isso basta a soma por produto e por dia — nunca
// sai cliente, venda individual, forma de pagamento, custo ou margem.

export const FUSO_VENDAS = 'America/Sao_Paulo'

export type VendaBase = { id: string; created_at: string }
export type ItemVenda = { venda_id: string; produto_id: string | null; quantidade: number | string | null; preco_unitario: number | string | null }
export type VendaAgregada = { source_product_id: string; day: string; quantity: number; revenue_minor: number }

const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_VENDAS, year: 'numeric', month: '2-digit', day: '2-digit' })
export const diaLocal = (iso: string) => formatoDia.format(new Date(iso))

/** Início do dia (00:00 de São Paulo) em ISO UTC. O Brasil não tem horário de verão desde 2019. */
export const inicioDoDiaLocal = (dia: string) => new Date(`${dia}T00:00:00-03:00`).toISOString()

export function agregarVendas(vendas: VendaBase[], itens: ItemVenda[], comTag: Set<string>): VendaAgregada[] {
  const diaDaVenda = new Map(vendas.map(v => [String(v.id), diaLocal(v.created_at)]))
  const somas = new Map<string, VendaAgregada>()
  for (const it of itens) {
    const dia = diaDaVenda.get(String(it.venda_id))
    if (!dia || !it.produto_id || !comTag.has(it.produto_id)) continue
    const qtd = Number(it.quantidade), preco = Number(it.preco_unitario)
    if (!Number.isFinite(qtd) || qtd <= 0) continue
    const chave = `${it.produto_id}|${dia}`
    const atual = somas.get(chave) ?? { source_product_id: it.produto_id, day: dia, quantity: 0, revenue_minor: 0 }
    atual.quantity += qtd
    atual.revenue_minor += Number.isFinite(preco) && preco > 0 ? Math.round(qtd * preco * 100) : 0
    somas.set(chave, atual)
  }
  return [...somas.values()]
    .map(s => ({ ...s, quantity: Math.round(s.quantity * 1000) / 1000 }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.source_product_id.localeCompare(b.source_product_id))
}
