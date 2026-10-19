import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// O PAINEL DO MOTOR QUE JÁ EXISTIA.
//
// O ledger do caixa tem quatro tabelas e seis RPCs desde setembro, e nunca
// teve tela: zero rotas, zero componentes, zero linhas de código chamando. Os
// únicos lançamentos até 19/10/2026 foram feitos por SQL, à mão.
//
// Com a Fase 4E ligada em 20/10, a venda passa a lançar sozinha — e sem esta
// rota o dinheiro entraria num lugar que ninguém consegue abrir.

type Caixa = { id: string; nome: string; tipo: string; ativo: boolean }

const TIPO_ORDEM: Record<string, number> = {
  pdv: 1, tesouraria: 2, banco: 3, adquirente: 4,
}

export async function GET(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  if (!profile?.empresa_id) {
    return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 403 })
  }

  const url = new URL(req.url)
  const caixaPedido = url.searchParams.get('caixa') ?? ''
  // Padrão de 7 dias, não "tudo": o extrato de um caixa de balcão com meses de
  // movimento é inútil na tela e custa caro no banco.
  const dias = Math.min(90, Math.max(1, parseInt(url.searchParams.get('dias') ?? '7') || 7))
  const desde = new Date(Date.now() - dias * 86400_000).toISOString()

  const { data: caixas } = await sb.from('caixa')
    .select('id, nome, tipo, ativo')
    .eq('empresa_id', profile.empresa_id)
    .order('nome')

  const lista = ((caixas ?? []) as Caixa[])
    .sort((a, b) => (TIPO_ORDEM[a.tipo] ?? 9) - (TIPO_ORDEM[b.tipo] ?? 9) || a.nome.localeCompare(b.nome))

  // O saldo é a SOMA DOS MOVIMENTOS, sempre — nunca uma coluna guardada. É a
  // regra que torna o ledger confiável: não existe saldo para divergir do
  // extrato, porque o saldo é o extrato somado.
  const saldos = await Promise.all(
    lista.map(async c => {
      const { data } = await sb.rpc('saldo_caixa_v1', { p_caixa: c.id })
      return { id: c.id, saldo: Number(data ?? 0) }
    }),
  )
  const porId = new Map(saldos.map(s => [s.id, s.saldo]))

  // O extrato: o caixa pedido, ou o primeiro da lista.
  const alvo = lista.find(c => c.id === caixaPedido) ?? lista[0] ?? null

  let movimentos: any[] = []
  if (alvo) {
    const { data } = await sb.from('caixa_movimento')
      .select('id, tipo, natureza, valor, forma_pagamento, referencia_tipo, referencia_id, observacao, created_at')
      .eq('caixa_id', alvo.id)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(500)
    movimentos = (data ?? []) as any[]
  }

  // O que a venda deixou de fora, com o motivo. Vem junto de propósito: a
  // soma do caixa só quer dizer algo ao lado do que não entrou nela.
  const { data: fora } = await sb.from('venda_fora_do_caixa_v1')
    .select('venda_id, created_at, terminal_id, forma_pagamento, total, motivo')
    .order('created_at', { ascending: false })
    .limit(200)

  const { data: config } = await sb.from('caixa_lancamento_config')
    .select('lancar_vendas_desde')
    .eq('empresa_id', profile.empresa_id)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    lancaDesde: config?.lancar_vendas_desde ?? null,
    caixas: lista.map(c => ({ ...c, saldo: porId.get(c.id) ?? 0 })),
    extratoDe: alvo?.id ?? null,
    dias,
    movimentos,
    fora: fora ?? [],
  })
}
