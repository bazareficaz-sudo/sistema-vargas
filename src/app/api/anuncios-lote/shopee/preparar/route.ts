import { NextResponse } from 'next/server'
import { canalShopeeDaSessao } from '@/lib/anuncios/canalShopeeDaSessao'
import { criarContextoLoteShopee, prepararRascunhoShopee } from '@/lib/anuncios/loteShopee'

// Prepara os rascunhos da publicação em lote na Shopee — nada é publicado
// aqui. Poucos por chamada; a tela chama de novo para os próximos.
export const maxDuration = 60
const POR_CHAMADA = 3

export async function POST(req: Request) {
  const { canalId, produtoIds, categorias } = await req.json().catch(() => ({})) as {
    canalId?: string; produtoIds?: string[]; categorias?: Record<string, { id: string; caminho: string; ids?: string[] }>
  }
  const ids = Array.isArray(produtoIds) ? produtoIds.filter(x => typeof x === 'string').slice(0, POR_CHAMADA) : []
  if (ids.length === 0) return NextResponse.json({ ok: false, erro: 'Nenhum produto' }, { status: 400 })
  const g = await canalShopeeDaSessao(canalId)
  if (!g.ok) return NextResponse.json({ ok: false, erro: g.erro }, { status: g.status })

  const ctx = await criarContextoLoteShopee(g.sb, g.empresaId, g.canalRow)
  const rascunhos = []
  const erros: { produtoId: string; erro: string }[] = []
  for (const id of ids) {
    try { rascunhos.push(await prepararRascunhoShopee(ctx, id, categorias?.[id] ?? null)) }
    catch (e: any) { erros.push({ produtoId: id, erro: e?.message ?? 'falha ao preparar' }) }
  }
  return NextResponse.json({ ok: true, rascunhos, erros })
}
