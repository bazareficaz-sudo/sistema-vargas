import { avaliarPrecos } from '@/lib/precificacao/cenarios'
import { criarResolvedor } from '@/lib/precificacao/contexto'
import type { Cenario } from '@/lib/precificacao/cenarios'

// A ECONOMIA DE UM ITEM EM CAMPANHA.
//
// A pergunta "vale a pena colocar este produto nesta promoção?" é a MESMA
// pergunta de "vale a pena mudar o preço deste produto?": precisa de custo,
// comissão, frete, imposto e do piso de margem. Essa conta já existe e já
// roda no recálculo em massa.
//
// POR ISSO ESTE ARQUIVO NÃO CALCULA NADA. Ele resolve o contexto de cada
// anúncio e chama `avaliarPrecos` com os dois preços — o normal e o
// promocional. A especificação da Fase 4 foi explícita em não criar uma
// segunda matemática; se a margem da campanha fosse escrita à parte, no
// primeiro conserto as duas divergiriam e o mesmo item mostraria 10% numa
// tela e 34% na outra.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any

// O cliente do Supabase e `any` neste repositorio, entao as linhas voltam sem
// forma. Declarar aqui o que se usa evita `any` espalhado e faz o compilador
// cobrar quando uma coluna sair do select.
type AnuncioLinha = {
  id: string
  produto_id: string | null
  titulo?: string | null
  preco_venda?: number | null
  categoria_externa?: string | null
  tem_variacao?: boolean | null
  dados_brutos?: unknown
}
type ProdutoLinha = {
  id: string
  nome: string
  sku?: string | null
  tipo?: string | null
  preco_custo: number | null
  peso_kg?: number | null
  comprimento_cm?: number | null
  largura_cm?: number | null
  altura_cm?: number | null
}

export type ItemComEconomia = {
  itemId: string
  /** Nulo quando o item não casou com anúncio local — sem anúncio não há produto, nem custo. */
  anuncioId: string | null
  precoOriginal: number | null
  precoPromocional: number | null
  /** O cenário do preço NORMAL, quando dá para calcular. */
  normal: Cenario | null
  /** O cenário do preço PROMOCIONAL. */
  promocional: Cenario | null
  /** Por que não deu para calcular. Nulo quando deu. */
  semEconomia: string | null
  /** De onde vieram comissão e frete — medido ou suposto. */
  origem: { comissao: string; frete: string } | null
}

/**
 * Calcula a economia dos itens de uma campanha, em lote.
 *
 * UMA RESOLUÇÃO POR ANÚNCIO, não uma por preço: `criarResolvedor` guarda
 * config do canal, comissão por categoria e frete por embalagem dentro da
 * execução. Resolver duas vezes o mesmo anúncio (uma para o preço normal e
 * outra para o promocional) dobraria as consultas e poderia devolver números
 * diferentes se algo mudasse no meio.
 */
