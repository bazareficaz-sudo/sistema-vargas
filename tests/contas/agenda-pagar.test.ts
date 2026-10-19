import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  inicioDaSemana, intervaloDoPeriodo, painelDoPagar, passaNaSituacao, grupoDaConta,
  mesAMes, faixasDeAtraso, semanasAFrente, somarMeses, ultimoDiaDoMes, linhaCsv,
} from '../../src/lib/contas/agendaPagar'

// Segunda-feira, 19/10/2026.
const HOJE = '2026-10-19'

describe('datas', () => {
  test('semana de segunda a domingo', () => {
    assert.equal(inicioDaSemana('2026-10-19'), '2026-10-19')
    assert.equal(inicioDaSemana('2026-10-25'), '2026-10-19') // domingo
    assert.equal(inicioDaSemana('2026-10-22'), '2026-10-19')
    assert.equal(inicioDaSemana('2026-11-01'), '2026-10-26') // atravessa o mês
  })
  test('meses', () => {
    assert.equal(somarMeses('2026-12', 1), '2027-01')
    assert.equal(somarMeses('2026-01', -1), '2025-12')
    assert.equal(ultimoDiaDoMes('2028-02'), '2028-02-29')
  })
  test('atalhos de período', () => {
    assert.deepEqual(intervaloDoPeriodo('semana', '2026-10-22'), { de: '2026-10-19', ate: '2026-10-25' })
    assert.deepEqual(intervaloDoPeriodo('proxima_semana', HOJE), { de: '2026-10-26', ate: '2026-11-01' })
    assert.deepEqual(intervaloDoPeriodo('mes', HOJE), { de: '2026-10-01', ate: '2026-10-31' })
    assert.deepEqual(intervaloDoPeriodo('proximo_mes', '2026-12-10'), { de: '2027-01-01', ate: '2027-01-31' })
    assert.deepEqual(intervaloDoPeriodo('todos', HOJE), { de: null, ate: null })
    assert.deepEqual(intervaloDoPeriodo('personalizado', HOJE, '2026-10-01', ''), { de: '2026-10-01', ate: null })
  })
})

describe('situação', () => {
  test('vencido pela data, mesmo com status pendente', () => {
    const ontem = { vencimento: '2026-10-18', valor: 10, status: 'pendente' }
    assert.equal(passaNaSituacao(ontem, 'vencido', HOJE), true)
    assert.equal(passaNaSituacao(ontem, 'aberto', HOJE), true)
    assert.equal(passaNaSituacao(ontem, 'a_vencer', HOJE), false)
  })
  test('em aberto junta vencidos e a vencer; todos não traz cancelado', () => {
    const hoje = { vencimento: HOJE, valor: 10, status: 'vencido' } // status marcado errado à noite
    assert.equal(passaNaSituacao(hoje, 'a_vencer', HOJE), true)
    assert.equal(passaNaSituacao({ vencimento: HOJE, valor: 1, status: 'pago' }, 'aberto', HOJE), false)
    assert.equal(passaNaSituacao({ vencimento: HOJE, valor: 1, status: 'cancelado' }, 'todos', HOJE), false)
  })
})

describe('painel', () => {
  const contas = [
    { vencimento: '2026-09-10', valor: 100, status: 'vencido' },   // vencido de setembro
    { vencimento: '2026-10-16', valor: 50.1, status: 'vencido' },  // vencido de outubro
    { vencimento: '2026-10-19', valor: 200, status: 'pendente' },  // hoje
    { vencimento: '2026-10-21', valor: 300, status: 'pago' },      // semana, pago adiantado
    { vencimento: '2026-10-25', valor: 400, status: 'pendente' },  // domingo, semana
    { vencimento: '2026-10-30', valor: 500, status: 'pendente' },  // mês
    { vencimento: '2026-11-01', valor: 600, status: 'pendente' },  // próximo mês
    { vencimento: '2026-10-05', valor: 700, status: 'pago' },      // mês, pago
    { vencimento: '2026-10-20', valor: 999, status: 'cancelado' }, // fora de tudo
  ]
  const p = painelDoPagar(contas, HOJE)

  test('vencido de qualquer mês, com o mais antigo', () => {
    assert.deepEqual({ q: p.vencido.quantidade, t: p.vencido.total, a: p.vencido.maisAntigo }, { q: 2, t: 150.1, a: '2026-09-10' })
  })
  test('hoje', () => assert.deepEqual(p.hoje, { quantidade: 1, total: 200 }))
  test('semana: total, pago e o que falta', () => {
    assert.equal(p.semana.total, 900)
    assert.equal(p.semana.pago.total, 300)
    assert.equal(p.semana.aberto.total, 600)
    assert.equal(p.semana.de, '2026-10-19')
    assert.equal(p.semana.ate, '2026-10-25')
  })
  test('mês: tudo que vence em outubro, inclusive o já vencido', () => {
    assert.equal(p.mes.total, 2150.1)
    assert.equal(p.mes.pago.total, 1000)
    assert.equal(p.mes.aberto.total, 1150.1)
  })
  test('próximo mês e total em aberto', () => {
    assert.equal(p.proximoMes.total, 600)
    assert.equal(p.proximoMes.mes, '2026-11')
    assert.equal(p.totalAberto.total, 1850.1)
    assert.equal(p.totalAberto.quantidade, 6)
  })
})

