import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'
import { ajustarDepositoPrincipal } from '@/lib/produtos/depositoPrincipal'
import { registrarMovimentoEstoque } from '@/lib/produtos/movimentacao'
import { recalcularKitsQueUsam } from '@/lib/produtos/kit'

// CANCELAR UMA VENDA, desfazendo o que ela fez.
//
// Uma venda não é só a linha em `vendas`. Ela move quatro coisas, e cancelar
// sem desfazer as quatro deixa o sistema pior do que se ninguém tivesse
// mexido — estoque que não volta e dívida que continua cobrada são erros que
// aparecem semanas depois, longe da causa.
//
//   1. estoque      `produtos.estoque`, o depósito e o extrato de movimentação
//   2. a receber     parcelas de fiado e a conta de carteira
//   3. o cliente     `saldo_devedor` de quem comprou fiado ou na carteira
//   4. crédito       gerado por devolução maior que a compra
//
// O QUE ELA RECUSA, e por quê:
//
//   NFC-e AUTORIZADA. O documento está na SEFAZ e na mão do cliente. Marcar
//   a venda como cancelada aqui deixaria o sistema divergente do fisco, com a
//   nota continuando válida. O caminho é cancelar a NFC-e primeiro.
//
//   PARCELA JÁ RECEBIDA. Dinheiro entrou. Cancelar a venda apagaria a razão
//   daquele recebimento e o caixa passaria a ter uma entrada sem origem.
//   Quem precisa desfazer isso tem que devolver o dinheiro primeiro, em
//   Contas a Receber, e aí a venda pode ser cancelada.
//
//   CRÉDITO JÁ USADO. O cliente levou mercadoria com ele. Cancelar aqui
//   tiraria um crédito que já virou produto na mão de alguém.
//
// NÃO É ESTORNO CONTÁBIL. O sistema não tem livro-caixa com lançamento e
// contrapartida: o "financeiro" de uma venda à vista é o próprio registro da
// venda, e cancelá-la é o que a tira dos números. Para carteira e fiado, que
// geram documento a receber de verdade, o cancelamento é explícito e fica
// escrito na observação da parcela.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { motivo } = await req.json().catch(() => ({})) as { motivo?: string }

  if (!motivo?.trim()) {
    return NextResponse.json({
      ok: false,
      erro: 'Informe o motivo do cancelamento — ele fica registrado na venda e na auditoria.',
    }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'cancelar_venda')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: venda } = await sb.from('vendas').select('*')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!venda) return NextResponse.json({ ok: false, erro: 'Venda não encontrada' }, { status: 404 })

  if (venda.status === 'cancelada' || venda.status === 'cancelado') {
    return NextResponse.json({ ok: false, erro: 'Esta venda já está cancelada.' }, { status: 400 })
  }
  if (venda.nfce_status === 'autorizada') {
    return NextResponse.json({
      ok: false,
      erro: `Esta venda tem NFC-e autorizada (nº ${venda.nfce_numero ?? '—'}). O documento já foi transmitido à SEFAZ e entregue ao cliente. Cancele a NFC-e primeiro — cancelar só aqui deixaria a nota valendo com a venda cancelada no sistema.`,
    }, { status: 409 })
  }

  // ── Nada de desfazer o que já virou dinheiro ou mercadoria ──
  const { data: aReceber } = await sb.from('contas_receber')
    .select('id, valor_original, valor_recebido, status, parcela_numero, observacao')
    .eq('origem_id', id).neq('status', 'cancelado')

  const recebidas = (aReceber ?? []).filter(c => Number(c.valor_recebido ?? 0) > 0)
  if (recebidas.length > 0) {
    const soma = recebidas.reduce((s, c) => s + Number(c.valor_recebido ?? 0), 0)
    return NextResponse.json({
      ok: false,
      erro: `Esta venda já teve ${brl(soma)} recebido(s) em ${recebidas.length} parcela(s). `
        + 'Cancelar a venda deixaria esse dinheiro no caixa sem origem. Devolva o valor em Contas a Receber primeiro e depois cancele a venda.',
    }, { status: 409 })
  }

  const { data: creditos } = await sb.from('creditos_cliente')
    .select('id, valor_original, valor_utilizado, status')
    .eq('origem_id', id).neq('status', 'cancelado')

  const creditosUsados = (creditos ?? []).filter(c => Number(c.valor_utilizado ?? 0) > 0)
  if (creditosUsados.length > 0) {
    const soma = creditosUsados.reduce((s, c) => s + Number(c.valor_utilizado ?? 0), 0)
    return NextResponse.json({
      ok: false,
      erro: `O crédito gerado por esta venda já foi usado (${brl(soma)}). O cliente levou mercadoria com ele, então cancelar aqui tiraria um crédito que já virou produto.`,
    }, { status: 409 })
  }

  const { data: perfil } = await sb.from('profiles').select('nome').eq('id', guarda.userId).maybeSingle()
  const quem = perfil?.nome ?? 'usuário do painel'
  const numeroVenda = venda.numero ?? String(id).slice(-6).toUpperCase()
  const agora = new Date()
  const carimbo = `[${agora.toLocaleString('pt-BR')}] Venda cancelada por ${quem}: ${motivo.trim()}`

  // ── 1. ESTOQUE DE VOLTA ─────────────────────────────────────
  //
  // A venda pode ter baixado o estoque de outra empresa do grupo. Resolvido
  // do mesmo jeito que o PDV resolveu na hora de baixar: devolver na empresa
  // errada seria pior que não devolver, porque cria estoque onde não saiu.
  const { data: cfg } = await sb.from('empresa_config_estoque')
    .select('empresa_estoque_id').eq('empresa_id', venda.empresa_id).maybeSingle()
  const empresaEstoqueId = cfg?.empresa_estoque_id || venda.empresa_id

  const { data: itens } = await sb.from('venda_itens').select('*').eq('venda_id', id)

  const arred = (v: number) => Math.round(v * 100) / 100
  const devolvidos: { produto: string; quantidade: number; de: number; para: number }[] = []

  for (const item of itens ?? []) {
    if (!item.produto_id) continue
    // Item de DEVOLUÇÃO dentro da venda entrou no estoque quando ela foi
    // feita; cancelar precisa tirá-lo de novo. O sinal da quantidade é quem
    // diz de que lado o item estava.
    const qtd = Number(item.quantidade ?? 0)
    if (qtd === 0) continue
    const ehDevolucao = item.tipo === 'devolucao' || qtd < 0
    const delta = ehDevolucao ? -Math.abs(qtd) : Math.abs(qtd)   // > 0 volta ao estoque

    const { data: p } = await sb.from('produtos')
      .select('id, nome, estoque').eq('id', item.produto_id).maybeSingle()
    if (!p) continue

    const estoqueAnterior = Number(p.estoque ?? 0)
    const estoqueNovo = arred(estoqueAnterior + delta)

    await sb.from('produtos')
      .update({ estoque: estoqueNovo, updated_at: agora.toISOString() }).eq('id', item.produto_id)
    // Mesmo depósito de onde saiu: o principal da empresa. Este sistema não
    // tem escolha de depósito por venda (ver depositoPrincipal.ts), então
    // "o depósito que foi debitado" é esse — e dizer outra coisa seria
    // prometer um rastro que não existe.
    await ajustarDepositoPrincipal(sb, empresaEstoqueId, item.produto_id, delta)
    await registrarMovimentoEstoque(sb, {
      empresaId: empresaEstoqueId, produtoId: item.produto_id, produtoNome: p.nome,
      tipo: delta > 0 ? 'devolucao' : 'venda',
      quantidade: Math.abs(delta), estoqueAnterior, estoqueNovo,
      motivo: `Cancelamento da venda #${numeroVenda}`,
      referenciaTipo: 'venda', referenciaId: id,
      usuario: quem, observacao: motivo.trim(),
    })
    await recalcularKitsQueUsam(sb, item.produto_id)

    devolvidos.push({ produto: p.nome, quantidade: delta, de: estoqueAnterior, para: estoqueNovo })
  }

  // ── 2. A RECEBER: cancela dizendo por quê ───────────────────
  let parcelasCanceladas = 0
  let valorEmAberto = 0
  for (const conta of aReceber ?? []) {
    valorEmAberto += Number(conta.valor_original ?? 0)
    const { error } = await sb.from('contas_receber').update({
      status: 'cancelado',
      // O motivo fica NA PARCELA. Quem abre Contas a Receber meses depois vê
      // "cancelado" e precisa saber que foi a venda que caiu, sem ter de
      // cruzar com outra tela.
      observacao: [conta.observacao, `${carimbo} (venda #${numeroVenda} cancelada)`]
        .filter(Boolean).join('\n'),
      updated_at: agora.toISOString(),
    }).eq('id', conta.id)
    if (!error) parcelasCanceladas++
  }

  // ── 3. O SALDO DO CLIENTE ───────────────────────────────────
  //
  // Só o que estava em aberto: parcela recebida já foi barrada lá em cima,
  // então tudo que sobrou aqui é dívida que deixa de existir.
  if (venda.cliente_id && valorEmAberto > 0) {
    const { data: cli } = await sb.from('clientes')
      .select('saldo_devedor').eq('id', venda.cliente_id).maybeSingle()
    if (cli) {
      await sb.from('clientes').update({
        // Nunca abaixo de zero: um saldo negativo aqui viraria crédito
        // fantasma que ninguém sabe explicar.
        saldo_devedor: Math.max(0, arred(Number(cli.saldo_devedor ?? 0) - valorEmAberto)),
      }).eq('id', venda.cliente_id)
    }
  }

  // ── 4. CRÉDITO GERADO POR DEVOLUÇÃO ─────────────────────────
  let creditosCancelados = 0
  for (const credito of creditos ?? []) {
    const { error } = await sb.from('creditos_cliente').update({
      status: 'cancelado',
      observacao: `${carimbo} (venda #${numeroVenda} cancelada)`,
      updated_at: agora.toISOString(),
    }).eq('id', credito.id)
    if (error) continue
    creditosCancelados++
    if (venda.cliente_id) {
      const { data: cli } = await sb.from('clientes')
        .select('saldo_credito').eq('id', venda.cliente_id).maybeSingle()
      if (cli) {
        await sb.from('clientes').update({
          saldo_credito: Math.max(0, arred(Number(cli.saldo_credito ?? 0) - Number(credito.valor_original ?? 0))),
        }).eq('id', venda.cliente_id)
      }
    }
  }

  // ── 5. A VENDA ──────────────────────────────────────────────
  const { error: erroVenda } = await sb.from('vendas').update({
    status: 'cancelada',
    observacao: [venda.observacao, carimbo].filter(Boolean).join('\n'),
    updated_at: agora.toISOString(),
  }).eq('id', id)
  if (erroVenda) return NextResponse.json({ ok: false, erro: erroVenda.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId, usuarioNome: quem,
    acao: 'venda_cancelada', tabela: 'vendas', campo: 'status',
    valorAnterior: { status: venda.status, total: venda.total },
    valorNovo: {
      status: 'cancelada', motivo: motivo.trim(),
      itensDevolvidos: devolvidos.length, parcelasCanceladas, creditosCancelados,
    },
  })

  return NextResponse.json({
    ok: true,
    devolvidos,
    parcelasCanceladas,
    creditosCancelados,
    valorEmAberto: arred(valorEmAberto),
  })
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
