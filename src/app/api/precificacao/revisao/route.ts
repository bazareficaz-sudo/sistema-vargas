import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { criarResolvedor, COLUNAS_CANAL, COLUNAS_PRODUTO, COLUNAS_ANUNCIO,
         type CanalPrecificacao, type AnuncioPrecificacao } from '@/lib/precificacao/contexto'
import { avaliarPreco } from '@/lib/precificacao/cenarios'
import { resolverRegra, buscarRegras } from '@/lib/precificacao/regras'
import { revisarDecisao, ordenarFila, type RevisaoDecisao } from '@/lib/precificacao/revisao'

// FILA DE REVISÃO — as decisões de preço já aplicadas ainda valem?
//
// Lê `precificacao_historico` e recalcula cada preço aplicado com o motor de
// hoje. Existe porque o ciclo era aberto: recomendava, aplicava, gravava, e
// nada nunca voltava para conferir.
//
// SÓ LEITURA. Nenhum preço é alterado aqui — a fila diz o que revisar; quem
// decide o que fazer é o operador, na tela de recálculo.
//
// A PLATAFORMA DECIDE SE A REVISÃO VALE. No Mercado Livre o frete é medido na
// API; revisar um anúncio cujo frete continua vindo da configuração seria
// comparar a mesma suposição consigo mesma e concluir "não mudou nada" — uma
// confirmação falsa. Na Shopee não existe medição de frete nenhuma, então a
// configuração é o que há, e a revisão diz isso na cara.

export const maxDuration = 60

/** Plataformas em que o frete do anúncio é medido, não declarado. */
const MEDE_FRETE = new Set(['mercadolivre'])

type ProdutoDoAnuncio = {
  id: string
  sku?: string | null
  categoria?: string | null
  marca?: string | null
}

type AnuncioComProduto = AnuncioPrecificacao & {
  produtos?: ProdutoDoAnuncio | ProdutoDoAnuncio[] | null
}

/**
 * O produto embutido no anúncio, venha ele como objeto ou como array.
 *
 * O tipo gerado do Supabase diz array — a relação é declarada para-muitos no
 * schema —, mas em tempo de execução, sendo para-um, vem objeto. As duas
 * formas são tratadas porque forçar o tipo escondia a diferença: no dia em que
 * a relação mudasse, o código quebraria em produção em vez de no build.
 */
function produtoDoAnuncio(a: AnuncioComProduto): ProdutoDoAnuncio | null {
  const p = a.produtos
  if (!p) return null
  return Array.isArray(p) ? (p[0] ?? null) : p
}

