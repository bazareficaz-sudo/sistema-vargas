import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// CONVERSÃO DE ORÇAMENTO EM VENDA — PDV WEB.
//
// Mesma arbitragem do PDV desktop (/api/pdv/orcamentos/converter), mas com a
// sessão do painel no lugar do token de terminal. A RPC
// `converter_orcamento_pdv` faz compare-and-set em `orcamentos.venda_id`:
// um orçamento vira no máximo UMA venda, o retry da mesma venda é aceito
// (`ja_convertido`) e a segunda venda recebe `conflito_conversao`.
//
// A ORDEM IMPORTA: isto roda ANTES de gravar a venda. O trigger
// `exigir_arbitragem_do_orcamento` recusa a venda com `orcamento_id` cujo
// orçamento ainda não aponta para ela.
//
// A RPC só é executável por service_role (authenticated não pode gravar
// `venda_id` — ver 20260911140000). A empresa vem da sessão, nunca do corpo.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const HTTP_POR_ESTADO: Record<string, number> = {
  convertido: 200,
  ja_convertido: 200,
  conflito_conversao: 409,
  conflito_versao: 409,
  recusado_cancelado: 409,
  nao_encontrado: 404,
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: orcamentoId } = await params
  const corpo = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const profile = await perfilDaSessao(sb, guarda.userId)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 403 })

  const vendaId = String(corpo?.venda_id ?? '')
  if (!UUID.test(orcamentoId) || !UUID.test(vendaId)) {
    return NextResponse.json({ ok: false, estado: 'nao_encontrado', erro: 'Orçamento ou venda inválidos.' }, { status: 400 })
  }
  const base = corpo?.revisao_base
  const revisaoBase = Number.isInteger(base) && base >= 0 ? base : null

  const { data, error } = await createAdminClient().rpc('converter_orcamento_pdv', {
    p_empresa_id: empresaId,
    p_orcamento_id: orcamentoId,
    p_venda_id: vendaId,
    p_revisao_base: revisaoBase,
  })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const estado = (data as { estado?: string } | null)?.estado ?? ''
  return NextResponse.json(
    { ok: estado === 'convertido' || estado === 'ja_convertido', ...(data as object) },
    { status: HTTP_POR_ESTADO[estado] ?? 500 },
  )
}
