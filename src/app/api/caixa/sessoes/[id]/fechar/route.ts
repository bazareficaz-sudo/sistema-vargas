import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auth/permissoes'
import { contextoCaixa } from '@/lib/caixa/contextoCaixa'
import { validarFechamento, statusDoEstadoSessao } from '@/lib/caixa/sessao'

// Fechamento — conferir a gaveta, apurar a diferença e entregar o que sobra.
//
// TUDO NUMA TRANSAÇÃO SÓ. `fechar_caixa_sessao_v1` lança o ajuste da
// diferença, faz a sangria final e marca a sessão como fechada. Não existe
// estado em que a sessão fechou mas a transferência falhou, nem o inverso:
// se qualquer passo der errado, nada acontece e a sessão continua aberta.
//
// A CONTA DA ENTREGA É `contado − troco`, e a RPC a refaz. Não se somam as
// sangrias do dia: aquele dinheiro já saiu da gaveta e já entrou na
// tesouraria quando cada sangria foi feita. O que sai agora é só o que
// ainda está fisicamente lá.
//
// `valor_esperado_visto` é opcional e existe para um caso real: entre a
// tela mostrar o esperado e o operador terminar de contar, alguém pode ter
// feito uma sangria. Fechar com base no número velho produziria uma
// diferença que não é real, então a RPC recusa com `conflito_esperado`.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await contextoCaixa(sb, 'fechar_caixa')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const validado = validarFechamento(payload)
  if (!validado.ok) return NextResponse.json({ ok: false, erro: validado.erro }, { status: 400 })
  const f = validado.valor

  const { data: resultado, error } = await sb.rpc('fechar_caixa_sessao_v1', {
    p: {
      sessao_id: id,
      empresa_id: guarda.empresaId,     // do contexto, nunca do corpo
      usuario_id: guarda.userId,
      valor_contado: String(f.valor_contado),
      valor_mantido_troco: String(f.valor_mantido_troco),
      observacao: f.observacao,
      // Nasce ao abrir o diálogo, junto com o UUID da sessão: um retry
      // reenvia o mesmo e não duplica a sangria final.
      transferencia_id: typeof payload?.transferencia_id === 'string' ? payload.transferencia_id : null,
      valor_esperado_visto: payload?.valor_esperado_visto != null
        ? String(payload.valor_esperado_visto) : null,
    },
  })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const estado = resultado?.estado as string
  const status = statusDoEstadoSessao(estado)
  if (status !== 200) {
    return NextResponse.json({
      ok: false, estado, erro: resultado?.motivo ?? estado,
      esperado_agora: resultado?.esperado_agora ?? null,
    }, { status })
  }

  if (estado === 'fechada') {
    await registrarAuditoria(sb, {
      empresaId: guarda.empresaId, usuarioId: guarda.userId,
      acao: 'caixa_sessao_fechada', tabela: 'caixa_sessao',
      valorNovo: {
        sessao_id: id,
        valor_esperado: resultado?.valor_esperado,
        valor_contado: resultado?.valor_contado,
        diferenca: resultado?.diferenca,
        valor_mantido_troco: resultado?.valor_mantido_troco,
        valor_entregue_tesouraria: resultado?.valor_entregue_tesouraria,
      },
    })
  }

  return NextResponse.json({
    ok: true, estado,
    fechamento: {
      sessao_id: id,
      valor_esperado: Number(resultado?.valor_esperado ?? 0),
      valor_contado: Number(resultado?.valor_contado ?? 0),
      diferenca: Number(resultado?.diferenca ?? 0),
      valor_mantido_troco: Number(resultado?.valor_mantido_troco ?? 0),
      valor_entregue_tesouraria: Number(resultado?.valor_entregue_tesouraria ?? 0),
      // O que ficou na gaveta segundo o ledger. Tem de ser igual ao troco —
      // é a continuidade que a próxima sessão vai herdar.
      saldo_final_do_caixa: resultado?.saldo_final_do_caixa != null
        ? Number(resultado.saldo_final_do_caixa) : null,
    },
  })
}
