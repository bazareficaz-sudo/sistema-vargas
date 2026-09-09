// RATEIO DE DESPESAS ACESSÓRIAS E ABATIMENTOS DA NOTA DE ENTRADA.
//
// Até aqui a entrada tinha três campos soltos no cabeçalho — Frete, Desconto
// e Outros — que entravam no total da nota e não encostavam no custo de
// produto nenhum. Isso faz o markup mentir exatamente onde ele mais importa:
// uma nota de R$ 1.000 com R$ 180 de frete custa 18% a mais do que o sistema
// acredita, e o preço de venda sai calculado sobre um custo que não existe.
//
// Aqui o encargo vira CUSTO DE AQUISIÇÃO: ele é distribuído entre os itens e
// passa a compor o custo unitário que alimenta `produtos.preco_custo` e o
// cálculo de venda.
//
// ── AS TRÊS DECISÕES QUE ESTE ARQUIVO TOMA ──────────────────────────────
//
//  1. QUEM RECEBE. O encargo pode valer para a nota inteira ou só para os
//     itens escolhidos — frete de uma máquina que veio sozinha em outro
//     caminhão não pode encarecer o parafuso que veio na mesma nota.
//
//  2. EM QUE PROPORÇÃO. Por VALOR (padrão, e o que a prática fiscal usa para
//     frete) ou por QUANTIDADE. Quantidade é o certo quando o custo é de
//     manuseio: 500 sacos de cimento e 1 pincel não dividem carreto pela
//     razão dos preços.
//
//  3. O QUE FAZER COM O CENTAVO QUE SOBRA. Rateio proporcional quase nunca
//     fecha na conta redonda. Distribuir e deixar a diferença cair fora seria
//     dinheiro sumindo em silêncio — o mesmo defeito que a tela tinha antes,
//     só que menor. A distribuição é feita em CENTAVOS INTEIROS pelo método
//     do maior resto, então a soma do que foi distribuído é EXATAMENTE o
//     valor do encargo. Sempre. E o que não coube em item nenhum (encargo
//     apontado para uma seleção vazia, por exemplo) sai em `naoRateado`, à
//     vista, nunca engolido.

export type TipoEncargo = 'frete' | 'seguro' | 'despesas' | 'outros' | 'desconto' | 'bonificacao'

/** Encargos que ABATEM o custo. Os demais encarecem. */
export const ENCARGO_ABATE: Record<TipoEncargo, boolean> = {
  frete: false, seguro: false, despesas: false, outros: false,
  desconto: true, bonificacao: true,
}

export const ENCARGO_LABEL: Record<TipoEncargo, string> = {
  frete: 'Frete',
  seguro: 'Seguro',
  despesas: 'Despesas acessórias',
  outros: 'Outros custos',
  desconto: 'Desconto',
  bonificacao: 'Bonificação',
}

export type Encargo = {
  id: string
  tipo: TipoEncargo
  descricao?: string | null
  /** Sempre positivo — quem decide o sinal é o tipo, não quem digita. */
  valor: number
  base: 'valor' | 'quantidade'
  /** Índices dos itens que recebem. Lista vazia = a nota inteira. */
  itens: number[]
}

export type ItemRateavel = { quantidade: number; precoUnitario: number }

export type ResultadoRateio = {
  /** Reais que cada item recebeu, já com sinal (+ encarece, − abate). */
  porItem: number[]
  /** Custo unitário final: preço da nota + rateio ÷ quantidade. Nunca negativo. */
  custoUnitarioFinal: number[]
  /** O que não coube em item nenhum. Continua no total da nota, fora do custo. */
  naoRateado: number
  alertas: string[]
}

const cent = (v: number) => Math.round(v * 100)
const real = (c: number) => c / 100
const duasCasas = (v: number) => Math.round(v * 100) / 100

/**
 * Distribui `totalCentavos` entre `pesos` de forma que a soma devolvida seja
 * exatamente `totalCentavos`.
 *
 * Piso para todo mundo e os centavos que sobram vão para os maiores restos —
 * é o método do maior resto, o mesmo que se usa para distribuir cadeiras por
 * proporção. O desempate é pelo maior peso e depois pelo menor índice, para
 * que a mesma nota rateada duas vezes dê o mesmo resultado nas duas.
 */
