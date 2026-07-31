import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { varrerRecalculo } from '@/lib/precificacao/recalculo'

// Prévia do recálculo: calcula tudo e não aplica nada.
//
// Existe justamente pra responder "esta alteração impactará quantos
// anúncios?" ANTES de mexer em preço de produção.

export const maxDuration = 300

export async function POST(req: Request) {
  const { canaisIds, apenasAtivos } = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { resumo, itens, truncado } = await varrerRecalculo(sb, guarda.empresaId, {
    canaisIds, apenasAtivos: apenasAtivos !== false,
  })

  return NextResponse.json({ ok: true, resumo, itens, truncado })
}
