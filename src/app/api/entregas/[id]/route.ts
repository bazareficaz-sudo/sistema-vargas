import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// ENTREGAS — baixa e reagendamento (tela /dashboard/entregas).
//
//   entregue   grava quando e quem confirmou; sai da lista de pendentes.
//   desfazer   volta a pendente (clique errado).
//   reagendar  muda data/período; data vazia = "sem data".
//
// Quem confirmou vem da sessão, nunca do corpo. A empresa também.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATA = /^\d{4}-\d{2}-\d{2}$/
const PERIODOS = ['qualquer', 'manha', 'tarde', 'noite']

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ ok: false, erro: 'Venda inválida.' }, { status: 400 })
  const corpo = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const perfil = await perfilDaSessao(sb, guarda.userId, 'empresa_id, nome')
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 403 })

  let patch: Record<string, unknown>
  switch (corpo?.acao) {
    case 'entregue':
      patch = {
        entrega_realizada_em: new Date().toISOString(),
        entrega_realizada_por: guarda.userId,
        entrega_realizada_por_nome: (perfil as { nome?: string | null }).nome ?? null,
      }
      break
    case 'desfazer':
      patch = { entrega_realizada_em: null, entrega_realizada_por: null, entrega_realizada_por_nome: null }
      break
    case 'reagendar': {
      const data = corpo?.data ? String(corpo.data) : null
      if (data && !DATA.test(data)) return NextResponse.json({ ok: false, erro: 'Data inválida.' }, { status: 400 })
      const periodo = PERIODOS.includes(corpo?.periodo) ? corpo.periodo : 'qualquer'
      patch = { entrega_agendada_para: data, entrega_periodo: data ? periodo : null }
      break
    }
    default:
      return NextResponse.json({ ok: false, erro: 'Ação inválida.' }, { status: 400 })
  }

  const { data, error } = await sb.from('vendas').update(patch)
    .eq('id', id).eq('empresa_id', empresaId).eq('entrega_solicitada', true)
    .select('id, entrega_agendada_para, entrega_periodo, entrega_realizada_em, entrega_realizada_por_nome')
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, erro: 'Entrega não encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true, venda: data })
}
