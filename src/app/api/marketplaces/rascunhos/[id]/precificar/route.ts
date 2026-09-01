import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { calcularPrecoEstoquePorRegra, type RegraCalculo } from '@/lib/shopee/aplicarRegra'
import { calcularKit } from '@/lib/produtos/kit'
import { criarResolvedor } from '@/lib/precificacao/contexto'
import { avaliarPreco, precificarPorObjetivo } from '@/lib/precificacao/cenarios'
import { descreverOrigem } from '@/lib/precificacao/contexto'
import type { ArredondamentoPreco } from '@/lib/precificacao/tipos'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Preço e estoque do rascunho a partir das regras que a empresa já tem
// cadastradas — as mesmas usadas hoje pelos anúncios reais e pela
// sincronização automática.
//
// A rota só CALCULA e devolve. Aplicar é decisão do operador na tela: uma
// regra pode dar preço abaixo do custo (regra mal configurada, produto sem
// custo), e isso precisa ser visto antes de virar preço de anúncio.
//
// ── POR QUE O PREÇO NÃO SAI MAIS DE `calcularPrecoEstoquePorRegra` ────────
//
// Medido em 01/09/2026, neste sistema: as quatro regras cadastradas estavam
// em `shopee_liquido`, INCLUSIVE as dos dois canais de Mercado Livre. Os
// quatro canais devolviam o mesmo R$ 13,01 para o mesmo produto — o que já
// era o sintoma, porque Shopee e ML não cobram a mesma coisa.
//
// A conta que produzia esse número era a da Shopee: 20% de comissão + R$ 4,00
// de taxa fixa. O Mercado Livre, na categoria medida, cobra 11,5% e NENHUMA
// taxa fixa — cobra frete, que na faixa daquele preço foi medido em R$ 6,95.
// Trocar um custo de R$ 4,00 por um de R$ 6,95 sem avisar levava o anúncio
// para o prejuízo:
//
//   receita 13,01 − comissão 1,50 − imposto 0,65 − frete 6,95 − custo 4,80
//   = −0,89 por venda.
//
// O sistema tinha DUAS matemáticas: esta, herdada da Shopee, e o motor de
// `src/lib/precificacao/`, que mede comissão e frete na API do ML e já roda
// nos anúncios publicados. Esta tela chamava a fraca.
//
// Agora o PREÇO vem do motor, com a configuração real de cada canal (que já
// existia e já estava correta). A REGRA continua mandando: ela diz qual é o
// objetivo — o motor diz quanto custa alcançá-lo naquele canal.
//
// O ESTOQUE continua em `calcularPrecoEstoquePorRegra`: depósito, estoque
// complementar e estoque de risco não têm nada a ver com economia, e a
// função que os resolve funciona.

