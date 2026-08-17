import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { gerarSinaisIA } from '@/lib/reposicao/ia'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Gerar os sinais de IA agora, a pedido do comprador — mesmo padrão do
// botão "Recalcular agora" do motor determinístico (fatia 2).

export async function POST() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  try {
    const resumo = await gerarSinaisIA(createAdminClient(), empresaId)
    return NextResponse.json({ ok: true, ...resumo })
  } catch (err) {
    return NextResponse.json(
      { ok: false, erro: err instanceof Error ? err.message : 'Falha ao gerar os sinais.' },
      { status: 500 },
    )
  }
}
