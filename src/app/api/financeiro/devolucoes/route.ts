import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// AS DEVOLUÇÕES QUE AINDA NÃO TÊM DESTINO.
//
// Uma troca que fecha a favor do cliente vira uma venda com total negativo. A
// loja devolve a diferença — e, nas palavras do dono, "depende da negociação,
// deixar crédito na conta do cliente ou devolver dinheiro e sair do caixa".
//
// Essa escolha não está gravada em lugar nenhum: nem a forma original, nem o
// que o operador combinou. Por isso ela é PERGUNTADA, uma vez por devolução,
// a quem fecha o caixa — em vez de adivinhada.
//
// São ~6 por mês. Adivinhar gravaria saída de dinheiro que não houve, ou
// deixaria de gravar a que houve. A segunda é pior, porque é silenciosa.

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  if (!profile?.empresa_id) {
    return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 403 })
  }

  // Só da data em que o lançamento automático começou. Devolução anterior não
  // tem venda no caixa para estornar, e pedir decisão sobre ela seria pedir
  // trabalho que não muda saldo nenhum.
  const { data: config } = await sb.from('caixa_lancamento_config')
    .select('lancar_vendas_desde').eq('empresa_id', profile.empresa_id).maybeSingle()
  const desde = config?.lancar_vendas_desde ?? null

  if (!desde) return NextResponse.json({ ok: true, desde: null, pendentes: [], decididas: [] })

  const { data: devolucoes } = await sb.from('vendas')
    .select('id, created_at, terminal_id, total, cliente_id, clientes(nome)')
    .eq('empresa_id', profile.empresa_id)
    .eq('forma_pagamento', 'devolucao')
    .eq('status', 'concluida')
    .gte('created_at', `${desde}T00:00:00`)
    .lt('total', 0)
    .order('created_at', { ascending: false })
    .limit(100)

  const ids = ((devolucoes ?? []) as any[]).map(d => d.id)
  const { data: decisoes } = ids.length === 0
    ? { data: [] as any[] }
    : await sb.from('devolucao_destino')
        .select('venda_id, destino, decidido_em, observacao')
        .in('venda_id', ids)

  const porVenda = new Map((decisoes ?? []).map((d: any) => [d.venda_id, d]))

  const linhas = ((devolucoes ?? []) as any[]).map(d => ({
    id: d.id,
    data: d.created_at,
    terminal: d.terminal_id,
    // Positivo na tela: é quanto a loja devolveu. O sinal negativo da tabela
    // é detalhe de como a venda foi gravada, não informação para quem decide.
    valor: Math.abs(Number(d.total)),
    cliente: d.clientes?.nome ?? null,
    // Sem cliente identificado não há a quem creditar — a tela usa isto para
    // não oferecer uma opção que não funcionaria.
    podeCredito: !!d.cliente_id && (d.clientes?.nome ?? '').toLowerCase() !== 'balcao',
    decisao: porVenda.get(d.id) ?? null,
  }))

  return NextResponse.json({
    ok: true,
    desde,
    pendentes: linhas.filter(l => !l.decisao),
    decididas: linhas.filter(l => l.decisao).slice(0, 30),
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_financeiro')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  if (typeof body.vendaId !== 'string' || !body.vendaId) {
    return NextResponse.json({ ok: false, erro: 'Devolução não informada.' }, { status: 400 })
  }
  if (body.destino !== 'dinheiro' && body.destino !== 'credito') {
    return NextResponse.json({ ok: false, erro: 'Escolha dinheiro ou crédito.' }, { status: 400 })
  }

  const { data: { user } } = await sb.auth.getUser()

  const { data, error } = await sb.rpc('devolucao_decidir_v1', {
    p: {
      venda_id: body.vendaId,
      destino: body.destino,
      usuario_id: user?.id ?? null,
      observacao: typeof body.observacao === 'string' ? body.observacao.trim() : null,
    },
  })

  if (error) {
    // Os erros da função são códigos curtos, feitos para virar frase aqui.
    // `violates check constraint` não diz a ninguém o que fazer.
    const frases: Record<string, string> = {
      terminal_sem_caixa: 'O terminal desta venda não tem caixa cadastrado. Cadastre em Bancos e Contas, ou registre como crédito.',
      nao_e_devolucao: 'Esta venda não é uma devolução.',
      devolucao_sem_valor_a_devolver: 'Esta devolução não tem valor a devolver.',
      venda_nao_encontrada: 'Venda não encontrada.',
      destino_invalido: 'Destino inválido.',
    }
    const chave = Object.keys(frases).find(k => error.message.includes(k))
    return NextResponse.json({
      ok: false, erro: chave ? frases[chave] : error.message,
    }, { status: chave ? 400 : 500 })
  }

  return NextResponse.json({ ok: true, decisao: data })
}
