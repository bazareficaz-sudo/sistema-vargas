import { calcular, saudeDaMargem } from './motor'
import { classificarMargem, limitePromocionalEfetivo, type Margens, type ResultadoClassificacao } from './margens'
import type { EconomiaResolvida } from './cenarios'
import type { Resultado } from './tipos'

// PREÇO POR QUANTIDADE — camada PURA.
//
// A regra absoluta: NENHUM desconto por quantidade tem a margem calculada
// fora do motor. Cada faixa é um cenário econômico, avaliado com a quantidade
// certa — e é a quantidade que faz o frete do pedido ser rateado.
//
// POR QUE NÃO "3+ = -5%, 5+ = -10%, 10+ = -15%"
//
// Percentual fixo ignora a economia real. Duas coisas acontecem quando a
// quantidade sobe, e elas puxam para lados diferentes:
//
//   a favor  o frete do pedido dilui, então o MESMO preço deixa mais margem;
//   contra   descer o preço come margem.
//
// Um desconto de 15% pode ser folgado num item que paga R$ 22 de frete e
// suicida num que não paga frete nenhum. Por isso a sugestão daqui parte dos
// LIMITES ECONÔMICOS, não de uma tabela de percentuais.
//
// REAPROVEITAMENTO: o formato `{qtd, preco}` é o mesmo de
// `produtos.precos_quantidade`, que o PDV já usa (lib/produtos/promocao.ts).
// Não foi inventado formato novo — o que muda é que aqui cada faixa passa
// pela economia do canal, que o balcão não tem.

/** Mesma forma de `produtos.precos_quantidade`. `qtd` é a quantidade mínima. */
export type FaixaQuantidade = { qtd: number; preco: number }

export type FaixaAvaliada = {
  faixa: FaixaQuantidade
  resultado: Resultado
  classificacao: ResultadoClassificacao
  /** Lucro do pedido inteiro naquela quantidade. É o que entra no caixa. */
  lucroPedido: number
  /** Desconto sobre o preço de referência de uma unidade. */
  descontoPercentual: number
  /** Falso quando a política não permite executar sem decisão humana. */
  liberado: boolean
}

const BRL = (v: number) => Math.round(v * 100) / 100

/**
 * Avalia cada faixa pelo motor, na quantidade que ela representa.
 *
 * A quantidade usada é a MÍNIMA da faixa — é o pior caso econômico dela: quem
 * compra 12 numa faixa "10+" dilui ainda mais o frete, então avaliar em 10
 * nunca superestima a margem.
 */
export function avaliarFaixas(
  economia: EconomiaResolvida,
  margens: Margens,
  faixas: FaixaQuantidade[],
  precoReferencia?: number,
): FaixaAvaliada[] {
  const base = precoReferencia ?? 0
  return [...faixas]
    .filter(f => f.qtd > 1 && f.preco > 0)
    .sort((a, b) => a.qtd - b.qtd)
    .map(faixa => {
      const resultado = calcular({
        cfg: economia.cfg, custoProduto: economia.custo, pesoKg: economia.pesoKg,
        freteFaixas: economia.freteFaixas,
        objetivo: { tipo: 'preco', valor: faixa.preco },
        quantidade: faixa.qtd,
      })
      const classificacao = classificarMargem(Number(resultado.margemLiquida.toFixed(2)), margens)
      return {
        faixa,
        resultado,
        classificacao,
        lucroPedido: resultado.pedido.lucro,
        descontoPercentual: base > 0 ? Number((((base - faixa.preco) / base) * 100).toFixed(2)) : 0,
        liberado: classificacao.classificacao === 'alvo' || classificacao.classificacao === 'promocional',
      }
    })
}

export type OpcoesSugestao = {
  /** Quantidades das faixas. Sugestão de UI, não regra universal. */
  quantidades?: number[]
  /** Arredondamento aplicado a cada preço sugerido. */
  arredondamento?: 'nenhum' | 'terminar_90' | 'terminar_99' | 'cima_inteiro'
}

export const QUANTIDADES_SUGERIDAS = [3, 5, 10]

export type SugestaoFaixas = {
  faixas: FaixaQuantidade[]
  avaliadas: FaixaAvaliada[]
  /** Como as margens de cada faixa foram escolhidas. */
  criterio: string
  avisos: string[]
}

/**
 * Sugere faixas a partir dos limites econômicos — nunca de percentuais fixos.
 *
 * COM política promocional declarada: cada faixa consome uma fração da folga
 * entre a margem alvo e a margem promocional mínima. A última faixa chega ao
 * limite promocional, e NUNCA o ultrapassa: o guardrail é o teto da sugestão,
 * não uma sugestão que depois se confere.
 *
 * SEM política promocional declarada: nada de desconto agressivo. As faixas
 * mantêm a MARGEM ALVO e mesmo assim saem mais baratas, porque o frete do
 * pedido dilui com a quantidade. É desconto de graça — o cliente paga menos e
 * a margem não se move —, e é o único que pode ser sugerido sem uma política
 * que autorize abrir mão de margem.
 */