export async function POST(req: Request) {
  const { limite } = await req.json().catch(() => ({})) as { limite?: number }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // O histórico mais recente de cada anúncio. Revisar a decisão de julho de um
  // anúncio que já foi reprecificado em agosto seria discutir um preço que não
  // está mais no ar.
  const { data: historico } = await sb.from('precificacao_historico')
    .select('id, anuncio_id, canal_id, produto_id, preco_novo, margem_nova, custo_no_momento, regra_id, regra_nome, created_at')
    .eq('empresa_id', guarda.empresaId)
    .order('created_at', { ascending: false })
    .limit(Math.min(limite ?? 300, 500))

  if (!historico?.length) {
    return NextResponse.json({ ok: true, itens: [], resumo: { total: 0 }, semHistorico: true })
  }

  const maisRecente = new Map<string, typeof historico[number]>()
  for (const h of historico) {
    if (h.anuncio_id && !maisRecente.has(h.anuncio_id)) maisRecente.set(h.anuncio_id, h)
  }

  const resolvedor = criarResolvedor(sb, guarda.empresaId)
  const regras = await buscarRegras(sb, guarda.empresaId)

  const anuncioIds = [...maisRecente.keys()]
  const { data: anuncios } = await sb.from('marketplace_anuncios')
    .select(`${COLUNAS_ANUNCIO}, produtos(${COLUNAS_PRODUTO})`)
    .in('id', anuncioIds).eq('empresa_id', guarda.empresaId)
  const anuncioPorId = new Map<string, AnuncioComProduto>(
    ((anuncios ?? []) as unknown as AnuncioComProduto[]).map(a => [a.id, a]))

  const canalIds = [...new Set(historico.map(h => h.canal_id).filter(Boolean))]
  const { data: canais } = await sb.from('marketplace_canais')
    .select(COLUNAS_CANAL).in('id', canalIds).eq('empresa_id', guarda.empresaId)
  const canalPorId = new Map<string, CanalPrecificacao>(
    ((canais ?? []) as CanalPrecificacao[]).map(c => [c.id, c]))

  const itens: {
    historicoId: string; anuncioId: string; titulo: string; sku: string | null
    canal: string; plataforma: string; aplicadoEm: string; precoAplicado: number
    precoHoje: number | null; regra: string | null; revisao: RevisaoDecisao
  }[] = []
  const naoRevisados: { motivo: string; quantos: number }[] = []
  const contar = (motivo: string) => {
    const achado = naoRevisados.find(n => n.motivo === motivo)
    if (achado) achado.quantos++
    else naoRevisados.push({ motivo, quantos: 1 })
  }

  for (const h of maisRecente.values()) {
    const anuncio = anuncioPorId.get(h.anuncio_id)
    const canal = canalPorId.get(h.canal_id)
    if (!anuncio || !canal) { contar('Anúncio ou canal não existe mais'); continue }

    const produto = produtoDoAnuncio(anuncio)
    if (!produto) { contar('Anúncio perdeu o vínculo com o produto'); continue }

    const ctx = await resolvedor.contexto({ canal, produto, anuncio })
    if (!(ctx.economia.custo > 0)) { contar('Produto sem custo cadastrado hoje'); continue }

    // OS DOIS RECÁLCULOS, e a diferença entre eles é o ponto.
    //
    // `comPremissasDeHoje` usa o custo DA ÉPOCA com o que se sabe hoje sobre
    // comissão e frete: isola o tamanho do engano.
    // `comCustoDeHoje` usa tudo de hoje: diz onde o preço está agora.
    const custoDaEpoca = Number(h.custo_no_momento ?? 0)
    const comPremissasDeHoje = custoDaEpoca > 0
      ? avaliarPreco({ ...ctx.economia, custo: custoDaEpoca }, Number(h.preco_novo), 'premissas de hoje, custo da época')
      : null
    const comCustoDeHoje = avaliarPreco(ctx.economia, Number(h.preco_novo), 'tudo de hoje')

    if (!comPremissasDeHoje) { contar('Histórico sem o custo da época gravado'); continue }

    const regra = resolverRegra(regras, {
      id: produto.id, categoria: produto.categoria ?? null, marca: produto.marca ?? null,
    }, canal).vencedora

    const revisao = revisarDecisao({
      margemRegistrada: Number(h.margem_nova ?? 0),
      precoAplicado: Number(h.preco_novo),
      comPremissasDeHoje,
      comCustoDeHoje,
      origemFrete: ctx.origemFrete,
      // O piso da politica chama-se `margemMinima` na regra — e um limite
      // economico absoluto, nao um alvo (ver o comentario em regras.ts).
      piso: regra?.margemMinima ?? null,
      plataformaTemFreteMedido: MEDE_FRETE.has(canal.plataforma),
    })

    itens.push({
      historicoId: h.id,
      anuncioId: h.anuncio_id,
      titulo: anuncio.titulo ?? '(sem título)',
      sku: produto.sku ?? null,
      canal: canal.nome,
      plataforma: canal.plataforma,
      aplicadoEm: h.created_at,
      precoAplicado: Number(h.preco_novo),
      // O preço que está no anúncio AGORA. Se mudou desde a aplicação, a
      // decisão revisada pode nem estar mais no ar.
      precoHoje: anuncio.preco_venda != null ? Number(anuncio.preco_venda) : null,
      regra: h.regra_nome ?? null,
      revisao,
    })
  }

  const ordenados = ordenarFila(itens)
  const porVeredito = ordenados.reduce<Record<string, number>>((acc, i) => {
    acc[i.revisao.veredito] = (acc[i.revisao.veredito] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    ok: true,
    itens: ordenados,
    resumo: {
      decisoesNoHistorico: historico.length,
      anunciosDistintos: maisRecente.size,
      revisados: ordenados.length,
      porVeredito,
      // Quanto se perde por unidade vendida, somando só os que dão prejuízo.
      prejuizoPorUnidade: Number(ordenados
        .filter(i => i.revisao.veredito === 'prejuizo')
        .reduce((s, i) => s + Math.abs(i.revisao.lucroCorrigido ?? 0), 0).toFixed(2)),
    },
    // O que NÃO entrou na fila, e por quê. Uma fila que só mostra o que
    // conseguiu revisar faz o resto parecer revisado e aprovado.
    naoRevisados,
  })
}
