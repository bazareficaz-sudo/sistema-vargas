import { recalcularKitsQueUsam } from './kit'
import { notificarMovimentoProduto } from './monitoramento'

// Baixa de estoque de um item de pedido de marketplace. Evita o risco real
// de baixar duas vezes o mesmo item quando cron automático e botão manual
// podem rodar quase juntos. Sem worker/fila persistente nesta versão, a
// atomicidade vem de duas técnicas simples via supabase-js (sem stored
// procedure, fora do padrão do projeto):
//   - "reivindicar" o item com um UPDATE condicional em baixou_estoque
//     (WHERE baixou_estoque = false) — só um chamador consegue.
//   - decrementar o estoque com compare-and-swap (lê o valor, escreve de
//     volta com WHERE estoque = valor_lido) — se outro processo alterou o
//     valor no meio do caminho, a escrita afeta 0 linhas e tenta de novo.
// Deixa o estoque ir negativo de propósito (ver decrementarEstoqueAtomico)
// — pedido vendido sem saldo (overselling entre canais) reflete o estoque
// real em vez de ficar preso esperando alguém repor e clicar "Tentar
// novamente".

export type ResultadoBaixa = { ok: true; jaProcessado?: boolean } | { ok: false; motivo: string }

const PLATAFORMA_LABEL: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee' }

type ResultadoDecremento = { ok: true; estoqueAnterior: number; estoqueNovo: number } | { ok: false; motivo: string }

async function decrementarEstoqueAtomico(sb: any, produtoId: string, quantidade: number): Promise<ResultadoDecremento> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { data: produto } = await sb.from('produtos').select('estoque').eq('id', produtoId).single()
    if (!produto) return { ok: false, motivo: 'Produto não encontrado' }
    // Decide deixar ir negativo em vez de bloquear a baixa — pedido de
    // marketplace vendido sem saldo (overselling entre canais) não pode
    // ficar preso pra sempre esperando alguém notar e clicar "Tentar
    // novamente"; melhor refletir o estoque real (negativo) na hora.
    const estoqueNovo = produto.estoque - quantidade

    const { data: atualizado } = await sb.from('produtos')
      .update({ estoque: estoqueNovo })
      .eq('id', produtoId).eq('estoque', produto.estoque)
      .select('id').maybeSingle()
    if (atualizado) return { ok: true, estoqueAnterior: produto.estoque, estoqueNovo }
    // conflito de concorrência — outro processo alterou o estoque entre a leitura e a escrita; tenta de novo
  }
  return { ok: false, motivo: 'Conflito de concorrência ao atualizar estoque — tente novamente' }
}

async function incrementarEstoque(sb: any, produtoId: string, quantidade: number): Promise<void> {
  const { data: produto } = await sb.from('produtos').select('estoque').eq('id', produtoId).single()
  if (!produto) return
  await sb.from('produtos').update({ estoque: produto.estoque + quantidade }).eq('id', produtoId)
}

// Registra a baixa em estoque_movimentacoes com tipo próprio
// ('venda_marketplace') pra aparecer em "Estoque Detalhado" do produto —
// antes disso a baixa só mexia em produtos.estoque direto, sem deixar
// rastro nenhum de onde a quantidade tinha ido.
async function registrarMovimentoVendaMarketplace(sb: any, params: {
  empresaId: string; produtoId: string; quantidade: number
  estoqueAnterior: number; estoqueNovo: number; motivo: string; referenciaId: string
  clienteNome?: string | null
}): Promise<void> {
  const { data: produto } = await sb.from('produtos').select('nome, monitorar').eq('id', params.produtoId).maybeSingle()
  await sb.from('estoque_movimentacoes').insert({
    empresa_id: params.empresaId,
    produto_id: params.produtoId,
    produto_nome: produto?.nome ?? null,
    tipo: 'venda_marketplace',
    quantidade: params.quantidade,
    estoque_anterior: params.estoqueAnterior,
    estoque_novo: params.estoqueNovo,
    motivo: params.motivo,
    referencia_id: params.referenciaId,
    referencia_tipo: 'marketplace_pedido_item',
  })

  if (produto?.monitorar) {
    await notificarMovimentoProduto(sb, params.empresaId, {
      produtoId: params.produtoId,
      produtoNome: produto.nome,
      tipo: 'venda',
      quantidade: params.quantidade,
      estoqueAnterior: params.estoqueAnterior,
      estoqueNovo: params.estoqueNovo,
      quem: params.clienteNome,
      origem: params.motivo,
    })
  }
}

