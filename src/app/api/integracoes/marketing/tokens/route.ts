import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { gerarToken, VALIDADE_DIAS } from '@/lib/integracoes/marketing/token'

export const dynamic = 'force-dynamic'

// Gerência dos tokens do Vargas Marketing. Sempre com sessão de navegador e
// permissão de configurações — nunca com o próprio token da integração.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const { data, error } = await createAdminClient().from('integracao_marketing_tokens')
    .select('id, nome, token_prefixo, expira_em, ultimo_uso_em, total_chamadas, revogado_em, created_at')
    .eq('empresa_id', guarda.empresaId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tokens: data ?? [] })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const body = await req.json().catch(() => ({}))
  const nome = String(body?.nome ?? '').trim().slice(0, 60) || 'Vargas Marketing'
  const { token, hash, prefixo } = gerarToken()
  const expiraEm = new Date(Date.now() + VALIDADE_DIAS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await createAdminClient().from('integracao_marketing_tokens').insert({
    empresa_id: guarda.empresaId, user_id: guarda.userId, nome, token_hash: hash, token_prefixo: prefixo, expira_em: expiraEm,
  })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  // O token em claro sai daqui uma única vez.
  return NextResponse.json({ ok: true, token, expiraEm, validadeDias: VALIDADE_DIAS })
}

export async function DELETE(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, erro: 'Informe o token.' }, { status: 400 })
  const { error } = await createAdminClient().from('integracao_marketing_tokens')
    .update({ revogado_em: new Date().toISOString() })
    .eq('id', id).eq('empresa_id', guarda.empresaId).is('revogado_em', null)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
