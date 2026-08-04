import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { calcularPrecoEstoquePorRegra, type RegraCalculo } from '@/lib/shopee/aplicarRegra'
import { calcularKit } from '@/lib/produtos/kit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Preço e estoque do rascunho a partir das regras que a empresa já tem
// cadastradas — as mesmas usadas hoje pelos anúncios reais e pela
// sincronização automática. Nada de matemática nova: reaproveita
// calcularPrecoEstoquePorRegra, que é a função que já roda em produção.
//
// A rota só CALCULA e devolve. Aplicar é decisão do operador na tela: uma
// regra pode dar preço abaixo do custo (regra mal configurada, produto sem
// custo), e isso precisa ser visto antes de virar preço de anúncio.

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
    .select('id, produto_id, preco_origem, dados_editados, produtos(id, nome, tipo, preco_venda, preco_custo, estoque)')
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
    sb.from('marketplace_canais')
      .select('id, nome, plataforma, ativo')
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

  const resultadoPorCanal = (canais ?? []).map(canal => {
    const doCanal = regras.filter(r => r.canal_id === canal.id)
    return {
      canalId: canal.id,
      canalNome: canal.nome,
      plataforma: canal.plataforma,
      regras: doCanal.map(regra => {
        const calc = calcularPrecoEstoquePorRegra(
          regra,
          { preco_venda: precoBase, produtos: { id: produto.id, preco_venda: Number(produto.preco_venda ?? 0), preco_custo: produto.preco_custo, estoque: Number(produto.estoque ?? 0) } },
          {
            kitInfo,
            estoquePorDeposito: regra.deposito_id ? (estoquePorDeposito.get(regra.deposito_id) ?? 0) : undefined,
          },
        )

        const preco = calc.aplicavel ? calc.precoNovo : undefined
        // Markup sobre o custo — a leitura que serve para qualquer canal.
        // Margem líquida (comissão, taxa, imposto) só existe no modo
        // shopee_liquido e já está embutida no preço que ele devolve;
        // repetir aqui uma conta líquida para todos daria número errado.
        const markup = preco !== undefined && custoReferencia > 0
          ? ((preco - custoReferencia) / custoReferencia) * 100
          : null

        return {
          id: regra.id,
          nome: regra.nome,
          modoPreco: regra.modo_preco,
          modoEstoque: regra.modo_estoque,
          depositoNome: regra.deposito_id ? (nomeDeposito.get(regra.deposito_id) ?? 'depósito removido') : null,
          aplicavel: calc.aplicavel,
          motivo: calc.aplicavel ? null : calc.motivo,
          preco: preco ?? null,
          estoque: calc.aplicavel ? (calc.estoqueNovo ?? null) : null,
          paraPausar: calc.aplicavel ? calc.paraPausar : false,
          markup: markup !== null ? Math.round(markup * 10) / 10 : null,
          abaixoDoCusto: preco !== undefined && custoReferencia > 0 && preco <= custoReferencia,
        }
      }),
    }
  })

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
