import { calcularPrecoParaMargem } from './comissao'

// Mesma matemática do preview manual em massa (AnunciosClient.tsx →
// prepararPreviewMassaPreco), extraída aqui pra ser reaproveitada pela
// sincronização automática (cron, sem UI) sem duplicar a lógica de cálculo.
// Deliberadamente não usada pelo preview manual em si — trocar a
// implementação de uma função já em produção carregava risco de regressão
// sem ganho real; os dois pontos fazem a mesma conta, só que em contextos
// diferentes (interativo vs. desatendido).

export function arredondar(valor: number, regraArredondamento: string): number {
  if (regraArredondamento === 'cima_inteiro') return Math.ceil(valor)
  if (regraArredondamento === 'terminar_90' || regraArredondamento === 'terminar_99') {
    const base = Math.floor(valor)
    const decimal = regraArredondamento === 'terminar_90' ? 0.90 : 0.99
    return parseFloat((base + decimal).toFixed(2))
  }
  return Math.round(valor * 100) / 100
}

export type RegraCalculo = {
  modo_preco: string
  valor_preco: number | null
  arredondamento: string
  considerar_subsidio_pix: boolean | null
  valor_embalagem: number | null
  percentual_imposto: number | null
  modo_estoque: string
  valor_estoque: number | null
  deposito_id: string | null
  estoque_complementar: number | null
  estoque_risco: number | null
}

export type AnuncioParaCalculo = {
  preco_venda: number
  produtos: { id: string; preco_venda: number; preco_custo: number | null; estoque: number } | null
}

export type ResultadoCalculo =
  | { aplicavel: true; precoNovo?: number; estoqueNovo?: number; paraPausar: boolean }
  | { aplicavel: false; motivo: string }

export function calcularPrecoEstoquePorRegra(
  regra: RegraCalculo,
  anuncio: AnuncioParaCalculo,
  contexto: { estoquePorDeposito?: number; kitInfo?: { custo: number; estoque: number } } = {}
): ResultadoCalculo {
  const produto = anuncio.produtos
  const kitInfo = contexto.kitInfo
  const custoProduto = kitInfo ? kitInfo.custo : produto?.preco_custo
  const estoqueProduto = kitInfo ? kitInfo.estoque : produto?.estoque

  const embalagem = Number(regra.valor_embalagem ?? 0)
  const imposto = Number(regra.percentual_imposto ?? 0)
  const complementar = Number(regra.estoque_complementar ?? 0)
  const risco = regra.estoque_risco != null ? Number(regra.estoque_risco) : null
  const considerarPix = !!regra.considerar_subsidio_pix

  let precoNovo: number | undefined
  if (regra.modo_preco === 'fixo') precoNovo = Number(regra.valor_preco) || 0
  else if (regra.modo_preco === 'percentual') precoNovo = arredondar(anuncio.preco_venda * (1 + (Number(regra.valor_preco) || 0) / 100), regra.arredondamento)
  else if (regra.modo_preco === 'formula') {
    if (!custoProduto || custoProduto <= 0) return { aplicavel: false, motivo: 'Produto vinculado sem custo cadastrado' }
    precoNovo = arredondar((custoProduto + embalagem) * (1 + (Number(regra.valor_preco) || 0) / 100), regra.arredondamento)
  } else if (regra.modo_preco === 'shopee_liquido') {
    if (!custoProduto || custoProduto <= 0) return { aplicavel: false, motivo: 'Produto vinculado sem custo cadastrado' }
    precoNovo = arredondar(calcularPrecoParaMargem(custoProduto + embalagem, Number(regra.valor_preco) || 0, considerarPix, imposto), regra.arredondamento)
  } else if (regra.modo_preco === 'produto') {
    if (!produto) return { aplicavel: false, motivo: 'Sem produto vinculado' }
    precoNovo = arredondar(produto.preco_venda, regra.arredondamento)
  }

  let estoqueNovo: number | undefined
  if (regra.modo_estoque === 'fixo') estoqueNovo = Number(regra.valor_estoque) || 0
  else if (regra.modo_estoque === 'produto') {
    if (!produto) return { aplicavel: false, motivo: 'Sem produto vinculado' }
    estoqueNovo = estoqueProduto ?? 0
  } else if (regra.modo_estoque === 'deposito') {
    if (!regra.deposito_id) return { aplicavel: false, motivo: 'Nenhum depósito selecionado na regra' }
    if (!produto) return { aplicavel: false, motivo: 'Sem produto vinculado' }
    estoqueNovo = kitInfo ? kitInfo.estoque : (contexto.estoquePorDeposito ?? 0)
  }
  if (estoqueNovo !== undefined && complementar !== 0) estoqueNovo = estoqueNovo + complementar

  if (precoNovo === undefined && estoqueNovo === undefined) return { aplicavel: false, motivo: 'Regra sem alteração de preço nem estoque' }

  const paraPausar = estoqueNovo !== undefined && risco !== null && estoqueNovo <= risco
  return { aplicavel: true, precoNovo, estoqueNovo, paraPausar }
}
