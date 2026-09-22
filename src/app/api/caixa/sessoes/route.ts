import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auth/permissoes'
import { contextoCaixa } from '@/lib/caixa/contextoCaixa'
import { buscarOuCriarCaixaPdv } from '@/lib/caixa/caixaPdvServidor'
import { validarAbertura, statusDoEstadoSessao } from '@/lib/caixa/sessao'

// Abertura de sessão — o turno de uma gaveta começa aqui.
//
// A ROTA NÃO GRAVA NADA. `abrir_caixa_sessao_v1` cria a sessão e, quando o
// fundo vem da tesouraria, o suprimento correspondente — na mesma
// transação. Se o fundo falhar, a sessão não fica aberta.
//
// O `id` vem do cliente: é a chave de idempotência, gerada ao abrir o
// diálogo. Um retry reenvia o mesmo id e recebe `ja_aberta` em vez de uma
// segunda sessão.
//
// A empresa vem de `contextoCaixa`. O cliente escolhe o TERMINAL, e
// `buscarOuCriarCaixaPdv` confere que ele é da empresa ativa antes de
// qualquer escrita.

export const dynamic = 'force-dynamic'

/** As sessões da empresa ativa — abertas primeiro, para a tela listar. */
export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await contextoCaixa(sb, 'gerenciar_financeiro')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const url = new URL(req.url)
  const caixaId = url.searchParams.get('caixa_id')

  let q = sb.from('caixa_sessao')
    .select('*, caixa:caixa_id(id, nome, terminal_id)')
    .eq('empresa_id', guarda.empresaId)
    .order('aberta_em', { ascending: false })
    .limit(50)
  if (caixaId) q = q.eq('caixa_id', caixaId)

  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sessoes: data ?? [] })
}

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await contextoCaixa(sb, 'abrir_caixa')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const terminalId = typeof payload?.terminal_id === 'string' ? payload.terminal_id : ''
  if (!terminalId) return NextResponse.json({ ok: false, erro: 'Escolha o caixa de PDV.' }, { status: 400 })

  const pdv = await buscarOuCriarCaixaPdv(sb, guarda.empresaId, terminalId, guarda.userId)
  if (!pdv.ok) return NextResponse.json({ ok: false, erro: pdv.erro }, { status: 400 })

  const validado = validarAbertura({
    id: payload?.id, caixa_id: pdv.caixa.id,
    fundo_origem: payload?.fundo_origem, fundo_inicial: payload?.fundo_inicial,
    observacao: payload?.observacao,
  })
  if (!validado.ok) return NextResponse.json({ ok: false, erro: validado.erro }, { status: 400 })
  const a = validado.valor

  const { data: resultado, error } = await sb.rpc('abrir_caixa_sessao_v1', {
    p: {
      id: a.id,
      empresa_id: guarda.empresaId,     // do contexto, nunca do corpo
      caixa_id: a.caixa_id,
      usuario_id: guarda.userId,
      fundo_origem: a.fundo_origem,
      fundo_inicial: String(a.fundo_inicial),
      observacao: a.observacao,
      // Só o fundo vindo da tesouraria produz transferência; nas outras
      // origens a RPC ignora este campo.
      transferencia_id: typeof payload?.transferencia_id === 'string' ? payload.transferencia_id : null,
    },
  })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const estado = resultado?.estado as string
  const status = statusDoEstadoSessao(estado)
  if (status !== 200) {
    return NextResponse.json({
      ok: false, estado, erro: resultado?.motivo ?? estado,
      saldo_real: resultado?.saldo_real ?? null,
      sessao_id: resultado?.sessao_id ?? null,
    }, { status })
  }

  if (estado === 'aberta') {
    await registrarAuditoria(sb, {
      empresaId: guarda.empresaId, usuarioId: guarda.userId,
      acao: 'caixa_sessao_aberta', tabela: 'caixa_sessao',
      valorNovo: {
        sessao_id: a.id, caixa_id: a.caixa_id,
        fundo_origem: a.fundo_origem, fundo_inicial: a.fundo_inicial,
      },
    })
  }

  return NextResponse.json({
    ok: true, estado,
    sessao: {
      id: a.id, caixa_id: a.caixa_id, caixa_nome: pdv.caixa.nome,
      fundo_origem: a.fundo_origem, fundo_inicial: a.fundo_inicial,
      saldo_na_abertura: resultado?.saldo_na_abertura ?? null,
    },
  })
}
