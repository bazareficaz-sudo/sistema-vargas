import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { recalcularEmpresa } from '@/lib/reposicao/recalcular'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Recalcular agora, a pedido do comprador.
//
// O cálculo normal é noturno. Este botão existe para o momento em que
// alguém acabou de dar entrada numa nota grande ou de corrigir o estoque e
// quer ver a lista atualizada sem esperar a madrugada.
//
// A empresa vem da sessão, nunca do corpo da requisição — senão qualquer
// usuário logado poderia mandar recalcular (e ler) outra empresa.

export async function POST() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  try {
    // Cliente admin: o cálculo cruza tabelas que o usuário não
    // necessariamente enxerga direto, e o recorte por empresa já é feito
    // com o id resolvido acima.
    const resumo = await recalcularEmpresa(createAdminClient(), empresaId)
    return NextResponse.json({ ok: true, ...resumo })
  } catch (err) {
    return NextResponse.json(
      { ok: false, erro: err instanceof Error ? err.message : 'Falha ao recalcular' },
      { status: 500 },
    )
  }
}
