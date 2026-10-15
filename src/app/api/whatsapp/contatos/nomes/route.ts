import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { configZapi, preencherNomes } from '@/lib/whatsapp/nomes'

// Botão "Buscar nomes no WhatsApp" da tela de contatos: consulta na Z-API o
// nome de até 40 contatos sem nome por vez. A empresa vem da sessão; a
// escrita do nome é do sistema (logado só muda o status do contato).
export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const profile = await perfilDaSessao(supabase, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const admin = createAdminClient()
  const { data: cfg } = await admin.from('whatsapp_config')
    .select('instance_id, token, client_token, url_base').eq('empresa_id', empresaId).maybeSingle()
  const config = configZapi(cfg)
  if (!config) return NextResponse.json({ error: 'WhatsApp (Z-API) não configurado.' }, { status: 400 })

  const r = await preencherNomes(admin, empresaId, config)
  if (r.consultados > 0 && r.erros === r.consultados) {
    return NextResponse.json({ error: 'A Z-API não respondeu à consulta de contatos. Confira se o WhatsApp está conectado.', ...r }, { status: 502 })
  }
  return NextResponse.json(r)
}
