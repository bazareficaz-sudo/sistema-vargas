import { NextRequest, NextResponse } from 'next/server'
import { contextoDaConversa, orcamentoDaConversa } from '@/lib/whatsapp/contextoConversa'

// Ações no orçamento a partir da conversa:
//   fechou    → aprovado; a tela abre o PDV com ele (a venda o converte e o
//               banco move a conversa para "Comprou")
//   desistiu  → cancelado; conversa vai para "Perdido"
// Reenviar e condições de pagamento ficam na tela de Orçamentos (negociação).
// Só orçamento desta conversa (do cliente dela ou enviado para ela).

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({})) as { contatoId?: string; orcamentoId?: string; acao?: string }
  const c = await contextoDaConversa(corpo.contatoId, { enviar: false })
  if (!c.ok) return NextResponse.json({ error: c.erro }, { status: c.status })
  const { supabase, empresaId, contato } = c.ctx

  const orc = await orcamentoDaConversa(c.ctx, corpo.orcamentoId)
  if (!orc) return NextResponse.json({ error: 'Orçamento não encontrado nesta conversa.' }, { status: 404 })
  const aberto = (orc.status === 'aberto' || orc.status === 'aprovado') && !orc.venda_id
  if (!aberto) return NextResponse.json({ error: `O orçamento nº ${orc.numero} está ${orc.status}.` }, { status: 409 })
  const agora = new Date().toISOString()

  if (corpo.acao === 'fechou') {
    if (orc.status === 'aberto') {
      const { error } = await supabase.from('orcamentos').update({ status: 'aprovado', updated_at: agora })
        .eq('id', orc.id).eq('empresa_id', empresaId).eq('status', 'aberto')
      if (error) return NextResponse.json({ error: 'Não foi possível aprovar o orçamento.' }, { status: 500 })
    }
    return NextResponse.json({ pdv: `/pdv?orcamento=${orc.id}` })
  }

  if (corpo.acao === 'desistiu') {
    const { error } = await supabase.from('orcamentos').update({ status: 'cancelado', updated_at: agora })
      .eq('id', orc.id).eq('empresa_id', empresaId).in('status', ['aberto', 'aprovado'])
    if (error) return NextResponse.json({ error: 'Não foi possível cancelar o orçamento.' }, { status: 500 })
    await supabase.from('whatsapp_contatos').update({ etapa: 'perdido' }).eq('id', contato.id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
}
