// Proxy para API FocusNFe — Manifesto do Destinatário
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FOCUSNFE_BASE = 'https://api.focusnfe.com.br'

export async function POST(req: NextRequest) {
  try {
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
    const empresaId = profile?.empresa_id
    if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

    const { acao, chave, ultimo_nsu, justificativa } = await req.json()

    const { data: config } = await sb.from('nfe_config').select('*').eq('empresa_id', empresaId).single()
    if (!config?.focusnfe_token) {
      return NextResponse.json({ error: 'Token FocusNFe não configurado. Configure em Configurações > Integrações.' }, { status: 400 })
    }

    const token = config.focusnfe_token
    const auth  = 'Basic ' + Buffer.from(token + ':').toString('base64')
    const headers = { 'Authorization': auth, 'Content-Type': 'application/json' }

    let url = '', method = 'GET', body: string | undefined

    switch (acao) {
      case 'listar':
        url = `${FOCUSNFE_BASE}/v2/distribuicao/dfe?ultimo_nsu=${ultimo_nsu ?? config.ultimo_nsu ?? '0'}`
        break
      case 'ciencia':
        url = `${FOCUSNFE_BASE}/v2/nfe/${chave}/manifesto`
        method = 'POST'
        body = JSON.stringify({ tipo: 'ciencia_operacao' })
        break
      case 'confirmacao':
        url = `${FOCUSNFE_BASE}/v2/nfe/${chave}/manifesto`
        method = 'POST'
        body = JSON.stringify({ tipo: 'confirmacao_operacao' })
        break
      case 'desconhecimento':
        url = `${FOCUSNFE_BASE}/v2/nfe/${chave}/manifesto`
        method = 'POST'
        body = JSON.stringify({ tipo: 'desconhecimento_operacao', justificativa })
        break
      case 'nao_realizada':
        url = `${FOCUSNFE_BASE}/v2/nfe/${chave}/manifesto`
        method = 'POST'
        body = JSON.stringify({ tipo: 'operacao_nao_realizada', justificativa })
        break
      case 'download_xml':
        url = `${FOCUSNFE_BASE}/v2/nfe/${chave}.xml`
        break
      default:
        return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
    }

    const resp = await fetch(url, { method, headers, body })
    const text = await resp.text()

    // Atualizar NSU após listagem
    if (acao === 'listar' && resp.ok) {
      try {
        const json = JSON.parse(text)
        if (json.ultimo_nsu) {
          await sb.from('nfe_config').update({ ultimo_nsu: json.ultimo_nsu, updated_at: new Date().toISOString() }).eq('empresa_id', empresaId)
        }
      } catch {}
    }

    return new NextResponse(text, {
      status: resp.status,
      headers: { 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
