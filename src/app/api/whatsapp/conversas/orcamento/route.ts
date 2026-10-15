import { NextRequest, NextResponse } from 'next/server'
import { precoVigente } from '@/lib/produtos/promocao'
import { contextoDaConversa } from '@/lib/whatsapp/contextoConversa'
import { enviarOrcamentoNaConversa, normalizarItens, validadeAceita } from '@/lib/whatsapp/orcamento'

// Monta o orçamento na conversa e envia. O mesmo orçamento do PDV e da tela
// de Orçamentos. Preço é o vigente do cadastro, calculado aqui — o navegador
// manda só produto e quantidade.

const r2 = (v: number) => Math.round(v * 100) / 100

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({})) as { contatoId?: string; itens?: unknown; validade?: unknown; observacao?: unknown }
  const c = await contextoDaConversa(corpo.contatoId)
  if (!c.ok) return NextResponse.json({ error: c.erro }, { status: c.status })
  const { supabase, empresaId, contato } = c.ctx

  const itens = normalizarItens(corpo.itens)
  if (!itens) return NextResponse.json({ error: 'Itens inválidos (de 1 a 60 produtos, quantidade maior que zero).' }, { status: 400 })

  const { data: produtos } = await supabase.from('produtos')
    .select('id, nome, sku, ativo, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim')
    .eq('empresa_id', empresaId).in('id', itens.map(i => i.produtoId))
  const porId = new Map((produtos ?? []).map(p => [p.id, p]))
  const agora = new Date()
  const linhas = itens.map(i => {
    const p = porId.get(i.produtoId)
    const preco = p && p.ativo !== false ? r2(precoVigente(p, agora)) : 0
    return { i, p, preco }
  })
  const semPreco = linhas.filter(l => !l.p || l.p.ativo === false || !(l.preco > 0))
  if (semPreco.length) return NextResponse.json({
    error: `Sem preço ou inativo no cadastro: ${semPreco.map(l => l.p?.nome ?? 'produto removido').join(', ')}. Ajuste no cadastro ou tire do orçamento.`,
  }, { status: 400 })

  const total = r2(linhas.reduce((s, l) => s + r2(l.preco * l.i.quantidade), 0))
  const observacao = typeof corpo.observacao === 'string' ? corpo.observacao.trim().slice(0, 500) || null : null
  const { data: orc, error } = await supabase.from('orcamentos').insert({
    empresa_id: empresaId,
    cliente_id: contato.cliente_id,
    cliente_nome: contato.cliente_nome || contato.nome_whatsapp || null,
    operador_nome: c.ctx.operador,
    status: 'aberto', subtotal: total, desconto: 0, total,
    observacao, validade: validadeAceita(corpo.validade, agora),
  }).select('id, numero').single()
  if (error || !orc) return NextResponse.json({ error: 'Não foi possível criar o orçamento.' }, { status: 500 })

  const { error: erroItens } = await supabase.from('orcamento_itens').insert(linhas.map(l => ({
    orcamento_id: orc.id, produto_id: l.p!.id, produto_nome: l.p!.nome, produto_sku: l.p!.sku ?? null,
    quantidade: l.i.quantidade, preco_unitario: l.preco, desconto: 0, total: r2(l.preco * l.i.quantidade),
  })))
  if (erroItens) {
    // Orçamento sem itens não pode ficar para trás.
    await supabase.from('orcamentos').delete().eq('id', orc.id).eq('empresa_id', empresaId)
    return NextResponse.json({ error: 'Não foi possível gravar os itens do orçamento.' }, { status: 500 })
  }

  const envio = await enviarOrcamentoNaConversa(supabase, { ...c.ctx, orcamentoId: orc.id })
  if (!envio.ok) return NextResponse.json({
    numero: orc.numero, criado: true,
    error: `Orçamento nº ${orc.numero} criado, mas não foi enviado: ${envio.erro}. Use "Reenviar" na ficha.`,
  }, { status: 502 })
  return NextResponse.json({ numero: orc.numero, total })
}
