// Cálculo do que sai do caixa quando uma ou várias contas são pagas juntas.
//
// Fica separado da tela de propósito: é a única parte de Contas a Pagar que
// mexe em dinheiro, e dinheiro que só existe dentro de um componente React
// não tem como ser conferido nem testado.

export type ModoAcrescimo = 'nenhum' | 'detalhado' | 'total'
export type Unidade = 'reais' | 'percentual'

export type EntradaPagamento = {
  modo: ModoAcrescimo
  juros: number; jurosUnidade: Unidade
  multa: number; multaUnidade: Unidade
  desconto: number; descontoUnidade: Unidade
  totalPago: number          // usado só quando modo === 'total'
}

export type RateioConta = {
  id: string
  valor: number
  juros: number
  multa: number
  desconto: number
  valorPago: number
}

export const ENTRADA_VAZIA: EntradaPagamento = {
  modo: 'nenhum',
  juros: 0, jurosUnidade: 'reais',
  multa: 0, multaUnidade: 'reais',
  desconto: 0, descontoUnidade: 'reais',
  totalPago: 0,
}

function aplicar(base: number, valor: number, unidade: Unidade) {
  if (!valor) return 0
  return unidade === 'percentual' ? (base * valor) / 100 : valor
}

function centavos(v: number) { return Math.round(v * 100) / 100 }

/**
 * Distribui juros/multa/desconto entre as contas selecionadas.
 *
 * O rateio é proporcional ao valor de cada conta — quem devia mais absorve
 * mais juros. A sobra de arredondamento vai toda para a última conta, senão
 * a soma das partes não fecha com o total informado e o caixa fica com uma
 * diferença de centavos que ninguém consegue explicar depois.
 */
export function calcularRateio(
  contas: { id: string; valor: number }[],
  entrada: EntradaPagamento,
): { itens: RateioConta[]; totalDevido: number; totalJuros: number; totalMulta: number; totalDesconto: number; totalPago: number } {
  const totalDevido = centavos(contas.reduce((s, c) => s + Number(c.valor || 0), 0))

  let totalJuros = 0, totalMulta = 0, totalDesconto = 0

  if (entrada.modo === 'detalhado') {
    totalJuros = centavos(aplicar(totalDevido, entrada.juros, entrada.jurosUnidade))
    totalMulta = centavos(aplicar(totalDevido, entrada.multa, entrada.multaUnidade))
    totalDesconto = centavos(aplicar(totalDevido, entrada.desconto, entrada.descontoUnidade))
  } else if (entrada.modo === 'total') {
    // O usuário informa quanto pagou; a diferença se explica sozinha.
    // Pagou mais que o devido → juros. Pagou menos → desconto.
    const dif = centavos(Number(entrada.totalPago || 0) - totalDevido)
    if (dif > 0) totalJuros = dif
    else if (dif < 0) totalDesconto = -dif
  }

  const totalPago = centavos(totalDevido + totalJuros + totalMulta - totalDesconto)

  const itens: RateioConta[] = []
  let acJuros = 0, acMulta = 0, acDesconto = 0

  contas.forEach((c, i) => {
    const valor = centavos(Number(c.valor || 0))
    const ultimo = i === contas.length - 1
    const peso = totalDevido > 0 ? valor / totalDevido : 0

    const juros = ultimo ? centavos(totalJuros - acJuros) : centavos(totalJuros * peso)
    const multa = ultimo ? centavos(totalMulta - acMulta) : centavos(totalMulta * peso)
    const desconto = ultimo ? centavos(totalDesconto - acDesconto) : centavos(totalDesconto * peso)

    acJuros += juros; acMulta += multa; acDesconto += desconto

    itens.push({ id: c.id, valor, juros, multa, desconto, valorPago: centavos(valor + juros + multa - desconto) })
  })

  return { itens, totalDevido, totalJuros, totalMulta, totalDesconto, totalPago }
}
