import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { STATUS_VALIDOS } from '@/lib/faltas/status'

export const dynamic = 'force-dynamic'

// Mudar o status de uma ou várias solicitações do balcão.
//
// Isto não é só uma etiqueta na tela: o PDV do balcão relê estas linhas a
// cada sincronização. Marcar `recebido` aqui é o que faz o vendedor saber
// que a encomenda chegou e poder ligar para o cliente. É a única volta que
// existe entre quem compra e quem atende.

type Corpo = { ids?: string[]; status?: string; observacao?: string }

export async function POST(req: Request) {
  const { ids, status } = await req.json() as Corpo

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id, 'empresa_id, nome')
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma solicitação selecionada.' }, { status: 400 })
  }
  if (!status || !STATUS_VALIDOS.includes(status)) {
    return NextResponse.json({ ok: false, erro: `Status inválido: ${status}` }, { status: 400 })
  }

  const patch: Record<string, string | null> = { status }

  // Fechou o ciclo: guarda quando e por quem. Sem isso não dá para responder
  // "quanto tempo o cliente esperou", que é a única medida honesta de se o
  // atendimento a encomendas está funcionando.
  if (status === 'atendido' || status === 'cancelado') {
    patch.resolvido_em = new Date().toISOString()
    patch.resolvido_por = perfil?.nome ?? null
  }

  // `empresa_id` no filtro não é redundância: a tabela ainda está sem RLS
  // (o PDV externo fala pela chave anônima), então o recorte por empresa
  // tem de vir daqui.
  const { data, error } = await sb.from('faltas')
    .update(patch)
    .eq('empresa_id', empresaId)
    .in('id', ids)
    .select('id')

  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true, alteradas: data?.length ?? 0 })
}
