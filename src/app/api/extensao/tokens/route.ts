import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { gerarToken, VALIDADE_DIAS } from '@/lib/extensao/token'

export const dynamic = 'force-dynamic'

// Gerência dos tokens da extensão. Sempre com sessão de navegador — nunca
// com o próprio token da extensão, senão um token comprometido conseguiria
// gerar outros.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data, error } = await sb.from('extensao_tokens')
    .select('id, nome_dispositivo, token_prefixo, expira_em, ultimo_uso_em, total_capturas, revogado_em, created_at')
    .eq('user_id', guarda.userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tokens: data ?? [] })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({}))
  const nome = String(body?.nomeDispositivo ?? '').trim().slice(0, 60)
  if (!nome) return NextResponse.json({ ok: false, erro: 'Dê um nome ao dispositivo (ex: "Notebook da loja").' }, { status: 400 })

  const { token, hash, prefixo } = gerarToken()
  const expiraEm = new Date(Date.now() + VALIDADE_DIAS * 24 * 60 * 60 * 1000).toISOString()

  // Insere com a chave de serviço: a política da tabela permite o próprio
  // usuário, mas o hash nunca deve transitar pelo cliente.
  const { error } = await createAdminClient().from('extensao_tokens').insert({
    empresa_id: guarda.empresaId,
    user_id: guarda.userId,
    nome_dispositivo: nome,
    token_hash: hash,
    token_prefixo: prefixo,
    expira_em: expiraEm,
  })

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  // O token em claro sai daqui UMA vez. Não há como recuperá-lo depois —
  // o banco só tem o hash.
  return NextResponse.json({ ok: true, token, expiraEm, validadeDias: VALIDADE_DIAS })
}

export async function DELETE(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, erro: 'id ausente' }, { status: 400 })

  // O filtro por user_id é a garantia real: sem ele, um id adivinhado
  // revogaria o token de outra pessoa.
  const { error } = await sb.from('extensao_tokens')
    .update({ revogado_em: new Date().toISOString() })
    .eq('id', id).eq('user_id', guarda.userId)

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