function distribuirCentavos(totalCentavos: number, pesos: number[]): number[] {
  const somaPesos = pesos.reduce((s, p) => s + p, 0)
  if (somaPesos <= 0) return pesos.map(() => 0)

  const negativo = totalCentavos < 0
  const total = Math.abs(totalCentavos)

  const exatos = pesos.map(p => (total * p) / somaPesos)
  const piso = exatos.map(Math.floor)
  let sobra = total - piso.reduce((s, v) => s + v, 0)

  const ordem = exatos
    .map((e, i) => ({ i, resto: e - Math.floor(e), peso: pesos[i] }))
    .sort((a, b) => b.resto - a.resto || b.peso - a.peso || a.i - b.i)

  const saida = [...piso]
  for (const { i } of ordem) {
    if (sobra <= 0) break
    saida[i] += 1
    sobra -= 1
  }
  return negativo ? saida.map(v => -v) : saida
}

export function ratear(itens: ItemRateavel[], encargos: Encargo[]): ResultadoRateio {
  const porItemCent = itens.map(() => 0)
  const alertas: string[] = []
  let naoRateadoCent = 0

  for (const enc of encargos) {
    const valor = Math.abs(Number(enc.valor) || 0)
    if (valor <= 0) continue
    const sinal = ENCARGO_ABATE[enc.tipo] ? -1 : 1
    const rotulo = enc.descricao?.trim() || ENCARGO_LABEL[enc.tipo]

    // Índice fora da lista é ignorado de propósito: itens podem ter sido
    // removidos depois que o encargo foi criado, e travar a tela por isso
    // seria pior do que ratear entre os que sobraram.
    const alvos = enc.itens.length > 0
      ? enc.itens.filter(i => i >= 0 && i < itens.length)
      : itens.map((_, i) => i)

    if (alvos.length === 0) {
      naoRateadoCent += sinal * cent(valor)
      alertas.push(`${rotulo}: nenhum item selecionado ainda — o valor entra no total da nota, mas não no custo dos produtos.`)
      continue
    }

    const pesoDe = (base: 'valor' | 'quantidade', i: number) =>
      base === 'valor'
        ? Math.max(0, itens[i].quantidade * itens[i].precoUnitario)
        : Math.max(0, itens[i].quantidade)

    let base = enc.base
    let pesos = itens.map((_, i) => (alvos.includes(i) ? pesoDe(base, i) : 0))

    // Rateio por valor entre itens que custam zero (produto novo ainda sem
    // custo, bonificação em mercadoria) dividiria por zero. Cai para
    // quantidade em vez de descartar o encargo — e diz que caiu.
    if (pesos.reduce((s, p) => s + p, 0) <= 0 && base === 'valor') {
      base = 'quantidade'
      pesos = itens.map((_, i) => (alvos.includes(i) ? pesoDe(base, i) : 0))
      if (pesos.reduce((s, p) => s + p, 0) > 0) {
        alertas.push(`${rotulo}: os itens escolhidos somam custo zero — rateado por quantidade.`)
      }
    }

    if (pesos.reduce((s, p) => s + p, 0) <= 0) {
      naoRateadoCent += sinal * cent(valor)
      alertas.push(`${rotulo}: os itens escolhidos não têm valor nem quantidade — não foi possível ratear.`)
      continue
    }

    const fatias = distribuirCentavos(sinal * cent(valor), pesos)
    for (let i = 0; i < itens.length; i++) porItemCent[i] += fatias[i]
  }

  const porItem = porItemCent.map(real)

  const custoUnitarioFinal = itens.map((it, i) => {
    const qtd = Number(it.quantidade) || 0
    if (qtd <= 0) return duasCasas(it.precoUnitario)
    const bruto = it.precoUnitario + porItem[i] / qtd
    if (bruto < 0) {
      // Abatimento maior que o próprio custo do item. Gravar custo negativo
      // em `produtos.preco_custo` contaminaria todo cálculo de margem depois,
      // então para em zero — mas isso é um aviso, não um detalhe.
      alertas.push(`Item ${i + 1}: o abatimento é maior que o custo — custo unitário ficou em zero.`)
      return 0
    }
    return duasCasas(bruto)
  })

  return { porItem, custoUnitarioFinal, naoRateado: real(naoRateadoCent), alertas }
}

/** Soma dos encargos que encarecem menos a dos que abatem — o efeito no total da nota. */
export function totalDosEncargos(encargos: Encargo[]): number {
  return duasCasas(encargos.reduce(
    (s, e) => s + (ENCARGO_ABATE[e.tipo] ? -1 : 1) * Math.abs(Number(e.valor) || 0), 0,
  ))
}

/** Soma por tipo — usada para alimentar as colunas antigas de `entradas`. */
export function somaPorTipo(encargos: Encargo[], tipos: TipoEncargo[]): number {
  return duasCasas(encargos
    .filter(e => tipos.includes(e.tipo))
    .reduce((s, e) => s + Math.abs(Number(e.valor) || 0), 0))
}
