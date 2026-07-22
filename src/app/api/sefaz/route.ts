// Proxy para distribuição DFe / manifesto do destinatário — hoje delega
// pro FiscalProvider (Focus NFe é o único funcional). Contrato de
// request/response mantido idêntico ao que existia antes desta camada
// existir, pra não quebrar o único consumidor (EntradasXmlClient.tsx).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFiscalProvider } from '@/lib/fiscal/factory'
import { FiscalProviderError } from '@/lib/fiscal/types'
import type { TipoManifesto } from '@/lib/fiscal/types'

const ACOES_MANIFESTO: Record<string, TipoManifesto> = {
  ciencia: 'ciencia',
  confirmacao: 'confirmacao',
  desconhecimento: 'desconhecimento',
  nao_realizada: 'nao_realizada',
}

export async function POST(req: NextRequest) {
  try {
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
    const empresaId = profile?.empresa_id
    if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

    const { acao, chave, ultimo_nsu, justificativa } = await req.json()

    const provider = await getFiscalProvider(sb, empresaId)

    if (acao === 'listar') {
      const { data: empresa } = await sb.from('empresas').select('cnpj').eq('id', empresaId).single()
      if (!empresa?.cnpj) return NextResponse.json({ error: 'CNPJ da empresa não cadastrado — preencha em Empresas antes de consultar.' }, { status: 400 })

      const resultado = await provider.distribuicao.listarDfe(empresa.cnpj, ultimo_nsu ?? '0')
      if (resultado.ultimaVersao) {
        await sb.from('nfe_config').update({ ultimo_nsu: resultado.ultimaVersao, updated_at: new Date().toISOString() }).eq('empresa_id', empresaId)
      }
      return NextResponse.json({ documentos: resultado.documentos })
    }

    if (acao in ACOES_MANIFESTO) {
      if (!chave) return NextResponse.json({ error: 'chave ausente' }, { status: 400 })
      await provider.distribuicao.manifestar(chave, ACOES_MANIFESTO[acao], justificativa)
      return NextResponse.json({ ok: true })
    }

    if (acao === 'download_xml') {
      if (!chave) return NextResponse.json({ error: 'chave ausente' }, { status: 400 })
      const xml = await provider.distribuicao.baixarXml(chave)
      return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'application/xml' } })
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  } catch (e: any) {
    if (e instanceof FiscalProviderError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
