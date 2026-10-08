import { NextResponse } from 'next/server'
import { guardaGetulio } from '@/lib/getulio/acesso'

// "Não me avise disto": o sinal sai do resumo até ser resolvido e voltar,
// ou até piorar. "Voltar a avisar" desfaz.
export async function POST(req: Request) {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const { id, acao } = await req.json().catch(() => ({}))
  if (!id || !['dispensar', 'reativar'].includes(acao)) {
    return NextResponse.json({ ok: false, erro: 'Pedido inválido' }, { status: 400 })
  }
  const { error } = await sb.from('getulio_sinais')
    .update(acao === 'dispensar' ? { dispensado_em: new Date().toISOString() } : { dispensado_em: null, avisado_em: null })
    .eq('id', id).eq('empresa_id', guarda.empresaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
