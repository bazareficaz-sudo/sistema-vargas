import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { lojasDeAtendimento } from '@/lib/shopee/atendimento'
import { aplicarGtin } from '@/lib/shopee/gtin'

// Manda o GTIN para os anúncios escolhidos. O valor NÃO vem da tela: é
// recalculado aqui (estado atual na Shopee + produto mapeado: EAN do
// cadastro, ou "00" = sem GTIN). Nenhum código digitado ou inventado chega
// à Shopee, e variação que já tem GTIN não é tocada.
export const maxDuration = 120
const POR_CHAMADA = 20

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { canalId, itemIds } = await req.json().catch(() => ({})) as { canalId?: string; itemIds?: string[] }
  const ids = (Array.isArray(itemIds) ? itemIds : []).map(String).filter(i => /^\d{5,20}$/.test(i)).slice(0, POR_CHAMADA)
  if (!canalId || ids.length === 0) return NextResponse.json({ ok: false, erro: 'Nenhum anúncio escolhido.' }, { status: 400 })

  const [loja] = await lojasDeAtendimento(sb, guarda.empresaId, canalId)
  if (!loja) return NextResponse.json({ ok: false, erro: 'Loja Shopee não encontrada ou desconectada.' }, { status: 404 })

  const resultados = await aplicarGtin(sb, loja, ids)
  const certos = resultados.filter(r => r.ok).length
  await sb.from('marketplace_sync_log').insert({
    canal_id: loja.id, tipo: 'gtin_shopee', status: certos === resultados.length ? 'ok' : 'erro',
    mensagem: `GTIN: ${certos} de ${resultados.length} anúncio(s) corrigido(s)`,
    detalhes: { resultados },
  })
  return NextResponse.json({ ok: true, resultados })
}
