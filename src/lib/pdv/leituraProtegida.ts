import { NextResponse } from 'next/server'
import { autenticarTerminalPdv, respostaDeRecusa } from './autenticarTerminal'
import type { ContextoTerminal } from './decidirAcesso'

// O MOLDE DAS LEITURAS DO PDV.
//
// ── POR QUE NÃO É `operacaoProtegida` ───────────────────────────────────
//
// Aquele molde é o das MUTAÇÕES: exige chave de idempotência e grava uma linha
// em `pdv_operacoes` por chamada. Usá-lo numa leitura teria duas consequências,
// e a segunda é grave:
//
//   1. o livro-razão viraria lixo — uma linha cada vez que um operador abre um
//      orçamento de outro terminal;
//   2. a idempotência devolveria um SNAPSHOT VELHO PARA SEMPRE. A chave
//      repetida responderia com a revisão de ontem, que é exatamente o oposto
//      do que uma leitura de snapshot existe para dar.
//
// O ponto (2) não é hipotético: é o comportamento correto de `operacaoProtegida`
// — ele guarda a resposta de sucesso e a repete. Numa escrita isso é a garantia;
// numa leitura é o defeito.
//
// Então: autenticação, empresa e flag — que são iguais — e nada de chave, nada
// de ledger, nada de replay.
//
// ── TELEMETRIA ──────────────────────────────────────────────────────────
//
// `autenticarTerminalPdv` já avança `ultima_atividade_em` em toda requisição
// autenticada, inclusive nas recusadas. É a observabilidade que a leitura tem,
// e é observacional — nunca mecanismo de idempotência.

export type LeitorDeTerminal<T> = (ctx: ContextoTerminal) => Promise<T>

export async function leituraProtegida<T>(
  req: Request,
  opts: {
    /** Chave em `rotas_habilitadas`. A leitura respeita o mesmo rollout da escrita. */
    flagDaOperacao?: string
    exigirFlag?: boolean
    ler: LeitorDeTerminal<T>
    /** Status HTTP a partir do resultado. Padrão 200. */
    httpDoResultado?: (r: T) => number
  },
): Promise<Response> {
  const acesso = await autenticarTerminalPdv(req, {
    exigirFlag: opts.exigirFlag ?? true,
    operacao: opts.flagDaOperacao,
  })
  if (!acesso.ok) return respostaDeRecusa(acesso)

  try {
    const resultado = await opts.ler(acesso.contexto)
    const http = opts.httpDoResultado?.(resultado) ?? 200
    return NextResponse.json({ ok: http < 400, ...(resultado as object) }, { status: http })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha na leitura'
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
}