describe('agrupar', () => {
  test('por semana, vencido vai para "Em atraso"', () => {
    assert.equal(grupoDaConta({ vencimento: '2026-10-16', valor: 1, status: 'pendente' }, 'semana', HOJE).rotulo, 'Em atraso')
    assert.equal(grupoDaConta({ vencimento: '2026-10-16', valor: 1, status: 'pago' }, 'semana', HOJE).rotulo, 'Semana passada · 12/10 a 18/10')
    assert.equal(grupoDaConta({ vencimento: '2026-10-22', valor: 1, status: 'pendente' }, 'semana', HOJE).rotulo, 'Esta semana · 19/10 a 25/10')
    assert.equal(grupoDaConta({ vencimento: '2026-10-27', valor: 1, status: 'pendente' }, 'semana', HOJE).rotulo, 'Semana que vem · 26/10 a 01/11')
  })
  test('por dia e por mês', () => {
    assert.equal(grupoDaConta({ vencimento: HOJE, valor: 1, status: 'pendente' }, 'dia', HOJE).rotulo, 'Hoje · seg 19/10')
    assert.equal(grupoDaConta({ vencimento: '2026-10-20', valor: 1, status: 'pendente' }, 'dia', HOJE).rotulo, 'Amanhã · ter 20/10')
    assert.equal(grupoDaConta({ vencimento: '2026-10-30', valor: 1, status: 'pendente' }, 'mes', HOJE).rotulo, 'outubro de 2026 (este mês)')
  })
})

describe('relatórios', () => {
  const contas = [
    { vencimento: '2026-09-10', valor: 100, status: 'pago' },
    { vencimento: '2026-09-12', valor: 40, status: 'vencido' },
    { vencimento: '2026-10-02', valor: 10, status: 'vencido' },
    { vencimento: '2026-10-28', valor: 20, status: 'pendente' },
    { vencimento: '2026-11-03', valor: 30, status: 'pendente' },
    { vencimento: '2027-08-01', valor: 1, status: 'pendente' }, // fora da janela
  ]
  test('mês a mês pelo vencimento', () => {
    const m = mesAMes(contas, HOJE, 1, 1)
    assert.deepEqual(m.map(l => l.mes), ['2026-09', '2026-10', '2026-11'])
    assert.deepEqual([m[0].total.total, m[0].pago.total, m[0].vencido.total], [140, 100, 40])
    assert.deepEqual([m[1].total.total, m[1].vencido.total, m[1].aVencer.total], [30, 10, 20])
    assert.equal(m[2].aVencer.total, 30)
  })
  test('faixas de atraso', () => {
    const f = faixasDeAtraso(contas, HOJE)
    assert.equal(f[2].total, 10) // 17 dias
    assert.equal(f[3].total, 40) // 37 dias
  })
  test('semanas à frente', () => {
    const s = semanasAFrente(contas, HOJE, 3)
    assert.deepEqual(s.map(w => [w.de, w.total]), [['2026-10-19', 0], ['2026-10-26', 20], ['2026-11-02', 30]])
  })
  test('csv', () => {
    assert.equal(linhaCsv(['a;b', 12.5, null, 'diz "oi"']), '"a;b";12,50;;"diz ""oi"""')
  })
})