export function sugerirFaixas(
  economia: EconomiaResolvida,
  margens: Margens,
  opcoes: OpcoesSugestao = {},
): SugestaoFaixas {
  const quantidades = (opcoes.quantidades ?? QUANTIDADES_SUGERIDAS)
    .map(q => Math.trunc(Number(q)))
    .filter(q => q > 1)
    .sort((a, b) => a - b)

  const avisos: string[] = []
  const limite = limitePromocionalEfetivo(margens)
  const temPolitica = margens.promocionalMinima != null && limite != null && limite < margens.alvo

  if (!temPolitica) {
    avisos.push(
      'Sem margem promocional declarada nesta regra, as faixas mantêm a margem alvo. '
      + 'O preço cai só pelo que o frete do pedido dilui — desconto que não custa margem.',
    )
  }

  const criterio = temPolitica
    ? `margem escalonada entre o alvo (${margens.alvo.toFixed(1)}%) e o mínimo promocional (${limite!.toFixed(1)}%)`
    : `margem alvo (${margens.alvo.toFixed(1)}%) mantida em todas as faixas`

  const faixas: FaixaQuantidade[] = []
  for (let i = 0; i < quantidades.length; i++) {
    const qtd = quantidades[i]
    // Fração da folga que esta faixa consome: a última chega ao limite.
    const fracao = quantidades.length === 1 ? 1 : (i + 1) / quantidades.length
    const margemAlvoDaFaixa = temPolitica
      ? margens.alvo - (margens.alvo - limite!) * fracao
      : margens.alvo

    const r = calcular({
      cfg: economia.cfg, custoProduto: economia.custo, pesoKg: economia.pesoKg,
      freteFaixas: economia.freteFaixas,
      objetivo: { tipo: 'margem_liquida', valor: margemAlvoDaFaixa },
      quantidade: qtd,
      arredondamento: opcoes.arredondamento,
    })

    if (!(r.preco > 0)) {
      avisos.push(`Não foi possível fechar um preço para ${qtd}+ unidades com as taxas deste canal.`)
      continue
    }
    faixas.push({ qtd, preco: BRL(r.preco) })
  }

  // O preço de UMA unidade na margem alvo é a referência: uma faixa que não
  // sai mais barata que ele não é faixa, é ruído. A comparação começa nele e
  // não na faixa anterior — senão "3+ pelo mesmo preço de 1" sobreviveria por
  // não ter antecessora.
  const referencia = calcular({
    cfg: economia.cfg, custoProduto: economia.custo, pesoKg: economia.pesoKg,
    freteFaixas: economia.freteFaixas,
    objetivo: { tipo: 'margem_liquida', valor: margens.alvo },
    quantidade: 1,
  }).preco

  const uteis: FaixaQuantidade[] = []
  for (const f of faixas) {
    const anterior = uteis[uteis.length - 1]
    const teto = anterior ? anterior.preco : referencia
    const doQue = anterior ? `a de ${anterior.qtd}+` : `o preço de uma unidade`
    if (teto > 0 && f.preco >= teto - 0.01) {
      avisos.push(`A faixa de ${f.qtd}+ não sairia mais barata que ${doQue} — descartada.`)
      continue
    }
    uteis.push(f)
  }

  return {
    faixas: uteis,
    avaliadas: avaliarFaixas(economia, margens, uteis, referencia),
    criterio,
    avisos,
  }
}

/**
 * A faixa de preço por quantidade cabe economicamente neste item?
 *
 * Responde antes de sugerir nada: item sem folga nenhuma não deveria nem
 * abrir a conversa de atacado.
 */
export function cabeAtacado(economia: EconomiaResolvida, margens: Margens, quantidade = 10): {
  cabe: boolean
  motivo: string
  economiaPorUnidade: number
} {
  const uma = calcular({
    cfg: economia.cfg, custoProduto: economia.custo, pesoKg: economia.pesoKg,
    freteFaixas: economia.freteFaixas,
    objetivo: { tipo: 'margem_liquida', valor: margens.alvo }, quantidade: 1,
  })
  const muitas = calcular({
    cfg: economia.cfg, custoProduto: economia.custo, pesoKg: economia.pesoKg,
    freteFaixas: economia.freteFaixas,
    objetivo: { tipo: 'margem_liquida', valor: margens.alvo }, quantidade,
  })

  const porDiluicao = BRL(uma.preco - muitas.preco)
  // A política só abre folga quando foi DECLARADA. Sem ela,
  // `limitePromocionalEfetivo` devolve o piso — que é limite absoluto, não
  // permissão para descontar.
  const limite = margens.promocionalMinima
  const porPolitica = limite != null && limite < margens.alvo

  if (uma.preco <= 0 || muitas.preco <= 0) {
    return { cabe: false, motivo: 'Não há preço que feche a margem alvo neste canal.', economiaPorUnidade: 0 }
  }
  if (porDiluicao > 0.01) {
    return {
      cabe: true,
      motivo: `O frete do pedido dilui: a ${quantidade} unidades o mesmo lucro sai a R$ ${muitas.preco.toFixed(2)}, contra R$ ${uma.preco.toFixed(2)} na unidade.`,
      economiaPorUnidade: porDiluicao,
    }
  }
  if (porPolitica) {
    return {
      cabe: true,
      motivo: 'Não há frete a diluir, mas a política promocional permite abrir margem para quem leva mais.',
      economiaPorUnidade: 0,
    }
  }
  return {
    cabe: false,
    motivo: 'Sem frete a diluir e sem política promocional declarada, descer o preço só tiraria margem.',
    economiaPorUnidade: 0,
  }
}

/** Saúde da margem de cada faixa, no vocabulário que a tela já usa. */
export function saudeDaFaixa(f: FaixaAvaliada, faixasSaude?: Parameters<typeof saudeDaMargem>[1]) {
  return saudeDaMargem(f.resultado.margemLiquida, faixasSaude)
}
