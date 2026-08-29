import { buscarConfigUnificacao, estoqueUnificadoDeProdutos } from '@/lib/produtos/estoqueUnificado'
import { estoqueDoSistema } from '@/lib/marketplace/estoqueDoSistema'
import { buscarTudo } from '@/lib/supabase/paginar'
import { sinalDeEstoque, type EntradaVendas, type SinalEstoque } from './sinais'

// BUSCA EM LOTE DOS SINAIS COMERCIAIS — a camada de I/O de `sinais.ts`.
//
// `sinais.ts` é puro e não sabe que banco existe. Este arquivo é o oposto: só
// busca, não decide nada. A separação é a mesma de `contexto.ts` e
// `cenarios.ts`, e existe pelo mesmo motivo — a regra de negócio precisa ser
// testável sem banco.
//
// TUDO EM LOTE, NUNCA POR LINHA. A tela de recálculo pode listar centenas de
// anúncios; uma consulta de estoque por anúncio e uma de vendas por anúncio
// seriam N+1 duas vezes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any

/**
 * Estoque comercialmente disponível de vários produtos.
 *
 * Usa exatamente o mesmo caminho que `lib/marketplace/fila.ts` usa para
 * decidir o que enviar ao canal: `estoqueDoSistema` mais o estoque unificado
 * do grupo QUANDO ele estiver explicitamente ligado. Não soma grupo por conta
 * própria — a autorização mora em `empresa_config_estoque` e em
 * `estoque_unificado_participantes`.
 *
 * Falha de consulta devolve mapa vazio, e o sinal vira "desconhecido" em vez
 * de zero: estoque desconhecido e estoque zerado levam a decisões opostas.
 */
export async function estoquePorProduto(
  sb: ClienteSupabase,
  empresaId: string,
  produtos: { id: string; estoque: number | null; tipo: string | null }[],
): Promise<Map<string, SinalEstoque>> {
  const mapa = new Map<string, SinalEstoque>()
  if (produtos.length === 0) return mapa

  try {
    const cfg = await buscarConfigUnificacao(sb, empresaId)
    const unificado = await estoqueUnificadoDeProdutos(sb, empresaId, produtos.map(p => p.id), cfg)

    for (const p of produtos) {
      const r = await estoqueDoSistema(sb, p, unificado)
      mapa.set(p.id, sinalDeEstoque(
        r.estoque,
        r.origem.includes('unificado') ? 'unificado' : 'sistema',
      ))
    }
  } catch {
    // Sem estoque apurado, o sinal fica desconhecido e as recomendações que
    // dependem dele simplesmente não aparecem. Nenhuma delas chuta.
    return new Map()
  }
  return mapa
}

/** Janela padrão de vendas. Trinta dias é o que a cobertura precisa para virar ritmo. */
export const JANELA_VENDAS_DIAS = 30

/**
 * Unidades vendidas por anúncio numa janela, com o que a análise de ritmo
 * precisa para desconfiar de si mesma: quantos pedidos, e qual o maior.
 *
 * Pedido cancelado não conta — venda desfeita não é venda.
 *
 * A agregação é feita aqui em JavaScript, e não no PostgREST, porque este
 * projeto responde PGRST123 a agregação (registrado no commit dos relatórios).
 * Por isso a leitura passa por `buscarTudo`: cem anúncios em trinta dias
 * passam de 1.000 linhas sem esforço, e o corte silencioso do PostgREST viraria
 * um ritmo menor que o real — exatamente o tipo de erro que faz o sistema
 * recomendar desconto em item que está vendendo bem.
 */
export async function vendasPorAnuncio(
  sb: ClienteSupabase,
  empresaId: string,
  anuncioIds: string[],
  opcoes: { dias?: number; agora?: Date } = {},
): Promise<Map<string, EntradaVendas>> {
  const dias = opcoes.dias ?? JANELA_VENDAS_DIAS
  const mapa = new Map<string, EntradaVendas>()
  if (anuncioIds.length === 0) return mapa

  const desde = new Date((opcoes.agora ?? new Date()).getTime() - dias * 86_400_000).toISOString()

  let linhas: { anuncio_id: string; pedido_id: string; quantidade: number }[]
  try {
    linhas = await buscarTudo<{ anuncio_id: string; pedido_id: string; quantidade: number }>(
      (de, ate) => sb
        .from('marketplace_pedido_itens')
        .select('anuncio_id, pedido_id, quantidade, marketplace_pedidos!inner(empresa_id, data_pedido, status)')
        .in('anuncio_id', anuncioIds)
        .eq('marketplace_pedidos.empresa_id', empresaId)
        .gte('marketplace_pedidos.data_pedido', desde)
        .neq('marketplace_pedidos.status', 'cancelado')
        .order('id')
        .range(de, ate),
      { rotulo: 'itens de pedido para a velocidade de venda' },
    )
  } catch {
    // Sem dados de venda, a cobertura fica desconhecida e as recomendações
    // que dependem dela não aparecem.
    return new Map()
  }

  // Agrupa por anúncio, contando pedidos distintos e o maior deles — os dois
  // números que permitem a `sinais.ts` dizer "isto é evento, não ritmo".
  const porAnuncio = new Map<string, { unidades: number; pedidos: Set<string>; porPedido: Map<string, number> }>()
  for (const l of linhas) {
    if (!l.anuncio_id) continue
    const atual = porAnuncio.get(l.anuncio_id)
      ?? { unidades: 0, pedidos: new Set<string>(), porPedido: new Map<string, number>() }
    const q = Math.max(0, Number(l.quantidade) || 0)
    atual.unidades += q
    atual.pedidos.add(l.pedido_id)
    atual.porPedido.set(l.pedido_id, (atual.porPedido.get(l.pedido_id) ?? 0) + q)
    porAnuncio.set(l.anuncio_id, atual)
  }

  // Anúncio SEM linha nenhuma na janela não some do mapa: "não vendeu" é uma
  // informação, e diferente de "não sei". Sem isto, um item parado ficaria
  // indistinguível de um item sem dados.
  for (const id of anuncioIds) {
    const a = porAnuncio.get(id)
    mapa.set(id, a
      ? {
          unidades: a.unidades,
          dias,
          pedidos: a.pedidos.size,
          maiorPedido: Math.max(0, ...a.porPedido.values()),
        }
      : { unidades: 0, dias, pedidos: 0, maiorPedido: 0 })
  }

  return mapa
}
