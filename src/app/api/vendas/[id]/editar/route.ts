import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'
import { ajustarDepositoPrincipal } from '@/lib/produtos/depositoPrincipal'
import { registrarMovimentoEstoque } from '@/lib/produtos/movimentacao'
import { recalcularKitsQueUsam } from '@/lib/produtos/kit'

// Corrigir uma venda já fechada — trocar produto, mudar quantidade, tirar
// item, mexer no desconto.
//
// Acontece o tempo todo no balcão: o cliente pediu um produto e o vendedor
// bateu outro. Até aqui a única saída era cancelar a venda e refazer, o que
// suja o histórico e perde o número.
//
// O que esta rota NÃO faz, de propósito:
//
//   • não edita venda com NFC-e autorizada. O documento já está na SEFAZ e
//     na mão do cliente; mudar o que ficou gravado aqui criaria divergência
//     entre o sistema e o fisco. O caminho é cancelar a nota, corrigir e
//     emitir de novo.
//   • não mexe em parcelas de fiado. Se o total muda e existem parcelas em
//     aberto, recusa — ajustar dinheiro a receber por tabela é pior que o
//     problema original.
//
// O estoque é acertado pela DIFERENÇA, não refeito do zero: tirou 1 unidade
// do item errado, ela volta pro estoque; entrou 1 do item certo, ela sai.
// Cada diferença vira um movimento no extrato, com o motivo digitado.