type RegraLinha = RegraCalculo & {
  id: string
  nome: string
  canal_id: string
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: rascunho, error } = await sb
    .from('anuncio_rascunhos')
    .select('id, produto_id, preco_origem, dados_editados, dados_origem, origem_id_externo, titulo, produtos(id, nome, sku, tipo, preco_venda, preco_custo, estoque, peso_kg, altura_cm, largura_cm, comprimento_cm)')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  if (!rascunho) return NextResponse.json({ ok: false, erro: 'Rascunho não encontrado' }, { status: 404 })

  const produto = (rascunho.produtos ?? null) as any
  if (!produto) {
    return NextResponse.json({
      ok: true, semProduto: true, canais: [],
      aviso: 'Vincule um produto do seu catálogo para calcular preço e estoque pelas regras.',
    })
  }

  // Kit é calculado a partir dos componentes: o custo e o estoque possível do
  // kit não estão na linha do produto, são derivados. Mesma função que a
  // sincronização automática usa.
  let kitInfo: { custo: number; estoque: number } | undefined
  if (produto.tipo === 'kit') {
    try {
      const k = await calcularKit(sb, produto.id)
      if (k) kitInfo = { custo: Number(k.custo ?? 0), estoque: Number(k.estoque ?? 0) }
    } catch { /* kit sem componentes cai no cálculo normal, com o aviso da regra */ }
  }

  const [{ data: canais, error: erroCanais }, { data: depositos }] = await Promise.all([
    // Tokens no select porque o motor mede comissão e frete na API do ML —
    // sem credencial ele cai na tabela configurada, e o contexto avisa.
    sb.from('marketplace_canais')
      .select('id, nome, plataforma, ativo, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
      .eq('empresa_id', guarda.empresaId).eq('ativo', true).order('nome'),
    sb.from('depositos').select('id, nome').eq('empresa_id', guarda.empresaId),
  ])
  if (erroCanais) return NextResponse.json({ ok: false, erro: erroCanais.message }, { status: 500 })

  const canaisIds = (canais ?? []).map(c => c.id)
  let regras: RegraLinha[] = []
  if (canaisIds.length > 0) {
    const { data, error: erroRegras } = await sb.from('marketplace_regras_preco')
      .select('*').in('canal_id', canaisIds).eq('ativo', true).order('nome')
    if (erroRegras) return NextResponse.json({ ok: false, erro: erroRegras.message }, { status: 500 })
    regras = (data ?? []) as RegraLinha[]
  }

  // Estoque por depósito, só dos depósitos que alguma regra realmente usa.
  const depositosUsados = [...new Set(regras.map(r => r.deposito_id).filter(Boolean) as string[])]
  const estoquePorDeposito = new Map<string, number>()
  if (depositosUsados.length > 0) {
    const { data } = await sb.from('produto_estoque')
      .select('deposito_id, quantidade')
      .eq('produto_id', produto.id).in('deposito_id', depositosUsados)
    for (const linha of data ?? []) {
      estoquePorDeposito.set(linha.deposito_id, Number(linha.quantidade ?? 0))
    }
  }

  const nomeDeposito = new Map((depositos ?? []).map(d => [d.id, d.nome]))

  // Base para regras de modo "percentual", que ajustam sobre um preço que já
  // existe. O rascunho ainda não tem preço publicado: usa o que o operador já
  // digitou; se não digitou nada, o preço de venda do produto.
  const editados = (rascunho.dados_editados ?? {}) as any
  const precoBase = Number(editados.preco ?? produto.preco_venda ?? 0)
  const custoReferencia = kitInfo ? kitInfo.custo : Number(produto.preco_custo ?? 0)

  // O ANÚNCIO QUE AINDA NÃO EXISTE.
  //
  // O motor mede a comissão do ML pela CATEGORIA, e a categoria vive no
  // anúncio. Um rascunho não é anúncio — mas foi capturado de um, e o que a
  // captura por link guarda em `dados_origem.categoriaId` serve exatamente
  // para isto. Quando não há (captura pela extensão, que lê a página e não a
  // API), o contexto devolve `api_ml_sem_categoria` e usa a tabela do canal,
  // dizendo que fez isso — que é o comportamento correto, e visível.
  const dadosOrigem = (rascunho.dados_origem ?? {}) as Record<string, unknown>
  const categoriaML = typeof dadosOrigem.categoriaId === 'string' ? dadosOrigem.categoriaId : null

  const anuncioSintetico = {
    id: rascunho.id,
    id_externo: rascunho.origem_id_externo ?? null,
    titulo: rascunho.titulo ?? null,
    categoria_externa: categoriaML,
  }

  const produtoParaMotor = {
    id: produto.id,
    nome: produto.nome,
    sku: produto.sku ?? null,
    tipo: produto.tipo ?? null,
    preco_custo: Number(produto.preco_custo ?? 0),
    peso_kg: produto.peso_kg != null ? Number(produto.peso_kg) : null,
    altura_cm: produto.altura_cm != null ? Number(produto.altura_cm) : null,
    largura_cm: produto.largura_cm != null ? Number(produto.largura_cm) : null,
    comprimento_cm: produto.comprimento_cm != null ? Number(produto.comprimento_cm) : null,
  }

  const resolvedor = criarResolvedor(sb, guarda.empresaId)

  const resultadoPorCanal = await Promise.all((canais ?? []).map(async canal => {
    const doCanal = regras.filter(r => r.canal_id === canal.id)

    // Sem regra não há o que precificar, e resolver o contexto custaria uma
    // consulta de comissão e uma de frete por canal vazio.
    if (doCanal.length === 0) {
      return { canalId: canal.id, canalNome: canal.nome, plataforma: canal.plataforma, regras: [], economia: null }
    }

    const ctx = await resolvedor.contexto({
      canal: canal as never,
      produto: produtoParaMotor,
      anuncio: anuncioSintetico as never,
      custoManual: kitInfo ? kitInfo.custo : null,
    })

    const economia = ctx.economia
    const freteMedido = ctx.origemFrete === 'api_ml' || ctx.origemFrete === 'api_ml_cache'
    const comissaoMedida = ctx.origemComissao === 'api_ml' || ctx.origemComissao === 'api_ml_cache'

    const regrasCalculadas = doCanal.map(regra => {
      // O estoque continua saindo da função de sempre — ela resolve depósito,
      // complementar e risco, que não são economia.
      const calc = calcularPrecoEstoquePorRegra(
        regra,
        { preco_venda: precoBase, produtos: { id: produto.id, preco_venda: Number(produto.preco_venda ?? 0), preco_custo: produto.preco_custo, estoque: Number(produto.estoque ?? 0) } },
        {
          kitInfo,
          estoquePorDeposito: regra.deposito_id ? (estoquePorDeposito.get(regra.deposito_id) ?? 0) : undefined,
        },
      )

      if (!calc.aplicavel) {
        return {
          id: regra.id, nome: regra.nome, modoPreco: regra.modo_preco, modoEstoque: regra.modo_estoque,
          depositoNome: regra.deposito_id ? (nomeDeposito.get(regra.deposito_id) ?? 'depósito removido') : null,
          aplicavel: false, motivo: calc.motivo, preco: null, estoque: null, paraPausar: false,
          markup: null, abaixoDoCusto: false,
          margemLiquida: null, lucroUnitario: null, saude: null, comissao: null, frete: null, regime: null,
        }
      }

      // DUAS CLASSES DE REGRA, e a diferença é o que a regra afirma.
      //
      //   `shopee_liquido` afirma um OBJETIVO: "quero 20% sobre o custo,
      //   depois de descontar tudo". Quem sabe quanto custa "tudo" naquele
      //   canal é o motor — então ele é quem resolve o preço. Na Shopee o
      //   resultado é idêntico ao da fórmula antiga (conferido: mesmas
      //   faixas, mesma base de custo); no ML passa a ser o preço certo em
      //   vez do preço da Shopee.
      //
      //   `fixo`, `produto`, `percentual` e `formula` afirmam um PREÇO. Esse
      //   preço é da regra e não deve ser reescrito — mas a margem que ele
      //   deixa é conta de economia, e quem faz é o motor. Assim uma regra de
      //   markup passa a mostrar o que sobra de verdade.
      const arredondamento = (regra.arredondamento ?? 'nenhum') as ArredondamentoPreco
      const cenario = regra.modo_preco === 'shopee_liquido'
        ? precificarPorObjetivo(economia, { tipo: 'sobre_custo', valor: Number(regra.valor_preco) || 0 }, { arredondamento })
        : avaliarPreco(economia, calc.precoNovo ?? 0)

      const preco = cenario.resultado.preco
      const markup = preco > 0 && custoReferencia > 0 ? ((preco - custoReferencia) / custoReferencia) * 100 : null

      return {
        id: regra.id,
        nome: regra.nome,
        modoPreco: regra.modo_preco,
        modoEstoque: regra.modo_estoque,
        depositoNome: regra.deposito_id ? (nomeDeposito.get(regra.deposito_id) ?? 'depósito removido') : null,
        aplicavel: cenario.valido,
        motivo: cenario.valido ? null : (cenario.resultado.avisos[0] ?? 'O motor não fechou a conta com estas taxas.'),
        preco: cenario.valido ? preco : null,
        estoque: calc.estoqueNovo ?? null,
        paraPausar: calc.paraPausar,
        markup: markup !== null ? Math.round(markup * 10) / 10 : null,
        abaixoDoCusto: preco > 0 && custoReferencia > 0 && preco <= custoReferencia,
        // O que a conta antiga não sabia dizer.
        margemLiquida: Math.round(cenario.resultado.margemLiquida * 10) / 10,
        lucroUnitario: cenario.resultado.lucro,
        saude: cenario.saude,
        comissao: cenario.resultado.comissao,
        frete: cenario.resultado.frete,
        regime: cenario.resultado.regime?.descricao ?? null,
        avisos: cenario.resultado.avisos,
      }
    })

    return {
      canalId: canal.id,
      canalNome: canal.nome,
      plataforma: canal.plataforma,
      regras: regrasCalculadas,
      // DE ONDE SAIU CADA NÚMERO. Sem isto a tela mostraria um frete suposto
      // com a mesma cara de um medido — o defeito que este módulo já pagou
      // caro para aprender (ver docs/precificacao-arquitetura.md, 7.1).
      economia: {
        origemComissao: ctx.origemComissao,
        origemFrete: ctx.origemFrete,
        origemCusto: ctx.origemCusto,
        comissaoMedida,
        freteMedido,
        descricao: descreverOrigem(ctx),
        avisos: ctx.avisos,
      },
    }
  }))

  return NextResponse.json({
    ok: true,
    semProduto: false,
    produto: {
      id: produto.id,
      nome: produto.nome,
      tipo: produto.tipo,
      precoVenda: Number(produto.preco_venda ?? 0),
      precoCusto: Number(produto.preco_custo ?? 0),
      estoque: Number(produto.estoque ?? 0),
    },
    kit: kitInfo ?? null,
    custoReferencia,
    precoBase,
    precoOrigem: rascunho.preco_origem != null ? Number(rascunho.preco_origem) : null,
    canais: resultadoPorCanal,
    // Distingue "não tem canal" de "tem canal e nenhuma regra" — a ação que
    // resolve cada caso é diferente, e uma tela vazia não diz qual é.
    totalRegras: regras.length,
  })
}
