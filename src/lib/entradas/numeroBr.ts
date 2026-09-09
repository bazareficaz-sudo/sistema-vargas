// LER UM NÚMERO DIGITADO POR GENTE QUE ESCREVE 1.234,50.
//
// O código deste projeto vinha fazendo `parseFloat(texto.replace(',', '.'))`.
// Isso erra em dois casos, e os dois aparecem em campo de dinheiro:
//
//   parseFloat("118,")      → 118      (a vírgula some enquanto se digita, e
//                                       o campo controlado devolve "118" —
//                                       era por isso que só dava para
//                                       informar valor inteiro)
//   "1.234,50" → replace troca só a PRIMEIRA vírgula → "1.234.50"
//   parseFloat("1.234.50")  → 1.234    (uma parcela de mil e duzentos vira
//                                       um real e vinte e três)
//
// A regra aqui é a que uma pessoa usa ao ler: A ÚLTIMA PONTUAÇÃO É A
// DECIMAL, o resto é separador de milhar. Quando só existe ponto, e ele
// separa exatamente três dígitos no fim, ele é milhar — "1.234" é mil
// duzentos e trinta e quatro, não um vírgula dois. É a leitura correta em
// português, e é a que evita o erro caro: subestimar um valor em mil vezes
// é bem pior do que arredondar um centavo.

const SO_NUMERO = /[^0-9.,-]/g

export function paraNumeroBr(texto: string | number | null | undefined): number {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : 0
  const bruto = String(texto ?? '').trim().replace(SO_NUMERO, '')
  if (!bruto) return 0

  const negativo = bruto.startsWith('-')
  const corpo = bruto.replace(/-/g, '')
  if (!corpo) return 0

  const ultimaVirgula = corpo.lastIndexOf(',')
  const ultimoPonto = corpo.lastIndexOf('.')
  const sep = Math.max(ultimaVirgula, ultimoPonto)

  let valor: number
  if (sep < 0) {
    valor = Number(corpo) || 0
  } else {
    const depois = corpo.slice(sep + 1)
    const antes = corpo.slice(0, sep)
    const soPontos = ultimaVirgula < 0
    // Ponto único separando três dígitos, com algo antes: é milhar.
    const ehMilhar = soPontos && depois.length === 3 && antes.length > 0 && /^[0-9]+$/.test(depois)
    if (ehMilhar) {
      valor = Number(corpo.replace(/\./g, '')) || 0
    } else {
      const inteiro = antes.replace(/[.,]/g, '')
      const fracao = depois.replace(/[^0-9]/g, '')
      valor = Number(`${inteiro || '0'}.${fracao || '0'}`) || 0
    }
  }

  return negativo ? -valor : valor
}

/** Como o número volta a aparecer quando o campo perde o foco. */
export function formatarNumeroBr(valor: number, decimais = 2): string {
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: decimais,
    maximumFractionDigits: decimais,
  })
}

/**
 * Como o número aparece ENQUANTO se edita: sem separador de milhar.
 *
 * De propósito — o ponto de milhar que a tela mesma escreve é o que depois
 * confunde a leitura de volta. Sem ele, o texto que sai do campo é o mesmo
 * que uma pessoa digitaria.
 */
export function paraEdicaoBr(valor: number, decimais = 2): string {
  return valor.toFixed(decimais).replace('.', ',')
}
