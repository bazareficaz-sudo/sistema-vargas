import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { estoqueDoSistema } from '@/lib/marketplace/estoqueDoSistema'
import { buscarConfigUnificacao, estoqueUnificadoDeProdutos } from '@/lib/produtos/estoqueUnificado'
import { calcularPrecoEstoquePorRegra } from '@/lib/shopee/aplicarRegra'
import { variacoesElegiveis, rotuloDaVariacao, type VariacaoDoAnuncio } from '@/lib/marketplace/estoqueVariacoes'

// O QUE A SINCRONIZAÇÃO MANDARIA — para o envio manual propor o mesmo número.
//
// O modal "Enviar preço/estoque" preenchia os campos com o ESPELHO
// (`marketplace_anuncio_variacoes.estoque`), que é o que acreditamos que o
// canal tem. Reenviar o espelho é útil para forçar uma regravação, mas não é
// o que quem clica espera: depois de corrigir o estoque no ERP, o modal
// continuava propondo o número velho, e quem confirmasse mandaria de volta
// para a Shopee justamente o valor que se acabou de corrigir.
//
// Aconteceu em 13/09/2026, logo depois da reconciliação de 472 produtos: o
// depósito já estava em −3 e o modal propunha 1006.
//
// A conta é a MESMA da fila — `estoqueDoSistema` e
// `calcularPrecoEstoquePorRegra`, nas mesmas condições. Se esta rota fizesse a
// sua própria conta, o botão manual e a fila mandariam números diferentes para
// o mesmo anúncio, e ninguém saberia qual dos dois está certo.

type LinhaSugerida = {
  variacaoId: string | null
  modelId: string | null
  rotulo: string
  produtoNome: string | null
  /** O que o ERP tem, antes da regra. */
  estoqueSistema: number | null
  /** O que a sincronização mandaria: já com a regra aplicada. */
  estoqueSugerido: number | null
  precoSugerido: number | null
  /** O que acreditamos que o canal tem hoje. */
  espelhoEstoque: number | null
  espelhoPreco: number | null
  /** Sem produto vinculado: a fila não toca nesta variação, e o modal avisa. */
  semProduto: boolean
  detalhe: string
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: anuncioId } = await ctx.params

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: anuncio } = await sb
    .from('marketplace_anuncios')
    .select('id, empresa_id, produto_id, preco_venda, estoque_externo, estoque_reservado, regra_id, tem_variacao')
    .eq('id', anuncioId).eq('empresa_id', empresaId).maybeSingle()

  if (!anuncio) return NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 })

  const regra = anuncio.regra_id
    ? (await sb.from('marketplace_regras_preco').select('*').eq('id', anuncio.regra_id).maybeSingle()).data
    : null

  const cfgUnif = await buscarConfigUnificacao(sb, empresaId)

  /** A conta de uma linha, igual à da fila. */
  async function sugerirPara(produtoId: string, precoBase: number | null) {
    const { data: produto } = await sb.from('produtos')
      .select('id, nome, estoque, preco_venda, preco_custo, tipo').eq('id', produtoId).maybeSingle()
    if (!produto) return null

    const mapa = await estoqueUnificadoDeProdutos(sb, empresaId!, [produtoId], cfgUnif)
    const base = await estoqueDoSistema(sb, produto, mapa)

    let estoque: number | null = base.estoque
    let preco: number | null = null
    let detalhe = base.origem

    if (regra) {
      let estoquePorDeposito: number | undefined
      if (!base.kitInfo && regra.modo_estoque === 'deposito' && regra.deposito_id) {
        const { data: pe } = await sb.from('produto_estoque').select('quantidade')
          .eq('deposito_id', regra.deposito_id).eq('produto_id', produtoId).maybeSingle()
        estoquePorDeposito = pe?.quantidade ?? 0
      }
      const r = calcularPrecoEstoquePorRegra(
        regra,
        {
          preco_venda: precoBase ?? anuncio!.preco_venda,
          produtos: {
            id: produto.id, preco_venda: produto.preco_venda,
            preco_custo: produto.preco_custo, estoque: base.estoque,
          },
        },
        { estoquePorDeposito, kitInfo: base.kitInfo },
      )
      if (r.aplicavel) {
        if (typeof r.estoqueNovo === 'number') estoque = r.estoqueNovo
        if (typeof r.precoNovo === 'number') preco = r.precoNovo
        detalhe = `${base.origem} · regra aplicada`
      } else {
        detalhe = `regra não pôde ser aplicada: ${r.motivo}`
      }
    }

    return { produto, estoqueSistema: base.estoque, estoque, preco, detalhe }
  }

  const linhas: LinhaSugerida[] = []

  if (anuncio.tem_variacao) {
    const { data: variacoes } = await sb
      .from('marketplace_anuncio_variacoes')
      .select('id, model_id, nome_variacao, sku_variacao, produto_id, preco, estoque')
      .eq('anuncio_id', anuncio.id)
      .order('nome_variacao')

    const todas = (variacoes ?? []) as VariacaoDoAnuncio[]
    const { ignoradas } = variacoesElegiveis(todas)
    const semProduto = new Set(ignoradas.map(i => i.variacao.id))

    for (const v of todas) {
      const rotulo = rotuloDaVariacao(v)
      if (semProduto.has(v.id) || !v.produto_id) {
        linhas.push({
          variacaoId: v.id, modelId: v.model_id, rotulo, produtoNome: null,
          estoqueSistema: null, estoqueSugerido: null, precoSugerido: null,
          espelhoEstoque: v.estoque, espelhoPreco: v.preco, semProduto: true,
          detalhe: 'sem produto vinculado — a sincronização não altera esta variação',
        })
        continue
      }
      const s = await sugerirPara(v.produto_id, v.preco)
      linhas.push({
        variacaoId: v.id, modelId: v.model_id, rotulo,
        produtoNome: s?.produto?.nome ?? null,
        estoqueSistema: s?.estoqueSistema ?? null,
        estoqueSugerido: s?.estoque ?? null,
        precoSugerido: s?.preco ?? null,
        espelhoEstoque: v.estoque, espelhoPreco: v.preco, semProduto: false,
        detalhe: s?.detalhe ?? 'produto vinculado não encontrado',
      })
    }
  } else if (anuncio.produto_id) {
    const s = await sugerirPara(anuncio.produto_id, anuncio.preco_venda)
    linhas.push({
      variacaoId: null, modelId: null, rotulo: 'Anúncio',
      produtoNome: s?.produto?.nome ?? null,
      estoqueSistema: s?.estoqueSistema ?? null,
      estoqueSugerido: s?.estoque ?? null,
      precoSugerido: s?.preco ?? null,
      espelhoEstoque: anuncio.estoque_externo, espelhoPreco: anuncio.preco_venda,
      semProduto: false, detalhe: s?.detalhe ?? '',
    })
  } else {
    linhas.push({
      variacaoId: null, modelId: null, rotulo: 'Anúncio', produtoNome: null,
      estoqueSistema: null, estoqueSugerido: null, precoSugerido: null,
      espelhoEstoque: anuncio.estoque_externo, espelhoPreco: anuncio.preco_venda,
      semProduto: true, detalhe: 'sem produto vinculado',
    })
  }

  return NextResponse.json({ ok: true, temRegra: !!regra, linhas })
}