export async function economiaDosItens(
  sb: ClienteSupabase,
  empresaId: string,
  canal: { id: string; nome: string; plataforma: string; empresa_id?: string; seller_id?: string | number | null; access_token?: string | null; refresh_token?: string | null; token_expira_em?: string | null },
  itens: {
    id: string
    anuncio_id: string | null
    preco_original: number | string | null
    preco_promocional: number | string | null
    /**
     * Produto da VARIAÇÃO, quando ela tem um próprio.
     *
     * `marketplace_anuncio_variacoes.produto_id` esta preenchido em 49 das
     * 225 variacoes da Shp Ouro. Quando existe, o custo daquela variacao e
     * OUTRO — calcular pelo produto do anuncio daria o numero errado
     * justamente onde as variacoes diferem.
     */
    produto_id_override?: string | null
  }[],
): Promise<Map<string, ItemComEconomia>> {
  const saida = new Map<string, ItemComEconomia>()

  const anuncioIds = [...new Set(itens.map(i => i.anuncio_id).filter(Boolean))] as string[]
  if (anuncioIds.length === 0) {
    for (const i of itens) {
      saida.set(i.id, {
        itemId: i.id, anuncioId: null,
        precoOriginal: numero(i.preco_original), precoPromocional: numero(i.preco_promocional),
        normal: null, promocional: null, origem: null,
        semEconomia: 'Item não casou com anúncio do sistema — sem anúncio não há produto nem custo.',
      })
    }
    return saida
  }

  const { data: anuncios } = await sb.from('marketplace_anuncios')
    .select('id, canal_id, produto_id, id_externo, titulo, preco_venda, categoria_externa, tem_variacao, dados_brutos')
    .eq('empresa_id', empresaId).in('id', anuncioIds)

  const porAnuncio = new Map<string, AnuncioLinha>((anuncios ?? []).map((a: AnuncioLinha) => [a.id, a]))

  const produtoIds = [...new Set([
    ...(anuncios ?? []).map((a: AnuncioLinha) => a.produto_id),
    ...itens.map(i => i.produto_id_override),
  ].filter(Boolean))] as string[]
  const { data: produtos } = produtoIds.length
    ? await sb.from('produtos')
        .select('id, nome, sku, tipo, preco_custo, peso_kg, comprimento_cm, largura_cm, altura_cm')
        .eq('empresa_id', empresaId).in('id', produtoIds)
    : { data: [] }
  const porProduto = new Map<string, ProdutoLinha>((produtos ?? []).map((p: ProdutoLinha) => [p.id, p]))

  const resolvedor = criarResolvedor(sb, empresaId)

  for (const item of itens) {
    const base = {
      itemId: item.id, anuncioId: item.anuncio_id,
      precoOriginal: numero(item.preco_original),
      precoPromocional: numero(item.preco_promocional),
    }

    const anuncio = item.anuncio_id ? porAnuncio.get(item.anuncio_id) : null
    if (!anuncio) {
      saida.set(item.id, { ...base, normal: null, promocional: null, origem: null,
        semEconomia: 'Item não casou com anúncio do sistema.' })
      continue
    }
    // A VARIAÇÃO VENCE O ANÚNCIO quando tem produto próprio: é o custo dela
    // que vai para a conta.
    const produtoId = item.produto_id_override ?? anuncio.produto_id
    const produto = produtoId ? porProduto.get(produtoId) : null
    if (!produto) {
      // É a falta mais comum e a mais consequente: sem produto não há custo,
      // e sem custo margem nenhuma é calculável. Dizer isso é melhor que
      // mostrar 0%.
      saida.set(item.id, { ...base, normal: null, promocional: null, origem: null,
        semEconomia: 'Anúncio sem produto do catálogo vinculado — sem custo, não há margem.' })
      continue
    }
    if (!Number(produto.preco_custo)) {
      saida.set(item.id, { ...base, normal: null, promocional: null, origem: null,
        semEconomia: `Produto "${produto.nome}" sem custo cadastrado.` })
      continue
    }

    try {
      const ctx = await resolvedor.contexto({ canal: canal as never, produto, anuncio })
      const precos: { rotulo: string; preco: number }[] = []
      if (base.precoOriginal) precos.push({ rotulo: 'normal', preco: base.precoOriginal })
      if (base.precoPromocional) precos.push({ rotulo: 'promocional', preco: base.precoPromocional })

      const cenarios = avaliarPrecos(ctx.economia, precos)
      saida.set(item.id, {
        ...base,
        normal: cenarios.find(c => c.rotulo === 'normal') ?? null,
        promocional: cenarios.find(c => c.rotulo === 'promocional') ?? null,
        origem: { comissao: ctx.origemComissao, frete: ctx.origemFrete },
        semEconomia: null,
      })
    } catch (e) {
      saida.set(item.id, { ...base, normal: null, promocional: null, origem: null,
        semEconomia: `Não foi possível calcular: ${e instanceof Error ? e.message : 'erro'}` })
    }
  }

  return saida
}

function numero(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
