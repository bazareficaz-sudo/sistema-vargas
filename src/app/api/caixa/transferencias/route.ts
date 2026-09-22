import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auth/permissoes'
import { contextoCaixa } from '@/lib/caixa/contextoCaixa'
import { buscarOuCriarTesouraria } from '@/lib/caixa/tesourariaServidor'
import { buscarOuCriarCaixaPdv } from '@/lib/caixa/caixaPdvServidor'
import {
  validarNovaTransferencia, validarCombinacao, statusDoEstado,
  type EspecieTransferencia,
} from '@/lib/caixa/transferencia'

// Sangria e suprimento — a transferência física de dinheiro entre a gaveta
// do PDV e a tesouraria.
//
// A ROTA NÃO GRAVA NADA. Ela resolve os dois caixas e chama
// `transferir_caixa_v1`, que faz documento e os dois movimentos numa
// transação só. Se a rota inserisse o movimento de saída e depois chamasse
// outra coisa para a entrada, existiria um instante em que o dinheiro saiu
// do PDV e não chegou à tesouraria — e um erro de rede nesse instante o
// tornaria permanente. É isso que a Fase 2 existe para impedir.
//
// O CLIENTE MANDA O `id`. É a chave de idempotência, gerada ao abrir o
// diálogo. Duplo clique, timeout e refresh reenviam o MESMO id, e a RPC
// devolve `ja_aplicada` em vez de transferir de novo. A rota não gera id
// quando falta: gerar seria transformar cada retry numa transferência nova.
//
// O CLIENTE ESCOLHE O TERMINAL, NÃO A EMPRESA. `buscarOuCriarCaixaPdv`
// confere o terminal contra a empresa do contexto antes de qualquer
// escrita.

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await contextoCaixa(sb)
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const especie = payload?.especie as EspecieTransferencia
  if (especie !== 'sangria' && especie !== 'suprimento') {
    return NextResponse.json({ ok: false, erro: 'Espécie deve ser sangria ou suprimento.' }, { status: 400 })
  }

  const terminalId = typeof payload?.terminal_id === 'string' ? payload.terminal_id : ''
  if (!terminalId) {
    return NextResponse.json({ ok: false, erro: 'Escolha o caixa de PDV.' }, { status: 400 })
  }

  // Os dois lados. A tesouraria é única por empresa; a gaveta nasce aqui se
  // for a primeira operação dela.
  const tesouraria = await buscarOuCriarTesouraria(sb, guarda.empresaId, guarda.userId)
  const pdv = await buscarOuCriarCaixaPdv(sb, guarda.empresaId, terminalId, guarda.userId)
  if (!pdv.ok) return NextResponse.json({ ok: false, erro: pdv.erro }, { status: 400 })

  const origem = especie === 'sangria' ? pdv.caixa : tesouraria
  const destino = especie === 'sangria' ? tesouraria : pdv.caixa

  const validado = validarNovaTransferencia({
    id: payload?.id, especie,
    caixa_origem_id: origem.id, caixa_destino_id: destino.id,
    valor: payload?.valor, observacao: payload?.observacao,
  })
  if (!validado.ok) return NextResponse.json({ ok: false, erro: validado.erro }, { status: 400 })

  // Recusa cedo e legível. A RPC revalida tudo isto com os caixas relidos
  // dentro da transação — ela é a autoridade, não esta checagem.
  const combinacao = validarCombinacao(especie, origem, destino, guarda.empresaId)
  if (!combinacao.ok) return NextResponse.json({ ok: false, erro: combinacao.erro }, { status: 409 })

  const t = validado.transferencia
  const { data: resultado, error } = await sb.rpc('transferir_caixa_v1', {
    p: {
      id: t.id,
      empresa_id: guarda.empresaId,     // do contexto, nunca do corpo
      caixa_origem_id: t.caixa_origem_id,
      caixa_destino_id: t.caixa_destino_id,
      especie: t.especie,
      valor: String(t.valor),
      observacao: t.observacao,
      usuario_id: guarda.userId,
    },
  })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const estado = resultado?.estado as string
  const status = statusDoEstado(estado)
  if (status !== 200) {
    return NextResponse.json({ ok: false, estado, erro: resultado?.motivo ?? estado }, { status })
  }

  // `ja_aplicada` não vira linha de auditoria: a operação é a mesma, e
  // registrar cada retry faria o histórico contar transferências que não
  // aconteceram.
  if (estado === 'aplicada') {
    await registrarAuditoria(sb, {
      empresaId: guarda.empresaId, usuarioId: guarda.userId,
      acao: especie === 'sangria' ? 'caixa_sangria' : 'caixa_suprimento',
      tabela: 'caixa_transferencia',
      valorNovo: {
        transferencia_id: t.id, especie, valor: t.valor,
        caixa_origem_id: t.caixa_origem_id, caixa_destino_id: t.caixa_destino_id,
        observacao: t.observacao,
      },
    })
  }

  return NextResponse.json({
    ok: true, estado,
    transferencia: {
      id: t.id, especie, valor: t.valor, observacao: t.observacao,
      origem: { id: origem.id, nome: origem.nome },
      destino: { id: destino.id, nome: destino.nome },
    },
  })
}
