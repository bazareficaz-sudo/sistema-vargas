import type { ConfigTaxas, FaixaComissao, ItemCusto, LinhaCalculo, Objetivo, Resultado, SaudePreco, FaixaFrete } from './tipos'

// Motor de Precificação — função pura, síncrona, sem banco e sem tela.
// É consumido pela simulação, pelo comparador entre canais, pelo indicador de
// saúde dos anúncios e (nas fases seguintes) pelo recálculo em massa. Nenhum
// desses lugares refaz conta por conta própria: todos chamam daqui.
//
// O modelo é sempre o mesmo:
//
//   preço = custo + embalagem + deduções(preço) + lucro
//
// onde "deduções" reúne comissão, frete, imposto, taxas do marketplace e
// custos extras. Parte delas é percentual sobre o preço — e é por isso que,
// quando o objetivo é uma margem, o preço não pode ser calculado direto: ele
// aparece nos dois lados da conta. A resolução está em `resolverPreco`.

const BRL = (v: number) => Math.round(v * 100) / 100

// ─────────────────────────────────────────────────────────────
// Componentes que dependem do preço
// ─────────────────────────────────────────────────────────────

export function faixaComissao(cfg: ConfigTaxas, preco: number): FaixaComissao {
  if (cfg.comissaoModo === 'simples') {
    return { min: 0, max: null, percentual: cfg.comissaoPercentual, fixo: cfg.comissaoFixo }
  }
  const faixas = cfg.comissaoFaixas ?? []
  const achada = faixas.find(f => preco >= f.min && (f.max == null || preco <= f.max))
  return achada ?? faixas[faixas.length - 1] ?? { min: 0, max: null, percentual: 0, fixo: 0 }
}

// Custo de frete que sai do bolso do VENDEDOR (não o que o comprador paga).
export function freteEm(cfg: ConfigTaxas, preco: number, pesoKg: number | null): number {
  if (cfg.freteModo === 'fixo') return cfg.freteValor ?? 0
  if (cfg.freteModo === 'gratis_acima') {
    // Abaixo do limite quem paga é o comprador — custo zero pra nós.
    return preco >= (cfg.freteLimiteGratis ?? 0) ? (cfg.freteCustoMedio ?? 0) : 0
  }
  if (cfg.freteModo === 'faixa_peso') {
    if (pesoKg == null) return 0
    const faixas = [...(cfg.freteFaixas ?? [])].sort((a, b) => a.pesoAte - b.pesoAte)
    const achada = faixas.find(f => pesoKg <= f.pesoAte)
    return achada?.valor ?? faixas[faixas.length - 1]?.valor ?? 0
  }
  return 0
}

/**
 * O frete que vale para um preço, dada a escada importada do marketplace.
 *
 * Mora aqui, e não no módulo do Mercado Livre, porque é conta pura: o motor
 * não pode depender de um módulo que fala com API e banco.
 */
export function freteDaFaixa(faixas: FaixaFrete[] | null | undefined, preco: number): number {
  if (!faixas?.length) return 0
  const achada = faixas.find(f => preco >= f.min && (f.max == null || preco <= f.max))
  return achada?.valor ?? faixas[faixas.length - 1]?.valor ?? 0
}

function separarItem(item: ItemCusto | null | undefined, custo: number) {
  // Devolve {pctPreco, fixo}: o que incide sobre o preço fica como taxa
  // percentual (entra na resolução), o resto já vira valor em reais.
  if (!item || !item.valor) return { pctPreco: 0, fixo: 0 }
  if (item.tipo === 'fixo') return { pctPreco: 0, fixo: item.valor }
  if ((item.base ?? 'preco') === 'custo') return { pctPreco: 0, fixo: custo * (item.valor / 100) }
  return { pctPreco: item.valor / 100, fixo: 0 }
}

function separarLista(itens: ItemCusto[] | null | undefined, custo: number) {
  let pctPreco = 0, fixo = 0
  for (const i of itens ?? []) {
    const r = separarItem(i, custo)
    pctPreco += r.pctPreco; fixo += r.fixo
  }
  return { pctPreco, fixo }
}

// ─────────────────────────────────────────────────────────────
// Regime: uma combinação (faixa de comissão × frete grátis ou não)
// ─────────────────────────────────────────────────────────────
//
// A comissão muda de alíquota conforme o preço, e o frete grátis liga acima
// de um valor. As duas coisas criam degraus: a fórmula é linear DENTRO de um
// regime, mas não entre regimes. Em vez de iterar (que oscila em cima do
// degrau), resolvo a fórmula fechada em cada regime e fico com as soluções
// que caem de fato dentro do próprio regime — o que é exato.

