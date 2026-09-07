import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autenticarTerminalPdv, respostaDeRecusa } from './autenticarTerminal'
import { conferirEmpresaDoCorpo, type ContextoTerminal } from './decidirAcesso'
import { decidirIdempotencia, chaveIdempotenciaValida } from './decidirIdempotencia'

// O MOLDE DAS ROTAS DO PDV.
//
// Autenticação, empresa, idempotência, auditoria e forma do erro acontecem
// aqui — uma vez. A rota escreve só o que é dela: validar a entrada e fazer a
// operação.
//
// Isto existe porque a próxima fase vai acrescentar `vendas`, `recebimentos`
// e `estoque`, e a diferença entre uma migração segura e uma perigosa é
// quantas dessas cinco coisas cada nova rota tem chance de esquecer. Aqui a
// resposta é: nenhuma, porque não há onde esquecer.

export const CABECALHO_IDEMPOTENCIA = 'idempotency-key'

export type Executor<T> = (ctx: ContextoTerminal) => Promise<T>

/**
 * Roda uma operação mutável do PDV com tudo o que ela precisa em volta.
 *
 * A ordem não é arbitrária. Autenticar primeiro, porque sem terminal não há
 * de quem cobrar a chave de idempotência. Reservar a chave ANTES de executar,
 * porque reservar depois é não ter reservado nada — duas chamadas simultâneas
 * teriam ambas passado pela verificação antes de qualquer uma gravar.
 */
export async function operacaoProtegida<T>(
  req: Request,
  opts: {
    operacao: string
    /** Corpo já lido pela rota — a requisição só pode ser lida uma vez. */
    corpo: Record<string, unknown>
    executar: Executor<T>
    exigirFlag?: boolean
  },
): Promise<Response> {
  const acesso = await autenticarTerminalPdv(req, { exigirFlag: opts.exigirFlag ?? true })
  if (!acesso.ok) return respostaDeRecusa(acesso)
  const ctx = acesso.contexto

  // Empresa no corpo é tolerada e conferida, nunca obedecida.
  const divergencia = conferirEmpresaDoCorpo(ctx, opts.corpo?.empresa_id)
  if (divergencia && !divergencia.ok) {
    await registrar(ctx, opts.operacao, null, 'erro', divergencia.erro)
    return respostaDeRecusa(divergencia)
  }

  const chave = String(opts.corpo?.idempotency_key ?? req.headers.get(CABECALHO_IDEMPOTENCIA) ?? '')
  if (!chaveIdempotenciaValida(chave)) {
    return NextResponse.json(
      { ok: false, erro: 'Informe uma chave de idempotência válida.', motivo: 'chave_invalida' },
      { status: 400 },
    )
  }

  const sb = createAdminClient()
  const alvo = { terminal_id: ctx.terminal_id, operacao: opts.operacao, idempotency_key: chave }

  // Tenta reservar. O índice único é quem arbitra; não há checagem-antes-de-
  // gravar, que é onde essas implementações costumam ter a corrida.
  const { error: erroInsert } = await sb.from('pdv_operacoes').insert({
    ...alvo,
    empresa_id: ctx.empresa_id,
    versao_pdv: ctx.versao_pdv,
    status: 'em_andamento',
  })

  if (erroInsert) {
    // 23505 = violação de unicidade: a chave já existe.
    if (erroInsert.code !== '23505') {
      return NextResponse.json({ ok: false, erro: 'Falha ao registrar a operação.' }, { status: 500 })
    }

    const { data: existente } = await sb.from('pdv_operacoes')
      .select('status, resposta, criado_em')
      .match(alvo).maybeSingle()

    const d = decidirIdempotencia(existente ?? null)

    if (d.acao === 'repetir_resposta') {
      // Mesma resposta da primeira vez. O `repetido` é informativo: o PDV não
      // precisa dele para estar correto, mas o log fica muito mais legível.
      return NextResponse.json({ ...(d.resposta as object), repetido: true })
    }
    if (d.acao === 'em_voo') {
      return NextResponse.json({ ok: false, erro: d.erro, motivo: 'em_voo' }, { status: 409 })
    }
    await sb.from('pdv_operacoes')
      .update({ status: 'em_andamento', erro: null, criado_em: new Date().toISOString() })
      .match(alvo)
  }

  try {
    const resultado = await opts.executar(ctx)
    const corpo = { ok: true, ...(resultado as object) }
    await sb.from('pdv_operacoes').update({
      status: 'sucesso', resposta: corpo, concluido_em: new Date().toISOString(),
    }).match(alvo)
    return NextResponse.json(corpo)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha na operação'
    await sb.from('pdv_operacoes').update({
      status: 'erro', erro: msg.slice(0, 500), concluido_em: new Date().toISOString(),
    }).match(alvo)
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
}

/** Registro avulso, para recusas que nem chegam a ter chave de idempotência. */
async function registrar(
  ctx: ContextoTerminal, operacao: string, chave: string | null,
  status: 'erro', erro: string,
) {
  const sb = createAdminClient()
  await sb.from('pdv_operacoes').insert({
    terminal_id: ctx.terminal_id,
    empresa_id: ctx.empresa_id,
    operacao,
    idempotency_key: chave ?? `recusa:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    versao_pdv: ctx.versao_pdv,
    status, erro: erro.slice(0, 500),
    concluido_em: new Date().toISOString(),
  })
}
