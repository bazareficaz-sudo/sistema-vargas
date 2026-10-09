import { NextResponse } from 'next/server'
import { canalTiktokDaSessao } from '@/lib/tiktok/canalDaSessao'
import { criarContextoLote, prepararRascunho } from '@/lib/anuncios/loteTiktok'

// Prepara os rascunhos da publicação em lote na TikTok — nada é publicado
// aqui. Poucos por chamada: cada produto consulta categoria e atributos na
// TikTok, e a tela chama de novo para os próximos.
export const maxDuration = 60
const POR_CHAMADA = 3

export async function POST(req: Request) {
  const { canalId, produtoIds, categorias } = await req.json().catch(() => ({})) as {
    canalId?: string; produtoIds?: string[]; categorias?: Record<string, string>
  }
  const ids = Array.isArray(produtoIds) ? produtoIds.filter(x => typeof x === 'string').slice(0, POR_CHAMADA) : []
  if (ids.length === 0) return NextResponse.json({ ok: false, erro: 'Nenhum produto' }, { status: 400 })
  const g = await canalTiktokDaSessao(canalId)
  if (!g.ok) return NextResponse.json({ ok: false, erro: g.erro }, { status: g.status })

  const ctx = await criarContextoLote(g.sb, g.empresaId, g.canal)
  const rascunhos = []
  const erros: { produtoId: string; erro: string }[] = []
  for (const id of ids) {
    try { rascunhos.push(await prepararRascunho(ctx, id, categorias?.[id] ?? null)) }
    catch (e: any) { erros.push({ produtoId: id, erro: e?.message ?? 'falha ao preparar' }) }
  }
  return NextResponse.json({ ok: true, rascunhos, erros })
}