type ItemEntrada = {
  produtoId: string | null
  produtoNome: string
  produtoSku?: string | null
  quantidade: number
  precoUnitario: number
  desconto?: number
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { itens, desconto, motivo, observacao } = await req.json() as {
    itens: ItemEntrada[]; desconto?: number; motivo?: string; observacao?: string
  }

  if (!Array.isArray(itens) || itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'A venda precisa ter ao menos um item.' }, { status: 400 })
  }
  if (!motivo?.trim()) {
    return NextResponse.json({ ok: false, erro: 'Informe o motivo da alteração — ele fica registrado.' }, { status: 400 })
  }
  for (const i of itens) {
    if (!(Number(i.quantidade) > 0)) {
      return NextResponse.json({ ok: false, erro: `Quantidade inválida em "${i.produtoNome}".` }, { status: 400 })
    }
    if (Number(i.precoUnitario) < 0) {
      return NextResponse.json({ ok: false, erro: `Preço inválido em "${i.produtoNome}".` }, { status: 400 })
    }
  }

  const sb = await createClient()
  // Mexer numa venda fechada é pelo menos tão sensível quanto cancelá-la.
  const guarda = await exigirPermissao(sb, 'cancelar_venda')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: venda } = await sb.from('vendas').select('*')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!venda) return NextResponse.json({ ok: false, erro: 'Venda não encontrada' }, { status: 404 })

  if (venda.status === 'cancelada' || venda.status === 'cancelado') {
    return NextResponse.json({ ok: false, erro: 'Venda cancelada não pode ser editada.' }, { status: 400 })
  }
  if (venda.nfce_status === 'autorizada') {
    return NextResponse.json({
      ok: false,
      erro: `Esta venda tem NFC-e autorizada (nº ${venda.nfce_numero ?? '—'}). O documento já foi transmitido à SEFAZ e entregue ao cliente — alterar os itens aqui deixaria o sistema diferente da nota. Cancele a NFC-e primeiro, corrija a venda e emita de novo.`,
    }, { status: 409 })
  }
  if (venda.tipo_operacao === 'devolucao' || venda.tem_devolucao) {
    return NextResponse.json({
      ok: false,
      erro: 'Venda com devolução/troca não pode ser editada por aqui — o acerto de estoque tem duas pontas e sairia errado.',
    }, { status: 400 })
  }

  const { data: itensAtuais } = await sb.from('venda_itens').select('*').eq('venda_id', id)

  // ── Totais ──────────────────────────────────────────────────
  const arred = (v: number) => Math.round(v * 100) / 100
  const subtotal = arred(itens.reduce((s, i) => s + Number(i.precoUnitario) * Number(i.quantidade), 0))
  const descontoItens = arred(itens.reduce((s, i) => s + Number(i.desconto ?? 0), 0))
  const descontoGeral = arred(Number(desconto ?? 0))
  const total = arred(subtotal - descontoItens - descontoGeral)
  if (total < 0) {
    return NextResponse.json({ ok: false, erro: 'O desconto passou do valor da venda.' }, { status: 400 })
  }

  // Fiado: se o valor muda, as parcelas já geradas ficariam mentindo.
  if (arred(Number(venda.total ?? 0)) !== total) {
    const { count } = await sb.from('contas_receber')
      .select('*', { count: 'exact', head: true })
      .eq('origem_id', id).neq('status', 'cancelado')
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        ok: false,
        erro: `Esta venda gerou ${count} parcela(s) a receber. Mudar o total deixaria as parcelas diferentes da venda. Acerte as parcelas em Contas a Receber antes, ou cancele e refaça a venda.`,
      }, { status: 409 })
    }
  }

  // ── De onde sai o estoque ───────────────────────────────────
  // A venda pertence à loja, mas o estoque pode ser de outra empresa do
  // grupo (configuração do PDV). Resolvido igual ao PDV resolve na venda —
  // acertar na empresa errada seria pior que não acertar.
  const { data: cfg } = await sb.from('empresa_config_estoque')
    .select('empresa_estoque_id').eq('empresa_id', venda.empresa_id).maybeSingle()
  const empresaEstoqueId = cfg?.empresa_estoque_id || venda.empresa_id

  // ── Diferença de quantidade por produto ─────────────────────
  const antes = new Map<string, number>()
  for (const i of itensAtuais ?? []) {
    if (!i.produto_id) continue
    antes.set(i.produto_id, (antes.get(i.produto_id) ?? 0) + Number(i.quantidade ?? 0))
  }
  const depois = new Map<string, number>()
  for (const i of itens) {
    if (!i.produtoId) continue
    depois.set(i.produtoId, (depois.get(i.produtoId) ?? 0) + Number(i.quantidade))
  }

  const { data: perfil } = await sb.from('profiles').select('nome').eq('id', guarda.userId).maybeSingle()
  const quem = perfil?.nome ?? 'usuário do painel'
  const numeroVenda = venda.numero ?? String(id).slice(-6).toUpperCase()
  const movimentos: { produto: string; delta: number; de: number; para: number }[] = []

  for (const produtoId of new Set([...antes.keys(), ...depois.keys()])) {
    const qtdAntes = antes.get(produtoId) ?? 0
    const qtdDepois = depois.get(produtoId) ?? 0
    const delta = qtdDepois - qtdAntes   // > 0 vendeu mais, sai do estoque
    if (delta === 0) continue

    const { data: p } = await sb.from('produtos')
      .select('id, nome, estoque, monitorar').eq('id', produtoId).maybeSingle()
    if (!p) continue

    const estoqueAnterior = Number(p.estoque ?? 0)
    const estoqueNovo = arred(estoqueAnterior - delta)

    await sb.from('produtos')
      .update({ estoque: estoqueNovo, updated_at: new Date().toISOString() }).eq('id', produtoId)
    await ajustarDepositoPrincipal(sb, empresaEstoqueId, produtoId, -delta)
    await registrarMovimentoEstoque(sb, {
      empresaId: empresaEstoqueId, produtoId, produtoNome: p.nome,
      tipo: delta > 0 ? 'venda' : 'devolucao',
      quantidade: Math.abs(delta), estoqueAnterior, estoqueNovo,
      motivo: `Correção da venda #${numeroVenda}`,
      referenciaTipo: 'venda', referenciaId: id,
      usuario: quem, observacao: motivo.trim(),
    })
    // Estoque de kit é valor guardado, não calculado ao vivo.
    await recalcularKitsQueUsam(sb, produtoId)

    movimentos.push({ produto: p.nome, delta, de: estoqueAnterior, para: estoqueNovo })
  }

  // ── Regrava os itens ────────────────────────────────────────
  await sb.from('venda_itens').delete().eq('venda_id', id)
  const { error: erroItens } = await sb.from('venda_itens').insert(itens.map(i => ({
    venda_id: id,
    produto_id: i.produtoId,
    produto_nome: i.produtoNome,
    produto_sku: i.produtoSku ?? null,
    quantidade: Number(i.quantidade),
    preco_unitario: Number(i.precoUnitario),
    desconto: Number(i.desconto ?? 0),
    total: arred(Number(i.precoUnitario) * Number(i.quantidade) - Number(i.desconto ?? 0)),
    tipo: 'venda',
  })))
  if (erroItens) return NextResponse.json({ ok: false, erro: erroItens.message }, { status: 400 })

  const carimbo = `[${new Date().toLocaleString('pt-BR')}] Venda corrigida por ${quem}: ${motivo.trim()}`
  const { error: erroVenda } = await sb.from('vendas').update({
    subtotal,
    desconto: arred(descontoItens + descontoGeral),
    desconto_total: arred(descontoItens + descontoGeral),
    total,
    observacao: [observacao?.trim() || venda.observacao, carimbo].filter(Boolean).join('\n'),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (erroVenda) return NextResponse.json({ ok: false, erro: erroVenda.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId, usuarioNome: quem,
    acao: 'venda_editada', tabela: 'vendas', campo: 'itens',
    valorAnterior: { total: venda.total, itens: (itensAtuais ?? []).map(i => ({ nome: i.produto_nome, qtd: i.quantidade, preco: i.preco_unitario })) },
    valorNovo: { total, motivo: motivo.trim(), itens: itens.map(i => ({ nome: i.produtoNome, qtd: i.quantidade, preco: i.precoUnitario })) },
  })

  return NextResponse.json({ ok: true, total, subtotal, movimentos })
}
