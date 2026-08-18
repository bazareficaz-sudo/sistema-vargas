import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Liga/desliga a propagação de preço/custo/markup entre produtos vinculados
// desta parceria (ver src/lib/produtos/vinculo.ts). Ação de configuração,
// não de operação do dia a dia — por isso não fica junto do fluxo de
// vincular/duplicar, é um toggle separado na tela da parceria.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: parceriaId } = await params
  const body = await req.json().catch(() => ({})) as { sincronizarPreco?: boolean }
  if (typeof body.sincronizarPreco !== 'boolean') {
    return NextResponse.json({ ok: false, erro: 'sincronizarPreco precisa ser true ou false.' }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id, 'empresa_id')
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: parceria } = await sb.from('empresa_parcerias')
    .select('id, empresa_id_a, empresa_id_b, status').eq('id', parceriaId).maybeSingle()
  if (!parceria || parceria.status !== 'ativa') {
    return NextResponse.json({ ok: false, erro: 'Parceria não encontrada ou inativa.' }, { status: 404 })
  }
  if (parceria.empresa_id_a !== empresaId && parceria.empresa_id_b !== empresaId) {
    return NextResponse.json({ ok: false, erro: 'Esta parceria não é da sua empresa.' }, { status: 403 })
  }

  const { error } = await sb.from('empresa_parcerias')
    .update({ sincronizar_preco: body.sincronizarPreco }).eq('id', parceriaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
