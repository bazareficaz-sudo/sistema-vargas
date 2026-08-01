import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { ETAPA_INFO, transicaoPermitida, type Etapa } from '@/lib/pedidos/etapas'

// Muda a etapa de um pedido e registra o evento.
//
// As duas coisas andam juntas de propósito: etapa que muda sem deixar rastro
// é exatamente o que impede responder "quem despachou este pedido?" depois.

const TABELA = { venda: 'vendas', marketplace: 'marketplace_pedidos' } as const

export async function POST(req: Request) {
  const { fonte, id, etapa, observacao } = await req.json() as {
    fonte: 'venda' | 'marketplace'; id: string; etapa: Etapa; observacao?: string
  }
  if (!TABELA[fonte] || !id || !ETAPA_INFO[etapa]) {
    return NextResponse.json({ ok: false, erro: 'Pedido ou etapa inválidos' }, { status: 400 })
  }

  const sb = await createClient()
  // Mexer na etapa é operação de expedição, não de cadastro — quem vende e
  // quem separa precisam poder fazer isso.
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const tabela = TABELA[fonte]
  const { data: pedido } = await sb.from(tabela)
    .select('id, etapa_operacional').eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!pedido) return NextResponse.json({ ok: false, erro: 'Pedido não encontrado' }, { status: 404 })

  const atual = (pedido.etapa_operacional ?? 'novo') as Etapa
  const permite = transicaoPermitida(atual, etapa)
  if (!permite.ok) return NextResponse.json({ ok: false, erro: permite.motivo }, { status: 400 })

  const agora = new Date().toISOString()
  const { error } = await sb.from(tabela)
    .update({ etapa_operacional: etapa, etapa_operacional_em: agora }).eq('id', id).eq('empresa_id', guarda.empresaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  const { data: perfil } = await sb.from('profiles').select('nome').eq('id', guarda.userId).maybeSingle()

  await sb.from('pedido_eventos').insert({
    empresa_id: guarda.empresaId,
    fonte, referencia_id: id,
    tipo: 'etapa',
    etapa_anterior: atual, etapa_nova: etapa,
    descricao: `${ETAPA_INFO[atual]?.label ?? atual} → ${ETAPA_INFO[etapa].label}`,
    observacao: observacao?.trim() || null,
    usuario_id: guarda.userId, usuario_nome: perfil?.nome ?? null,
    automatico: false,
  })

  return NextResponse.json({ ok: true, etapa, etapaEm: agora })
}

// Linha do tempo do pedido.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const fonte = url.searchParams.get('fonte') as 'venda' | 'marketplace'
  const id = url.searchParams.get('id')
  if (!TABELA[fonte] || !id) {
    return NextResponse.json({ ok: false, erro: 'Pedido não informado' }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data } = await sb.from('pedido_eventos')
    .select('*').eq('empresa_id', guarda.empresaId).eq('fonte', fonte).eq('referencia_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ ok: true, eventos: data ?? [] })
}