type Regime = {
  faixa: FaixaComissao
  freteGratis: boolean | null // null = frete não depende do preço
  pctPreco: number
  fixo: number
  precoMin: number
  precoMax: number | null
}

function montarRegimes(
  cfg: ConfigTaxas,
  custo: number,
  pesoKg: number | null,
  freteFaixasItem?: FaixaFrete[] | null,
): Regime[] {
  const faixas: FaixaComissao[] = cfg.comissaoModo === 'simples'
    ? [{ min: 0, max: null, percentual: cfg.comissaoPercentual, fixo: cfg.comissaoFixo }]
    : (cfg.comissaoFaixas?.length ? cfg.comissaoFaixas : [{ min: 0, max: null, percentual: 0, fixo: 0 }])

  const taxas = separarLista(cfg.taxas, custo)
  const extras = separarLista(cfg.custosExtras, custo)
  const imposto = separarItem(cfg.imposto, custo)

  const usaLimiteFrete = cfg.freteModo === 'gratis_acima'
  const limite = cfg.freteLimiteGratis ?? 0
  const freteFixoSempre = cfg.freteModo === 'fixo' ? (cfg.freteValor ?? 0)
    : cfg.freteModo === 'faixa_peso' ? freteEm(cfg, 0, pesoKg)
    : 0

  const regimes: Regime[] = []
  for (const faixa of faixas) {
    const comuns = {
      pctPreco: faixa.percentual / 100 + taxas.pctPreco + extras.pctPreco + imposto.pctPreco,
      fixoBase: faixa.fixo + taxas.fixo + extras.fixo + imposto.fixo,
    }
    // Frete importado do marketplace: também é uma escada por faixa de preço,
    // então cruza com a escada da comissão. Cada pedaço em que as duas são
    // constantes vira um regime — que é o que a fórmula fechada sabe
    // resolver com exatidão, sem iterar em cima do degrau.
    //
    // Tem precedência sobre o `freteModo` digitado: quando o número veio do
    // ML, ele é a verdade, e o "custo médio" da configuração deixa de valer.
    if (freteFaixasItem?.length) {
      for (const ff of freteFaixasItem) {
        const min = Math.max(faixa.min, ff.min)
        const max = faixa.max == null
          ? ff.max
          : ff.max == null ? faixa.max : Math.min(faixa.max, ff.max)
        if (max != null && max < min) continue // sem interseção
        regimes.push({
          faixa, freteGratis: ff.valor > 0,
          pctPreco: comuns.pctPreco, fixo: comuns.fixoBase + ff.valor,
          precoMin: min, precoMax: max,
        })
      }
      continue
    }
    if (usaLimiteFrete) {
      // Abaixo do limite: sem custo de frete.
      const maxAbaixo = faixa.max == null ? limite : Math.min(faixa.max, limite)
      if (faixa.min < limite) {
        regimes.push({
          faixa, freteGratis: false, pctPreco: comuns.pctPreco, fixo: comuns.fixoBase,
          precoMin: faixa.min, precoMax: maxAbaixo,
        })
      }
      // No limite ou acima: o vendedor paga o frete.
      if (faixa.max == null || faixa.max >= limite) {
        regimes.push({
          faixa, freteGratis: true, pctPreco: comuns.pctPreco, fixo: comuns.fixoBase + (cfg.freteCustoMedio ?? 0),
          precoMin: Math.max(faixa.min, limite), precoMax: faixa.max,
        })
      }
    } else {
      regimes.push({
        faixa, freteGratis: null, pctPreco: comuns.pctPreco, fixo: comuns.fixoBase + freteFixoSempre,
        precoMin: faixa.min, precoMax: faixa.max,
      })
    }
  }
  return regimes
}

// Custo que não depende do preço: produto + embalagem (quando fixa ou % do
// custo). Embalagem percentual sobre o PREÇO cai nas deduções, não aqui.
function custoBase(cfg: ConfigTaxas, custoProduto: number) {
  const emb = separarItem(cfg.embalagem, custoProduto)
  return { custoTotal: custoProduto + emb.fixo, embalagemPctPreco: emb.pctPreco, embalagemValorFixo: emb.fixo }
}

// ─────────────────────────────────────────────────────────────
// Resolução do preço a partir do objetivo
// ─────────────────────────────────────────────────────────────

function precoNoRegime(r: Regime, custoTotal: number, embPct: number, objetivo: Objetivo): number | null {
  const pct = r.pctPreco + embPct
  const fixo = r.fixo
  switch (objetivo.tipo) {
    case 'preco':
      return objetivo.valor
    case 'markup':
      // Markup é definição direta sobre o custo — não depende das deduções.
      return custoTotal * objetivo.valor
    case 'margem_liquida': {
      const m = objetivo.valor / 100
      const den = 1 - pct - m
      if (den <= 0) return null // taxas + margem desejada passam de 100%
      return (custoTotal + fixo) / den
    }
    case 'sobre_custo': {
      const den = 1 - pct
      if (den <= 0) return null
      return (custoTotal * (1 + objetivo.valor / 100) + fixo) / den
    }
    case 'lucro_fixo': {
      const den = 1 - pct
      if (den <= 0) return null
      return (custoTotal + fixo + objetivo.valor) / den
    }
  }
}

