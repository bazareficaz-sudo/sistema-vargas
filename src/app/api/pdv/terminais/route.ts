import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'
import {
  gerarCodigoAtivacao, hashDoCodigo, prefixoDoCodigo, CODIGO_VALIDADE_MINUTOS,
} from '@/lib/pdv/terminalToken'

// Administração dos terminais, pelo painel. Ao contrário das rotas de
// ativação e de token, esta atende um usuário autenticado — então usa o
// cliente de sessão e passa por `exigirPermissao`.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_terminais_pdv')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data } = await sb
    .from('pdv_terminais')
    .select('id, nome, status, versao_pdv, terminal_id_legado, metodo_ultima_auth, ativado_em, ultima_autenticacao_em, ultima_atividade_em, revogado_em, motivo_revogacao, created_at')
    .eq('empresa_id', guarda.empresaId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ ok: true, terminais: data ?? [] })
}

/** Autoriza um terminal novo e devolve o código de ativação UMA vez. */
export async function POST(req: Request) {
  const { nome } = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_terminais_pdv')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  if (!String(nome ?? '').trim()) {
    return NextResponse.json({ ok: false, erro: 'Dê um nome ao terminal — é assim que você vai reconhecê-lo depois.' }, { status: 400 })
  }

  const { data: terminal, error } = await sb.from('pdv_terminais').insert({
    empresa_id: guarda.empresaId,
    nome: String(nome).trim().slice(0, 80),
    status: 'aguardando_ativacao',
    created_by: guarda.userId,
  }).select('id, nome').single()
  if (error || !terminal) {
    return NextResponse.json({ ok: false, erro: error?.message ?? 'Falha ao criar o terminal' }, { status: 500 })
  }

  // O código existe em claro só nesta resposta. O banco guarda o hash e o
  // prefixo — se a pessoa fechar a tela sem anotar, gera outro.
  const codigo = gerarCodigoAtivacao()
  const { error: erroCodigo } = await sb.from('pdv_ativacoes').insert({
    empresa_id: guarda.empresaId,
    terminal_id: terminal.id,
    codigo_hash: hashDoCodigo(codigo),
    codigo_prefixo: prefixoDoCodigo(codigo),
    expira_em: new Date(Date.now() + CODIGO_VALIDADE_MINUTOS * 60_000).toISOString(),
    created_by: guarda.userId,
  })
  if (erroCodigo) return NextResponse.json({ ok: false, erro: erroCodigo.message }, { status: 500 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'pdv_terminal_autorizado', tabela: 'pdv_terminais', campo: 'status',
    valorNovo: { terminal_id: terminal.id, nome: terminal.nome, prefixo: prefixoDoCodigo(codigo) },
  })

  return NextResponse.json({
    ok: true,
    terminal,
    codigo,
    expira_em_minutos: CODIGO_VALIDADE_MINUTOS,
  })
}
