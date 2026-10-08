import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { metricasContasReceber, somaEmAberto } from '../../src/lib/contas-receber/metricas'

// Cards de Contas a Receber. O caso que motivou: contas com 14 a 24 dias de
// atraso ainda com status "aberto" não entravam em "Vencido".

const HOJE = '2026-10-08'
const conta = (status: string, venc: string, valor: number) => ({ status, data_vencimento: venc, valor_aberto: valor })

describe('metricasContasReceber', () => {
  test('vencido é pela data, mesmo com status ainda "aberto"', () => {
    const m = metricasContasReceber([
      conta('aberto', '2026-09-14', 342.40),
      conta('aberto', '2026-09-21', 112.50),
      conta('aberto', '2026-09-22', 24.00),
    ], HOJE)
    assert.equal(m.totalVencido.toFixed(2), '478.90')
    assert.equal(m.qtdVencido, 3)
    assert.equal(m.totalAberto.toFixed(2), '478.90')
  })

  test('em aberto inclui a conta já marcada como vencida e a parcial', () => {
    const m = metricasContasReceber([
      conta('vencido', '2026-09-01', 100),
      conta('parcial', '2026-10-20', 50),
      conta('aberto', '2026-10-08', 30),
    ], HOJE)
    assert.equal(m.totalAberto, 180)
    assert.equal(m.totalVencido, 100)
    assert.equal(m.totalHoje, 30)
    // Próximos 30 dias: de hoje em diante, sem o que já venceu.
    assert.equal(m.totalEm30, 80)
  })

  test('recebida, renegociada e cancelada não contam; nem saldo zerado', () => {
    const m = metricasContasReceber([
      conta('recebido', '2026-09-01', 0),
      conta('renegociado', '2026-09-01', 200),
      conta('cancelado', '2026-09-01', 300),
      conta('aberto', '2026-09-01', 0),
    ], HOJE)
    assert.equal(m.totalAberto, 0)
    assert.equal(m.qtdAberto, 0)
  })

  test('depois de 30 dias fica fora de "Próximos 30d" mas dentro do total', () => {
    const m = metricasContasReceber([conta('aberto', '2026-11-07', 10), conta('aberto', '2026-11-08', 20)], HOJE)
    assert.equal(m.totalEm30, 10)
    assert.equal(m.totalAberto, 30)
  })

  test('soma da seleção', () => {
    assert.equal(somaEmAberto([conta('aberto', HOJE, 342.4), conta('aberto', HOJE, 112.5), { status: 'aberto', data_vencimento: HOJE, valor_aberto: null }]).toFixed(2), '454.90')
  })
})