function dentroDoRegime(r: Regime, preco: number): boolean {
  return preco >= r.precoMin - 0.005 && (r.precoMax == null || preco <= r.precoMax + 0.005)
}

// ─────────────────────────────────────────────────────────────
// Entrada principal
// ─────────────────────────────────────────────────────────────

export function calcular(params: {
  cfg: ConfigTaxas
  custoProduto: number
  objetivo: Objetivo
  pesoKg?: number | null
  /**
   * Escada de frete importada do marketplace para ESTE item. Quando vem
   * preenchida, substitui o frete configurado no canal — ver montarRegimes.
   */
  freteFaixas?: FaixaFrete[] | null
  arredondamento?: 'nenhum' | 'terminar_90' | 'terminar_99' | 'cima_inteiro'
}): Resultado {
  const { cfg, custoProduto, objetivo } = params
  const pesoKg = params.pesoKg ?? null
  const avisos: string[] = []

  const { custoTotal, embalagemPctPreco } = custoBase(cfg, custoProduto)
  const regimes = montarRegimes(cfg, custoProduto, pesoKg, params.freteFaixas)

  // Acha o preço: resolve em cada regime e fica com as soluções coerentes.
  let preco: number
  if (objetivo.tipo === 'preco') {
    preco = objetivo.valor
  } else {
    const candidatos: number[] = []
    for (const r of regimes) {
      const p = precoNoRegime(r, custoTotal, embalagemPctPreco, objetivo)
      if (p != null && p > 0 && dentroDoRegime(r, p)) candidatos.push(p)
    }
    if (candidatos.length > 0) {
      // Mais de uma solução coerente pode existir em cima de um degrau (ex.:
      // logo abaixo e logo acima do frete grátis). Escolhe a mais barata —
      // é a mais competitiva, e a margem pedida está garantida nas duas.
      preco = Math.min(...candidatos)
    } else {
      // Nenhum regime fecha: acontece quando a margem pedida é impossível
      // com as taxas configuradas. Usa o último regime e avisa em vez de
      // devolver um número que finge estar certo.
      const ultimo = regimes[regimes.length - 1]
      const p = ultimo ? precoNoRegime(ultimo, custoTotal, embalagemPctPreco, objetivo) : null
      if (p == null || p <= 0) {
        avisos.push('As taxas configuradas somam 100% ou mais do preço — com esses valores nenhum preço atinge o objetivo.')
        preco = 0
      } else {
        preco = p
        avisos.push('O preço calculado não se encaixou em nenhuma faixa de comissão configurada. Confira as faixas.')
      }
    }
  }

  if (params.arredondamento && params.arredondamento !== 'nenhum' && preco > 0) {
    preco = arredondar(preco, params.arredondamento)
  }
  preco = BRL(preco)

  // Com o preço na mão, tudo vira valor em reais.
  const faixa = faixaComissao(cfg, preco)
  const comissao = BRL(preco * (faixa.percentual / 100) + faixa.fixo)
  // O detalhamento precisa mostrar o MESMO frete que o preço usou. Quando a
  // escada veio importada do marketplace, ela manda aqui também — senão a
  // tela exibiria o custo médio digitado enquanto a conta usou outro número.
  const frete = BRL(params.freteFaixas?.length
    ? freteDaFaixa(params.freteFaixas, preco)
    : freteEm(cfg, preco, pesoKg))

  const valorDe = (item: ItemCusto | null | undefined): number => {
    if (!item || !item.valor) return 0
    if (item.tipo === 'fixo') return item.valor
    return (item.base ?? 'preco') === 'custo' ? custoProduto * (item.valor / 100) : preco * (item.valor / 100)
  }
  const somaDe = (itens: ItemCusto[] | null | undefined) => (itens ?? []).reduce((s, i) => s + valorDe(i), 0)

  const embalagem = BRL(valorDe(cfg.embalagem))
  const imposto = BRL(valorDe(cfg.imposto))
  const outrasTaxas = BRL(somaDe(cfg.taxas))
  const custosExtras = BRL(somaDe(cfg.custosExtras))

  const totalDeducoes = BRL(comissao + frete + imposto + outrasTaxas + custosExtras)
  const custoComEmbalagem = BRL(custoProduto + embalagem)
  const lucro = BRL(preco - custoComEmbalagem - totalDeducoes)
  const valorLiquido = BRL(preco - comissao - frete - outrasTaxas)

  const linhas: LinhaCalculo[] = [
    { rotulo: 'Preço de venda', valor: preco, sinal: '=' },
    { rotulo: 'Custo do produto', valor: custoProduto, sinal: '-' },
  ]
  if (embalagem) linhas.push({ rotulo: 'Embalagem', valor: embalagem, sinal: '-', detalhe: descreverItem(cfg.embalagem) })
  if (comissao) {
    linhas.push({
      rotulo: 'Comissão do marketplace', valor: comissao, sinal: '-',
      detalhe: `${faixa.percentual}%${faixa.fixo ? ` + R$ ${faixa.fixo.toFixed(2)}` : ''}`,
    })
  }
  if (frete) {
    linhas.push({
      rotulo: 'Frete', valor: frete, sinal: '-',
      detalhe: cfg.freteModo === 'gratis_acima' ? `frete grátis a partir de R$ ${(cfg.freteLimiteGratis ?? 0).toFixed(2)}` : undefined,
    })
  }
  for (const t of cfg.taxas ?? []) {
    const v = BRL(valorDe(t)); if (v) linhas.push({ rotulo: t.nome, valor: v, sinal: '-', detalhe: descreverItem(t) })
  }
  if (imposto) linhas.push({ rotulo: cfg.imposto?.nome || 'Imposto', valor: imposto, sinal: '-', detalhe: descreverItem(cfg.imposto) })
  for (const c of cfg.custosExtras ?? []) {
    const v = BRL(valorDe(c)); if (v) linhas.push({ rotulo: c.nome, valor: v, sinal: '-', detalhe: descreverItem(c) })
  }
  linhas.push({ rotulo: 'Lucro', valor: lucro, sinal: '=' })

  if (lucro < 0) avisos.push('Este preço dá prejuízo: as deduções superam o que sobra do custo.')

  return {
    preco,
    custoProduto,
    custoTotal: custoComEmbalagem,
    comissao, frete, imposto, embalagem, outrasTaxas, custosExtras, totalDeducoes,
    lucro,
    margemLiquida: preco > 0 ? (lucro / preco) * 100 : 0,
    markup: custoComEmbalagem > 0 ? preco / custoComEmbalagem : 0,
    roi: custoComEmbalagem > 0 ? (lucro / custoComEmbalagem) * 100 : 0,
    valorLiquido,
    diasRecebimento: cfg.diasRecebimento ?? null,
    linhas,
    avisos,
  }
}

