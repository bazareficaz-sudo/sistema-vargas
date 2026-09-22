import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { contextoCaixa } from '@/lib/caixa/contextoCaixa'
import { montarDemonstrativo, conferirDemonstrativo } from '@/lib/caixa/sessao'

// O estado de uma sessão: quanto deveria haver na gaveta agora, e de onde
// esse número veio.
//
// O ESPERADO É O LEDGER. `saldo_caixa_v1` soma todos os movimentos daquela
// gaveta — fundo, suprimentos, sangrias e, quando a integração vier, vendas
// e recebimentos em dinheiro. Não existe "saldo atual" guardado em coluna.
//
// O demonstrativo é a decomposição por categoria: é o que o operador lê
// antes de contar. Ele e o saldo têm de fechar, e `conferirDemonstrativo`
// devolve essa checagem junto — se uma natureza nova entrar no banco sem
// ser classificada, a tela mostra que a conta não fecha em vez de exibir um
// demonstrativo silenciosamente incompleto.

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sb = await createClient()
  const guarda = await contextoCaixa(sb, 'gerenciar_financeiro')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: sessao } = await sb.from('caixa_sessao')
    .select('*, caixa:caixa_id(id, nome, terminal_id)')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!sessao) return NextResponse.json({ ok: false, erro: 'Sessão não encontrada.' }, { status: 404 })

  // O saldo é calculado no banco, pela mesma função que a RPC de fechamento
  // usa — para a tela nunca mostrar um número diferente do que vai valer.
  const { data: saldo } = await sb.rpc('saldo_caixa_v1', { p_caixa: sessao.caixa_id })
  const saldoAtual = Number(saldo ?? 0)

  const { data: movimentos } = await sb.from('caixa_movimento')
    .select('tipo, natureza, valor, created_at, observacao')
    .eq('sessao_id', id).order('created_at')

  const linhas = movimentos ?? []
  const demonstrativo = montarDemonstrativo(linhas)

  // O saldo que a gaveta tinha quando a sessão começou. Para fundo herdado
  // é o próprio fundo (nenhum movimento foi criado); para as outras
  // origens, o fundo entrou como movimento e já está somado nas linhas.
  const saldoAbertura = sessao.fundo_origem === 'herdado' ? Number(sessao.fundo_inicial) : 0
  const conferencia = conferirDemonstrativo(saldoAbertura, linhas, saldoAtual)

  return NextResponse.json({
    ok: true,
    sessao,
    saldo_esperado: saldoAtual,
    saldo_abertura: saldoAbertura,
    demonstrativo,
    // `false` aqui significa que alguma natureza escapou da classificação —
    // a tela avisa em vez de esconder.
    demonstrativo_fecha: conferencia.ok,
    movimentos: linhas,
  })
}
