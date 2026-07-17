import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFiscalProvider } from '@/lib/fiscal/factory'
import { FiscalProviderError } from '@/lib/fiscal/types'

const JANELA_CANCELAMENTO_MIN = 30

export async function POST(req: Request) {
  const { vendaId, justificativa } = await req.json()
  if (!vendaId) return NextResponse.json({ ok: false, erro: 'vendaId ausente' }, { status: 400 })
  if (!justificativa || justificativa.trim().length < 15) {
    return NextResponse.json({ ok: false, erro: 'Justificativa precisa ter pelo menos 15 caracteres' }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: venda } = await sb.from('vendas').select('id, nfce_status, nfce_chave, created_at').eq('id', vendaId).eq('empresa_id', empresaId).single()
  if (!venda) return NextResponse.json({ ok: false, erro: 'Venda não encontrada' }, { status: 404 })
  if (venda.nfce_status !== 'autorizada') {
    return NextResponse.json({ ok: false, erro: 'Esta venda não tem uma NFC-e autorizada para cancelar' }, { status: 400 })
  }

  const minutosDesdeEmissao = (Date.now() - new Date(venda.created_at).getTime()) / 60000
  if (minutosDesdeEmissao > JANELA_CANCELAMENTO_MIN) {
    return NextResponse.json({
      ok: false,
      erro: `Fora da janela de cancelamento (${JANELA_CANCELAMENTO_MIN} minutos após a emissão). Procure a contabilidade para tratar via outro mecanismo fiscal.`,
    }, { status: 400 })
  }

  try {
    const provider = await getFiscalProvider(sb, empresaId)
    const resultado = await provider.emissao.cancelarNFCe(vendaId, justificativa.trim())

    if (!resultado.ok) {
      return NextResponse.json({ ok: false, erro: resultado.erro ?? 'Erro ao cancelar NFC-e' }, { status: 400 })
    }

    await sb.from('vendas').update({ nfce_status: 'cancelada', updated_at: new Date().toISOString() }).eq('id', vendaId)

    try {
      await sb.from('nfe_logs').insert({
        empresa_id: empresaId,
        acao: 'cancelar_nfce',
        descricao: `Venda ${vendaId} — cancelada: ${justificativa.trim()}`,
        dados: { vendaId, chave: venda.nfce_chave },
        operador: user.email ?? null,
      })
    } catch {}

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    const erro = e instanceof FiscalProviderError ? e.message : (e?.message ?? 'Erro ao cancelar NFC-e')
    return NextResponse.json({ ok: false, erro }, { status: 400 })
  }
}
