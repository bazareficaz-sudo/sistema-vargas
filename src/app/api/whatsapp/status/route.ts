import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { zapiStatus, zapiQrCode, zapiDisconnect, zapiRestart, zapiSendText } from '@/lib/zapi'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  // Aceita config inline via query params (para testar sem salvar)
  const sp = request.nextUrl.searchParams
  const inlineInstance = sp.get('instance_id')
  const inlineToken    = sp.get('token')

  let zapiCfg: { instanceId: string; token: string; clientToken?: string | null; urlBase?: string | null }

  if (inlineInstance && inlineToken) {
    zapiCfg = {
      instanceId: inlineInstance,
      token: inlineToken,
      clientToken: sp.get('client_token') || null,
      urlBase: sp.get('url_base') || 'https://api.z-api.io',
    }
  } else {
    const { data: cfg } = await supabase
      .from('whatsapp_config')
      .select('instance_id, token, client_token, url_base')
      .eq('empresa_id', empresaId)
      .single()

    if (!cfg?.instance_id || !cfg?.token)
      return NextResponse.json({ error: 'Instância não configurada' }, { status: 400 })

    zapiCfg = {
      instanceId: cfg.instance_id,
      token: cfg.token,
      clientToken: cfg.client_token,
      urlBase: cfg.url_base,
    }
  }

  const action = sp.get('action') ?? 'status'

  if (action === 'qrcode') {
    const qr = await zapiQrCode(zapiCfg)
    return NextResponse.json(qr)
  }

  if (action === 'disconnect') {
    const r = await zapiDisconnect(zapiCfg)
    if (r.success) {
      await supabase.from('whatsapp_config').update({
        status_conexao: 'desconectado', ultima_sincronizacao: new Date().toISOString(),
      }).eq('empresa_id', empresaId)
    }
    return NextResponse.json(r)
  }

  if (action === 'restart') {
    const r = await zapiRestart(zapiCfg)
    return NextResponse.json(r)
  }

  const status = await zapiStatus(zapiCfg)
  const novoStatus = status.connected ? 'conectado' : 'desconectado'

  await supabase.from('whatsapp_config').update({
    status_conexao: novoStatus,
    ultima_sincronizacao: new Date().toISOString(),
  }).eq('empresa_id', empresaId)

  return NextResponse.json(status)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id

  const { data: cfg } = await supabase
    .from('whatsapp_config')
    .select('instance_id, token, client_token, url_base, numero_whatsapp')
    .eq('empresa_id', empresaId)
    .single()

  if (!cfg?.instance_id || !cfg?.token)
    return NextResponse.json({ error: 'Instância não configurada' }, { status: 400 })

  const { telefone, mensagem } = await request.json()
  const destino = telefone || cfg.numero_whatsapp
  if (!destino) return NextResponse.json({ error: 'Telefone destino não informado' }, { status: 400 })

  const zapiCfg = {
    instanceId: cfg.instance_id,
    token: cfg.token,
    clientToken: cfg.client_token,
    urlBase: cfg.url_base,
  }

  const result = await zapiSendText(zapiCfg, destino, mensagem ?? '✅ Teste de conexão do sistema Vargas — WhatsApp funcionando!')
  return NextResponse.json(result)
}
