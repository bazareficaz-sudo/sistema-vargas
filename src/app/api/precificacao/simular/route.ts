import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { criarResolvedor, descreverOrigem, COLUNAS_ANUNCIO, COLUNAS_CANAL, COLUNAS_PRODUTO } from '@/lib/precificacao/contexto'
import { precificarPorObjetivo } from '@/lib/precificacao/cenarios'
import { simularCenarioPromocional } from '@/lib/precificacao/estrategia'
import { sugerirFaixas, avaliarFaixas, cabeAtacado, type FaixaQuantidade } from '@/lib/precificacao/quantidade'
import { capacidadesDoCanal, explicarPublicacao } from '@/lib/precificacao/capacidades'
import { buscarRegras, resolverRegra } from '@/lib/precificacao/regras'
import type { Margens } from '@/lib/precificacao/margens'
import type { Objetivo } from '@/lib/precificacao/tipos'

// Simulação e comparação entre canais.
//
// A mesma rota serve às duas telas: passando um canal, é simulação; passando
// vários, é o comparador lado a lado. Assim não existem duas contas
// diferentes pro mesmo número.
//
// FASE 1 — o que mudou aqui:
//
// A rota recebia `categoriaML` no corpo para poder consultar a comissão real
// do Mercado Livre, e NENHUM cliente enviava esse campo. Resultado: o ramo da
// API era inalcançável e a simulação sempre usava a tabela configurada,
// avisando que usava. O parâmetro saiu; a categoria agora vem do anúncio que
// o produto tem naquele canal (`categoria_externa`), pelo mesmo caminho que o
// recálculo em massa usa. Produto ainda sem anúncio continua caindo na
// tabela — e o aviso continua dizendo isso.
//
// Pelo mesmo motivo a simulação passou a enxergar o frete real do ML, que
// antes só existia no recálculo.

