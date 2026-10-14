import { NextResponse } from 'next/server'
import { guardaGetulio } from '@/lib/getulio/acesso'
import { zapiListarGrupos } from '@/lib/zapi'

// Grupos do WhatsApp da empresa, para escolher o dos vendedores sem digitar ID.
export async function GET() {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const { data: w } = await sb.from('whatsapp_config')
    .select('instance_id, token, client_token, url_base, ativo').eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!w?.ativo || !w.instance_id || !w.token) {
    return NextResponse.json({ ok: false, erro: 'WhatsApp não configurado nesta empresa' }, { status: 400 })
  }
  const r = await zapiListarGrupos({ instanceId: w.instance_id, token: w.token, clientToken: w.client_token, urlBase: w.url_base })
  if (r.error && r.grupos.length === 0) return NextResponse.json({ ok: false, erro: r.error }, { status: 502 })
  return NextResponse.json({ ok: true, grupos: r.grupos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) })
}
