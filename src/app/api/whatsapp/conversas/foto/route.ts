import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { zapiFotoPerfil } from '@/lib/zapi'
import { configZapi } from '@/lib/whatsapp/nomes'
import { numeroOculto } from '@/lib/whatsapp/contatos'
import { copiarSeSemFoto } from '@/lib/clientes/foto'

// Foto do perfil do contato, pedida à Z-API ao abrir a conversa quando falta
// ou está velha (o link do WhatsApp vence). Sem foto (privacidade), grava a
// data mesmo assim — não pergunta de novo a cada abertura.
// Cliente cadastrado ainda sem foto: a foto do perfil vai para o cadastro.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const profile = await perfilDaSessao(supabase, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { contatoId } = await request.json().catch(() => ({})) as { contatoId?: string }
  if (!contatoId || !UUID.test(contatoId)) return NextResponse.json({ error: 'Conversa inválida' }, { status: 400 })

  const [{ data: contato }, { data: cfg }] = await Promise.all([
    supabase.from('whatsapp_contatos').select('id, telefone, lid, cliente_id').eq('empresa_id', empresaId).eq('id', contatoId).maybeSingle(),
    supabase.from('whatsapp_config').select('instance_id, token, client_token, url_base, ativo').eq('empresa_id', empresaId).maybeSingle(),
  ])
  if (!contato) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
  const config = cfg?.ativo ? configZapi(cfg) : null
  if (!config) return NextResponse.json({ ok: true, foto_url: null })

  const alvo = numeroOculto(contato.telefone) ? `${contato.lid ?? contato.telefone}@lid` : contato.telefone
  const r = await zapiFotoPerfil(config, alvo)
  if (!r.ok) return NextResponse.json({ ok: true, foto_url: null })
  await supabase.from('whatsapp_contatos')
    .update({ foto_url: r.link, foto_em: new Date().toISOString() })
    .eq('empresa_id', empresaId).eq('id', contato.id)
  if (contato.cliente_id) await copiarSeSemFoto(supabase, empresaId, contato.cliente_id, r.link).catch(() => undefined)
  return NextResponse.json({ ok: true, foto_url: r.link })
}
