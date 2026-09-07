import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashDoSegredo, segredoBemFormado, assinarToken, TOKEN_VALIDADE_SEGUNDOS } from '@/lib/pdv/terminalToken'
import { decidirToken } from '@/lib/pdv/decidirAtivacao'
import { segredoDeAssinatura } from '@/lib/pdv/segredo'

// RENOVAÇÃO DO TOKEN DO TERMINAL.
//
// O terminal apresenta o segredo que guardou na ativação; o servidor calcula
// o hash, confere contra o que está gravado e emite um token curto. O segredo
// em claro não é guardado em lugar nenhum — nem aqui, nem no banco.
//
// A EMPRESA NÃO É PEDIDA NEM ACEITA. Ela é lida da linha do terminal. Um
// corpo com `empresa_id` é simplesmente ignorado — `decidirToken` sequer tem
// onde recebê-lo.

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const terminalId = String(body?.terminal_id ?? '')
  const secret = String(body?.secret ?? '')
  const versao = body?.versao_pdv ? String(body.versao_pdv).slice(0, 40) : null

  if (!terminalId || !segredoBemFormado(secret)) {
    return NextResponse.json({ ok: false, erro: 'Credencial inválida.' }, { status: 401 })
  }

  const secretHash = hashDoSegredo(secret)

  const sb = createAdminClient()

  const { data: terminal } = await sb
    .from('pdv_terminais')
    .select('id, empresa_id, status, secret_hash, nome')
    .eq('id', terminalId)
    .maybeSingle()

  const { data: empresa } = terminal
    ? await sb.from('empresas').select('id, nome, tenant_id, ativo').eq('id', terminal.empresa_id).maybeSingle()
    : { data: null }

  const decisao = decidirToken({
    terminal, secretHashApresentado: secretHash,
    empresaAtiva: empresa?.ativo !== false,
  })

  if (decisao.acao === 'recusar') {
    // Registrar a falha sem gravar credencial nenhuma: só o que aconteceu,
    // em qual terminal e quando. Silenciar isto tiraria a única chance de
    // perceber uma credencial sendo testada.
    if (terminal) {
      await sb.from('pdv_terminais')
        .update({ ultima_atividade_em: new Date().toISOString() })
        .eq('id', terminal.id)
    }
    return NextResponse.json({ ok: false, erro: decisao.erro }, { status: decisao.status })
  }

  const agora = new Date().toISOString()
  await sb.from('pdv_terminais').update({
    ultima_autenticacao_em: agora,
    ultima_atividade_em: agora,
    metodo_ultima_auth: 'terminal_token',
    ...(versao ? { versao_pdv: versao } : {}),
    updated_at: agora,
  }).eq('id', terminal!.id)

  const token = assinarToken({
    sub: terminal!.id,
    terminal_id: terminal!.id,
    empresa_id: terminal!.empresa_id,     // ← do banco, não do corpo
    tenant_id: empresa?.tenant_id ?? null,
    tipo: 'pdv_terminal',
  }, segredoDeAssinatura())

  return NextResponse.json({
    ok: true,
    token,
    expira_em_segundos: TOKEN_VALIDADE_SEGUNDOS,
    terminal: { id: terminal!.id, nome: terminal!.nome },
    empresa: { id: terminal!.empresa_id, nome: empresa?.nome ?? null },
  })
}