export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json()
  const { produtoId, custoManual, objetivo, canaisIds, precoCandidato, descontoPercentual } = body as {
    produtoId?: string
    custoManual?: number
    objetivo: Objetivo
    canaisIds?: string[]
    /** Cenário promocional: um preço candidato... */
    precoCandidato?: number
    /** ...ou um desconto sobre o preço que o objetivo produziu. */
    descontoPercentual?: number
    /** Preço por quantidade: pedir sugestão de faixas. */
    sugerirQuantidade?: boolean
    /** Quantidades das faixas. Sugestão de UI, não regra universal. */
    quantidades?: number[]
    /** Faixas já escolhidas pelo operador, para avaliar em vez de sugerir. */
    faixas?: FaixaQuantidade[]
  }

  if (!objetivo?.tipo) return NextResponse.json({ ok: false, erro: 'Objetivo não informado' }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Custo: do produto (ou do kit, somando componentes) ou digitado à mão —
  // quem decide isso é o resolvedor de contexto, não esta rota.
  let produto: any = null
  if (produtoId) {
    const { data: p } = await sb.from('produtos').select(COLUNAS_PRODUTO)
      .eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
    if (!p) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })
    produto = p
  }
  if (!produto && !(Number(custoManual) > 0)) {
    return NextResponse.json({ ok: false, erro: 'Informe o produto ou o custo' }, { status: 400 })
  }

  let query = sb.from('marketplace_canais').select(COLUNAS_CANAL).eq('empresa_id', guarda.empresaId)
  if (canaisIds?.length) query = query.in('id', canaisIds)
  const { data: canais } = await query.order('nome')

  if (!canais?.length) return NextResponse.json({ ok: false, erro: 'Nenhum canal encontrado' }, { status: 404 })

  // O anúncio que este produto já tem em cada canal. É dele que saem a
  // categoria do ML (para a comissão) e as medidas da embalagem (para o
  // frete) — os dois dados que faziam a simulação divergir do recálculo.
  const anuncioPorCanal = new Map<string, any>()
  if (produto) {
    const { data: anuncios } = await sb.from('marketplace_anuncios').select(COLUNAS_ANUNCIO)
      .eq('produto_id', produto.id).eq('empresa_id', guarda.empresaId)
    for (const a of anuncios ?? []) anuncioPorCanal.set(a.canal_id, a)
  }

  // Cenário promocional só é montado quando pedido. As margens da política
  // vêm da regra que venceria para este produto neste canal; sem regra, o
  // alvo é a própria margem que o objetivo simulado produz — assim o
  // simulador continua respondendo mesmo antes de existir política cadastrada.
  const querCenario = Number(precoCandidato) > 0 || Number(descontoPercentual) > 0
  const querFaixas = !!body.sugerirQuantidade || (Array.isArray(body.faixas) && body.faixas.length > 0)
  // As margens da política vêm da regra; só busca quando alguma das duas
  // perguntas depende delas.
  const regras = (querCenario || querFaixas) && produto ? await buscarRegras(sb, guarda.empresaId) : []

  const resolvedor = criarResolvedor(sb, guarda.empresaId)
  const resultados = []
  let custoUsado = 0

  for (const canal of canais) {
    const ctx = await resolvedor.contexto({
      canal, produto, anuncio: anuncioPorCanal.get(canal.id) ?? null, custoManual,
    })

    if (!(ctx.economia.custo > 0)) {
      return NextResponse.json({
        ok: false,
        erro: produto
          ? `O produto "${produto.nome}" não tem custo cadastrado — sem custo não há como calcular margem.`
          : 'Informe o custo do produto',
      }, { status: 400 })
    }
    custoUsado = ctx.economia.custo

    const cenario = precificarPorObjetivo(ctx.economia, objetivo)

    // A política deste produto neste canal, usada tanto pelo cenário
    // promocional quanto pelas faixas de quantidade.
    const vencedora = produto && (querCenario || querFaixas)
      ? resolverRegra(regras, { id: produto.id, categoria: produto.categoria, marca: produto.marca }, canal).vencedora
      : null
    const margens: Margens = {
      alvo: Number(cenario.resultado.margemLiquida.toFixed(2)),
      promocionalMinima: vencedora?.margemPromocionalMinima ?? null,
      piso: vencedora?.margemMinima ?? null,
    }

    let promocional = null
    if (querCenario && cenario.resultado.preco > 0) {
      promocional = simularCenarioPromocional({
        economia: ctx.economia, margens,
        precoBase: cenario.resultado.preco,
        precoCandidato: Number(precoCandidato) > 0 ? Number(precoCandidato) : undefined,
        descontoPercentual: Number(descontoPercentual) > 0 ? Number(descontoPercentual) : undefined,
      })
    }

    // ── Preço por quantidade ──
    //
    // Nenhuma consulta nova: a economia deste canal já está resolvida, e cada
    // faixa é avaliada pelo mesmo motor, na quantidade dela — que é o que faz
    // o frete do pedido ser rateado.
    let quantidade = null
    if (querFaixas && cenario.resultado.preco > 0) {
      const capacidade = capacidadesDoCanal(canal.plataforma, {
        temCredencial: !!canal.access_token,
      }).precoQuantidadeEscrita

      const escolhidas = Array.isArray(body.faixas) && body.faixas.length > 0
        ? { faixas: body.faixas as FaixaQuantidade[], criterio: "faixas informadas", avisos: [] as string[] }
        : null

      const sugestao = escolhidas
        ? { ...escolhidas, avaliadas: avaliarFaixas(ctx.economia, margens, escolhidas.faixas, cenario.resultado.preco) }
        : sugerirFaixas(ctx.economia, margens, { quantidades: body.quantidades })

      quantidade = {
        ...sugestao,
        margens,
        cabe: cabeAtacado(ctx.economia, margens),
        // Estratégia CALCULADA e estratégia PUBLICÁVEL são coisas
        // diferentes: a tela mostra as duas, e não esconde a primeira
        // porque a segunda ainda não existe.
        capacidadePublicacao: capacidade,
        explicacaoPublicacao: explicarPublicacao(capacidade),
      }
    }

    resultados.push({
      canal: { id: canal.id, nome: canal.nome, plataforma: canal.plataforma },
      origemConfig: ctx.origemConfig,
      origemComissao: ctx.origemComissao,
      origemFrete: ctx.origemFrete,
      origem: descreverOrigem(ctx),
      regime: cenario.resultado.regime,
      resultado: { ...cenario.resultado, avisos: [...cenario.resultado.avisos, ...ctx.avisos] },
      saude: cenario.saude,
      precoAtual: ctx.precos?.efetivo ?? null,
      precos: ctx.precos,
      promocional,
      quantidade,
    })
  }

  return NextResponse.json({
    ok: true,
    produto: produto ? { id: produto.id, nome: produto.nome, sku: produto.sku, precoVenda: produto.preco_venda } : null,
    custo: custoUsado,
    resultados,
  })
}