function descreverItem(item: ItemCusto | null | undefined): string | undefined {
  if (!item || !item.valor) return undefined
  if (item.tipo === 'fixo') return `R$ ${item.valor.toFixed(2)} fixo`
  return `${item.valor}% ${(item.base ?? 'preco') === 'custo' ? 'do custo' : 'do preço'}`
}

export function arredondar(valor: number, regra: string): number {
  if (regra === 'cima_inteiro') return Math.ceil(valor)
  if (regra === 'terminar_90' || regra === 'terminar_99') {
    const base = Math.floor(valor)
    const decimal = regra === 'terminar_90' ? 0.9 : 0.99
    // Arredondar sempre pra cima: descer o preço comeria a margem pedida.
    const candidato = base + decimal
    return BRL(candidato >= valor ? candidato : base + 1 + decimal)
  }
  return BRL(valor)
}

// ─────────────────────────────────────────────────────────────
// Saúde da precificação
// ─────────────────────────────────────────────────────────────

export const FAIXAS_SAUDE_PADRAO = { critica: 5, baixa: 10, saudavel: 20 }

export function saudeDaMargem(margemLiquida: number, faixas = FAIXAS_SAUDE_PADRAO): SaudePreco {
  if (margemLiquida < 0) return 'prejuizo'
  if (margemLiquida < faixas.critica) return 'critica'
  if (margemLiquida < faixas.baixa) return 'baixa'
  if (margemLiquida < faixas.saudavel) return 'saudavel'
  return 'excelente'
}

export const ROTULO_SAUDE: Record<SaudePreco, { emoji: string; texto: string; cor: string }> = {
  prejuizo:  { emoji: '🔴', texto: 'Prejuízo',        cor: 'text-red-700 bg-red-50 border-red-200' },
  critica:   { emoji: '🟠', texto: 'Margem crítica',  cor: 'text-orange-700 bg-orange-50 border-orange-200' },
  baixa:     { emoji: '🟡', texto: 'Margem baixa',    cor: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
  saudavel:  { emoji: '🟢', texto: 'Margem saudável', cor: 'text-green-700 bg-green-50 border-green-200' },
  excelente: { emoji: '💎', texto: 'Excelente',       cor: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
}
