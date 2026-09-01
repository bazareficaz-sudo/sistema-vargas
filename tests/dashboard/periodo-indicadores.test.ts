import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { periodoDosIndicadores } from '../../src/lib/dashboard/periodo'

// O caso real, reportado em 01/09/2026.
//
// Pergunta: "levando o histórico de venda de agosto, mensure um valor seguro
// para reposição". Resposta da IA: "Agosto apresenta R$ 1.336,17 em vendas".
//
// Agosto teve R$ 51.498,04 em 1.948 vendas. O R$ 1.336,17 era o faturamento
// do dia 1º de setembro — o único dia do mês corrente. O modelo não errou a
// conta: recebeu `faturamentoMes: 1336.17` sem data nenhuma e, perguntado
// sobre agosto, chamou de agosto o único número que tinha.

describe('o período dos indicadores do mês', () => {
  // Meio-dia para o resultado não depender do fuso em que o teste roda: às
  // 00:30 UTC do dia 1º, São Paulo ainda está no dia 31 do mês anterior.
  const emSaoPaulo = (iso: string) => new Date(`${iso}T12:00:00-03:00`)

  test('no dia 1º, o mês tem 1 dia decorrido e está incompleto', () => {
    const p = periodoDosIndicadores(emSaoPaulo('2026-09-01'))
    assert.equal(p.hoje, '2026-09-01')
    assert.equal(p.diasDecorridosDoMes, 1)
    assert.equal(p.diasNoMes, 30)
    assert.equal(p.mesIncompleto, true)
  })

  test('o intervalo vai do dia 1º até HOJE, não até o fim do mês', () => {
    // É a diferença entre "setembro" e "o que já aconteceu em setembro".
    const p = periodoDosIndicadores(emSaoPaulo('2026-09-01'))
    assert.equal(p.periodoDosIndicadoresDoMes, '2026-09-01 a 2026-09-01')
  })

  test('o mês de referência é nomeado — era o que faltava no prompt', () => {
    const p = periodoDosIndicadores(emSaoPaulo('2026-09-01'))
    assert.match(p.mesDeReferencia, /setembro/i)
    assert.doesNotMatch(p.mesDeReferencia, /agosto/i, 'o mês corrente não é agosto')
  })

  test('no último dia, o mês deixa de ser incompleto', () => {
    const p = periodoDosIndicadores(emSaoPaulo('2026-09-30'))
    assert.equal(p.diasDecorridosDoMes, 30)
    assert.equal(p.mesIncompleto, false)
  })

  test('fevereiro de ano bissexto tem 29 dias', () => {
    const p = periodoDosIndicadores(emSaoPaulo('2028-02-10'))
    assert.equal(p.diasNoMes, 29)
    assert.equal(p.mesIncompleto, true)
  })

  test('meses de 31 dias', () => {
    assert.equal(periodoDosIndicadores(emSaoPaulo('2026-01-15')).diasNoMes, 31)
    assert.equal(periodoDosIndicadores(emSaoPaulo('2026-12-31')).mesIncompleto, false)
  })
})
