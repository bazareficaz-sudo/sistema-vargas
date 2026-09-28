// Taxa de acerto de compra — de cada produto comprado numa entrada de
// mercadoria, quanto já foi vendido depois. Responde "essa reposição foi
// bem dimensionada, ou ficou parada no estoque?".
//
// O sistema não rastreia lote (ver decisão registrada na conversa que
// originou este arquivo: rastrear lote exigiria reescrever todo ponto que
// mexe em estoque, pra um ganho que na prática não muda a resposta). Em
// vez disso, aproxima por FIFO: conta as vendas do produto entre a data
// desta entrada e a data da PRÓXIMA entrada do mesmo produto — a que vier
// primeiro, hoje ou a próxima compra. É o corte mais razoável sem lote.
//
// SEM EMBEDS (`tabela!inner(...)`) de propósito. `venda_itens -> vendas`
// já é documentado como não confiável nesta base (ver o mesmo cuidado em
// EstoqueDetalhadoModal.tsx: "o relacionamento não é reconhecido pelo
// PostgREST"); por segurança, `entrada_itens -> entradas` e
// `nfe_itens -> nfe_entradas` seguem a mesma regra aqui. Sempre duas
// consultas simples + Map em JS, nunca um join do PostgREST.
//
// Pelo mesmo motivo, as vendas são lidas direto de `venda_itens` (que tem
// seu próprio `created_at`) filtrando por produto_id — nunca juntando via
// uma lista de `venda_id`: com centenas/milhares de vendas no período, um
// `.in('venda_id', idsMuitoGrande)` ou estoura o tamanho de URL do
// PostgREST ou esbarra no teto de 1.000 linhas por resposta, calado (ver
// `src/lib/supabase/paginar.ts`) — foi exatamente isso que zerava a taxa
// de acerto em produtos com muita venda no período. `buscarTudo()` evita
// as duas coisas.

import { buscarTudo } from '@/lib/supabase/paginar'

export type TaxaAcertoItem = {
  produtoId: string
  quantidadeComprada: number
  quantidadeVendida: number
  /** null só quando quantidadeComprada é 0 (não dá pra calcular %). */
  percentual: number | null
  /** Até quando a venda contou — a próxima entrada do produto, ou agora. */
  dataCorte: string
  temProximaEntrada: boolean
}

/**
 * `itens`: os itens DESTA entrada (produto_id + quantidade já resolvida —
 * ver a cascata `qtd_conferida || quantidade_entrada || quantidade_xml`
 * usada pela entrada XML na hora de finalizar, e `quantidade` na manual).
 * `dataEntrada`: quando o estoque desta entrada de fato entrou
 * (`entradas.data_entrada` na manual, `nfe_entradas.data_finalizacao` na
 * XML) — nunca a data de emissão da nota, que pode divergir bastante.
 */
export async function calcularTaxaAcertoEntrada(
  sb: any,
  empresaId: string,
  itens: { produtoId: string; quantidade: number }[],
  dataEntrada: string,
): Promise<TaxaAcertoItem[]> {
  const produtoIds = [...new Set(itens.map(i => i.produtoId))].filter(Boolean)
  if (produtoIds.length === 0) return []

  // 1. Próxima entrada de cada produto, nas duas origens, depois desta data.
  //    Primeiro os itens (produto_id -> id da entrada), depois as entradas
  //    em si (id -> data) — nunca um embed direto.
  const [{ data: itensManuais }, { data: itensXml }] = await Promise.all([
    sb.from('entrada_itens').select('produto_id, entrada_id').in('produto_id', produtoIds),
    sb.from('nfe_itens').select('produto_id, entrada_id').in('produto_id', produtoIds),
  ])

  const idsEntradasManuais = [...new Set((itensManuais ?? []).map((r: any) => r.entrada_id).filter(Boolean))]
  const idsEntradasXml = [...new Set((itensXml ?? []).map((r: any) => r.entrada_id).filter(Boolean))]

  const [{ data: entradasManuais }, { data: entradasXml }] = await Promise.all([
    idsEntradasManuais.length
      ? sb.from('entradas').select('id, data_entrada').eq('empresa_id', empresaId).in('id', idsEntradasManuais)
      : Promise.resolve({ data: [] as any[] }),
    idsEntradasXml.length
      ? sb.from('nfe_entradas').select('id, data_finalizacao').eq('empresa_id', empresaId).eq('status', 'finalizada').in('id', idsEntradasXml)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const dataDaEntradaManual = new Map<string, string>((entradasManuais ?? []).map((e: any) => [e.id, e.data_entrada]))
  const dataDaEntradaXml = new Map<string, string>((entradasXml ?? []).map((e: any) => [e.id, e.data_finalizacao]))

  const proximaPorProduto = new Map<string, string>()
  const registrarSeFutura = (produtoId: string, data: string | undefined | null) => {
    if (!data || data <= dataEntrada) return
    const atual = proximaPorProduto.get(produtoId)
    if (!atual || data < atual) proximaPorProduto.set(produtoId, data)
  }
  for (const r of (itensManuais ?? []) as any[]) registrarSeFutura(r.produto_id, dataDaEntradaManual.get(r.entrada_id))
  for (const r of (itensXml ?? []) as any[]) registrarSeFutura(r.produto_id, dataDaEntradaXml.get(r.entrada_id))

  // 2. Vendas destes produtos desde esta entrada — direto em `venda_itens`
  //    (produto_id + created_at próprios, sem passar por `vendas`), pagina
  //    com buscarTudo() pra nunca perder linha calado.
  const itensVendidos = await buscarTudo<{ produto_id: string; quantidade: number; tipo: string; created_at: string }>(
    (de, ate) => sb.from('venda_itens')
      .select('produto_id, quantidade, tipo, created_at')
      .in('produto_id', produtoIds)
      .gte('created_at', dataEntrada)
      .order('id')
      .range(de, ate),
    { rotulo: 'taxaAcertoEntrada' },
  )

  const agora = new Date().toISOString()
  const vendidoPorProduto = new Map<string, number>()
  for (const vi of itensVendidos) {
    const dataCorte = proximaPorProduto.get(vi.produto_id) ?? agora
    if (vi.created_at > dataCorte) continue
    const delta = vi.tipo === 'devolucao' ? -Math.abs(vi.quantidade) : vi.quantidade
    vendidoPorProduto.set(vi.produto_id, (vendidoPorProduto.get(vi.produto_id) ?? 0) + delta)
  }

  return itens.map(i => {
    const vendida = Math.max(0, vendidoPorProduto.get(i.produtoId) ?? 0)
    return {
      produtoId: i.produtoId,
      quantidadeComprada: i.quantidade,
      quantidadeVendida: vendida,
      percentual: i.quantidade > 0 ? (vendida / i.quantidade) * 100 : null,
      dataCorte: proximaPorProduto.get(i.produtoId) ?? agora,
      temProximaEntrada: proximaPorProduto.has(i.produtoId),
    }
  })
}
