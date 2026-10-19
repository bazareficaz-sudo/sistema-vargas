import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { destinoDaJuncao } from '@/lib/whatsapp/contatos'

// Juntar duas conversas da mesma pessoa (uma com o número, outra só com o
// código que o WhatsApp usa quando esconde o número). O histórico vai todo
// para a conversa com o número. Duas conversas com número não se juntam:
// são dois telefones.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const profile = await perfilDaSessao(supabase, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { a, b } = await request.json().catch(() => ({})) as { a?: string; b?: string }
  if (!a || !b || !UUID.test(a) || !UUID.test(b) || a === b) return NextResponse.json({ error: 'Escolha outra conversa' }, { status: 400 })

  const { data: dois } = await supabase.from('whatsapp_contatos').select('id, telefone').eq('empresa_id', empresaId).in('id', [a, b])
  const ca = dois?.find(c => c.id === a), cb = dois?.find(c => c.id === b)
  if (!ca || !cb) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
  const destino = destinoDaJuncao(ca, cb)
  if (!destino) return NextResponse.json({ error: 'As duas conversas têm número de telefone — são dois números diferentes, não dá para juntar.' }, { status: 400 })

  const { error } = await supabase.rpc('whatsapp_juntar_contatos', { p_de: destino.de, p_para: destino.para })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, para: destino.para })
}
