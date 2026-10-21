import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { lojasDeAtendimento } from '@/lib/shopee/atendimento'
import { prepararGtin } from '@/lib/shopee/gtin'
import type { AnuncioGtin } from '@/lib/shopee/gtinRegras'

// Varre os anúncios ativos das lojas Shopee atrás de GTIN que falta. Só
// leitura; leva até ~1 min (anúncio com variação é lido variação por variação).
export const maxDuration = 300

export async function POST() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const anuncios: AnuncioGtin[] = []
  const erros: string[] = []
  const lojas = await lojasDeAtendimento(sb, guarda.empresaId)
  for (const loja of lojas) {
    try { anuncios.push(...await prepararGtin(sb, loja)) }
    catch (e: unknown) { erros.push(`${loja.nome}: ${e instanceof Error ? e.message : 'erro'}`) }
  }
  return NextResponse.json({ ok: true, lojas: lojas.map(l => l.nome), anuncios, erros })
}
