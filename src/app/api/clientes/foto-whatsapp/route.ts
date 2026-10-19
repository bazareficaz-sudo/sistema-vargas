import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { zapiFotoPerfil } from '@/lib/zapi'
import { configZapi } from '@/lib/whatsapp/nomes'
import { numeroOculto } from '@/lib/whatsapp/contatos'
import { copiarFotoDoWhatsapp } from '@/lib/clientes/foto'

// "Usar foto do WhatsApp" no cadastro: pega a foto do perfil da conversa do
// cliente (pede de novo à Z-API se o link estiver velho) e copia para o
// cadastro. Sem foto (privacidade do WhatsApp), avisa.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALIDADE_LINK_MS = 2 * 86_400_000

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const profile = await perfilDaSessao(supabase, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { clienteId, substituir } = await request.json().catch(() => ({})) as { clienteId?: string; substituir?: boolean }
  if (!clienteId || !UUID.test(clienteId)) return NextResponse.json({ error: 'Cliente inválido' }, { status: 400 })

  const [{ data: contato }, { data: cfg }] = await Promise.all([
    supabase.from('whatsapp_contatos').select('id, telefone, lid, foto_url, foto_em')
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId)
      .order('ultima_entrada_em', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    supabase.from('whatsapp_config').select('instance_id, token, client_token, url_base, ativo').eq('empresa_id', empresaId).maybeSingle(),
  ])
  if (!contato) return NextResponse.json({ ok: false, motivo: 'Este cliente ainda não tem conversa no WhatsApp.' })

  let link: string | null = contato.foto_url && contato.foto_em && Date.now() - new Date(contato.foto_em).getTime() < VALIDADE_LINK_MS ? contato.foto_url : null
  const config = cfg?.ativo ? configZapi(cfg) : null
  if (!link && config) {
    const alvo = numeroOculto(contato.telefone) ? `${contato.lid ?? contato.telefone}@lid` : contato.telefone
    const r = await zapiFotoPerfil(config, alvo)
    if (r.ok) {
      link = r.link
      await supabase.from('whatsapp_contatos').update({ foto_url: r.link, foto_em: new Date().toISOString() }).eq('empresa_id', empresaId).eq('id', contato.id)
    }
  }
  if (!link) return NextResponse.json({ ok: false, motivo: 'O cliente não tem foto no WhatsApp (ou só mostra para os contatos dele).' })

  const r = await copiarFotoDoWhatsapp(supabase, empresaId, clienteId, link, Boolean(substituir))
  return NextResponse.json(r)
}
