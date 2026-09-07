import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

// REVOGAR UM TERMINAL.
//
// Não apaga: muda o status. O histórico é o que responde "quem autorizou
// aquele terminal, quando, e por que ele saiu" — e é justamente isso que se
// quer saber depois de um computador sumir.
//
// A JANELA DE EXPOSIÇÃO é o tempo restante do token que o terminal já tem —
// 12 horas no máximo. Não há lista de revogação de JWT, e não deve haver:
// manter blocklist de token é maquinário que precisa ser consultado a cada
// requisição e que envelhece mal. Token curto resolve melhor. Se 12 horas
// for demais para o seu risco, o número está em `terminalToken.ts`.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { motivo } = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_terminais_pdv')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  if (!String(motivo ?? '').trim()) {
    return NextResponse.json({ ok: false, erro: 'Informe o motivo — ele fica registrado.' }, { status: 400 })
  }

  // Escopo pela empresa da sessão: revogar terminal de outra empresa não é
  // possível nem por engano.
  const { data: terminal } = await sb
    .from('pdv_terminais').select('id, nome, status')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()

  if (!terminal) return NextResponse.json({ ok: false, erro: 'Terminal não encontrado.' }, { status: 404 })
  if (terminal.status === 'revogado') {
    return NextResponse.json({ ok: false, erro: 'Este terminal já está revogado.' }, { status: 400 })
  }

  const agora = new Date().toISOString()
  const { error } = await sb.from('pdv_terminais').update({
    status: 'revogado',
    // O segredo é descartado junto. Reativar exige credencial nova, e não
    // basta alguém voltar o status no banco.
    secret_hash: null,
    revogado_em: agora,
    revogado_por: guarda.userId,
    motivo_revogacao: String(motivo).trim().slice(0, 300),
    updated_at: agora,
  }).eq('id', id)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'pdv_terminal_revogado', tabela: 'pdv_terminais', campo: 'status',
    valorAnterior: { status: terminal.status },
    valorNovo: { status: 'revogado', nome: terminal.nome, motivo: String(motivo).trim() },
  })

  return NextResponse.json({ ok: true })
}
