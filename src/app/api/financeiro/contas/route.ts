import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Bancos, contas e maquininhas — que no banco de dados são a mesma tabela que
// os caixas de balcão: `caixa`. Ela já tem os quatro tipos e é o que o ledger
// referencia; um cadastro "contas" ao lado seria o mesmo dado em dois lugares.
//
// Não há exclusão. Caixa com movimento lançado é histórico, e apagar deixaria
// movimento apontando para o nada. Desligar basta: `ativo = false` tira das
// escolhas sem mexer no passado.

const CAMPOS = 'id, tipo, nome, ativo, instituicao, agencia, conta, chave_pix, terminal_id'

// PDV e tesouraria não se criam aqui: caixa de PDV nasce amarrado a um
// terminal, e tesouraria é única por empresa. Esta tela cadastra onde o
// dinheiro entra e de onde a adquirente liquida.
const TIPOS_CRIAVEIS = ['banco', 'adquirente']

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  if (!profile?.empresa_id) {
    return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 403 })
  }

  const { data: contas } = await sb.from('caixa').select(CAMPOS)
    .eq('empresa_id', profile.empresa_id).order('tipo').order('nome')

  // Quantas formas de pagamento apontam para cada conta. É o que impede o
  // gestor de desligar a conta do pix sem perceber que o pix vai para lá.
  const { data: formas } = await sb.from('forma_pagamento')
    .select('nome, caixa_destino_id, adquirente_caixa_id, ativo')
    .eq('empresa_id', profile.empresa_id)

  const usos = new Map<string, string[]>()
  for (const f of formas ?? []) {
    for (const id of [f.caixa_destino_id, f.adquirente_caixa_id]) {
      if (!id) continue
      usos.set(id, [...(usos.get(id) ?? []), f.nome])
    }
  }

  return NextResponse.json({
    ok: true,
    contas: (contas ?? []).map(c => ({ ...c, usada_por: usos.get(c.id) ?? [] })),
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const nome = String(body.nome ?? '').trim()
  if (!nome) return NextResponse.json({ ok: false, erro: 'Dê um nome à conta.' }, { status: 400 })

  if (!TIPOS_CRIAVEIS.includes(body.tipo)) {
    return NextResponse.json({
      ok: false,
      erro: 'Escolha se é uma conta de banco ou uma adquirente.',
    }, { status: 400 })
  }

  // Nome repetido no mesmo tipo é confusão garantida nas listas de escolha —
  // duas "Mercado Pago" e ninguém sabe qual é a conta e qual é a maquininha.
  const { data: igual } = await sb.from('caixa').select('id')
    .eq('empresa_id', guarda.empresaId).eq('tipo', body.tipo).eq('nome', nome).maybeSingle()
  if (igual) {
    return NextResponse.json({ ok: false, erro: `Já existe ${nome} nesse tipo.` }, { status: 409 })
  }

  const { data, error } = await sb.from('caixa').insert({
    empresa_id: guarda.empresaId,
    tipo: body.tipo,
    nome,
    ativo: true,
    instituicao: texto(body.instituicao),
    agencia: texto(body.agencia),
    conta: texto(body.conta),
    chave_pix: texto(body.chave_pix),
  }).select('id').single()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data?.id })
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ ok: false, erro: 'Conta não informada.' }, { status: 400 })
  }
  const nome = String(body.nome ?? '').trim()
  if (!nome) return NextResponse.json({ ok: false, erro: 'O nome não pode ficar vazio.' }, { status: 400 })

  // `tipo` não entra na alteração. Virar o tipo de um caixa com movimento
  // lançado reescreveria o significado do histórico: o que era saldo de
  // maquininha passaria a contar como dinheiro disponível em conta.
  const { error } = await sb.from('caixa').update({
    nome,
    ativo: !!body.ativo,
    instituicao: texto(body.instituicao),
    agencia: texto(body.agencia),
    conta: texto(body.conta),
    chave_pix: texto(body.chave_pix),
    updated_at: new Date().toISOString(),
  }).eq('id', body.id).eq('empresa_id', guarda.empresaId)

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/** Campo de texto opcional: vazio vira nulo, para não gravar string em branco. */
function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}