async function baixarComponentesKit(
  sb: any, kitProdutoId: string, quantidadePedido: number,
  contexto: { empresaId: string; motivo: string; referenciaId: string; clienteNome?: string | null }
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { data: itens } = await sb.from('kit_itens').select('produto_id, quantidade').eq('kit_id', kitProdutoId)
  if (!itens || itens.length === 0) return { ok: false, motivo: 'Kit sem componentes cadastrados' }

  const decrementados: { produtoId: string; quantidade: number }[] = []
  for (const item of itens) {
    // "Não controlar estoque" só afeta o cálculo do estoque disponível do
    // kit (calcularKit) — o componente continua sendo baixado e registrado
    // normalmente aqui, podendo ficar negativo, igual aos demais.
    const qtdNecessaria = item.quantidade * quantidadePedido
    const resultado = await decrementarEstoqueAtomico(sb, item.produto_id, qtdNecessaria)
    if (!resultado.ok) {
      for (const d of decrementados) await incrementarEstoque(sb, d.produtoId, d.quantidade)
      return { ok: false, motivo: `Componente sem estoque suficiente: ${resultado.motivo}` }
    }
    decrementados.push({ produtoId: item.produto_id, quantidade: qtdNecessaria })
    await registrarMovimentoVendaMarketplace(sb, {
      empresaId: contexto.empresaId, produtoId: item.produto_id, quantidade: qtdNecessaria,
      estoqueAnterior: resultado.estoqueAnterior, estoqueNovo: resultado.estoqueNovo,
      motivo: `${contexto.motivo} (componente de kit)`, referenciaId: contexto.referenciaId,
      clienteNome: contexto.clienteNome,
    })
  }

  for (const item of itens) await recalcularKitsQueUsam(sb, item.produto_id)
  return { ok: true }
}

export async function baixarEstoquePedidoItem(sb: any, pedidoItemId: string): Promise<ResultadoBaixa> {
  const { data: itemAtual } = await sb.from('marketplace_pedido_itens')
    .select('id, pedido_id, produto_id, quantidade, baixou_estoque, marketplace_pedidos(numero_pedido, empresa_id, cliente_nome, marketplace_canais(nome, plataforma))')
    .eq('id', pedidoItemId).single()
  if (!itemAtual) return { ok: false, motivo: 'Item do pedido não encontrado' }
  if (itemAtual.baixou_estoque) return { ok: true, jaProcessado: true }
  if (!itemAtual.produto_id) return { ok: false, motivo: 'Item sem produto vinculado' }

  const pedido = Array.isArray(itemAtual.marketplace_pedidos) ? itemAtual.marketplace_pedidos[0] : itemAtual.marketplace_pedidos
  const canal = Array.isArray(pedido?.marketplace_canais) ? pedido.marketplace_canais[0] : pedido?.marketplace_canais
  const empresaId = pedido?.empresa_id
  const motivo = `Pedido ${PLATAFORMA_LABEL[canal?.plataforma] ?? canal?.plataforma ?? 'marketplace'} #${pedido?.numero_pedido ?? '—'} — ${canal?.nome ?? 'canal'}`

  // Reivindica atomicamente — se outro processo já setou baixou_estoque=true
  // entre a leitura acima e agora, este UPDATE não afeta nenhuma linha.
  const { data: claim } = await sb.from('marketplace_pedido_itens')
    .update({ baixou_estoque: true })
    .eq('id', pedidoItemId).eq('baixou_estoque', false)
    .select('id').maybeSingle()
  if (!claim) return { ok: true, jaProcessado: true }

  const { data: produto } = await sb.from('produtos').select('id, tipo').eq('id', itemAtual.produto_id).single()
  if (!produto) {
    await sb.from('marketplace_pedido_itens').update({ baixou_estoque: false }).eq('id', pedidoItemId)
    return { ok: false, motivo: 'Produto vinculado não encontrado' }
  }

  let resultado: { ok: true } | { ok: false; motivo: string }
  if (produto.tipo === 'kit') {
    resultado = await baixarComponentesKit(sb, produto.id, itemAtual.quantidade, { empresaId, motivo, referenciaId: pedidoItemId, clienteNome: pedido?.cliente_nome })
  } else {
    const decremento = await decrementarEstoqueAtomico(sb, produto.id, itemAtual.quantidade)
    if (decremento.ok) {
      await registrarMovimentoVendaMarketplace(sb, {
        empresaId, produtoId: produto.id, quantidade: itemAtual.quantidade,
        estoqueAnterior: decremento.estoqueAnterior, estoqueNovo: decremento.estoqueNovo,
        motivo, referenciaId: pedidoItemId, clienteNome: pedido?.cliente_nome,
      })
    }
    resultado = decremento
  }

  if (!resultado.ok) {
    await sb.from('marketplace_pedido_itens').update({ baixou_estoque: false }).eq('id', pedidoItemId)
    await sb.from('marketplace_pedidos')
      .update({ etapa_interna: 'com_pendencia', pendencia_motivo: resultado.motivo })
      .eq('id', itemAtual.pedido_id)
    return { ok: false, motivo: resultado.motivo }
  }

  return { ok: true }
}
