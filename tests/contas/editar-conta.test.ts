import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { lerValor, patchDaEdicao } from '../../src/lib/contas/editarConta'

const HOJE = '2026-10-20'

describe('lerValor', () => {
  test('formatos brasileiros e com ponto', () => {
    assert.equal(lerValor('1.234,56'), 1234.56)
    assert.equal(lerValor('1234,5'), 1234.5)
    assert.equal(lerValor('1234.56'), 1234.56)
    assert.equal(lerValor('1.234'), 1234)
    assert.equal(lerValor('R$ 99'), 99)
    assert.equal(lerValor('12.5'), 12.5)
  })
  test('lixo vira null', () => {
    assert.equal(lerValor(''), null)
    assert.equal(lerValor('abc'), null)
    assert.equal(lerValor('1,2,3'), null)
  })
})

describe('patchDaEdicao', () => {
  const conta = { valor: 500, vencimento: '2026-10-15', status: 'vencido' }

  test('prorrogar um vencido o tira de vencido e guarda a data original', () => {
    const r = patchDaEdicao(conta, { vencimento: '2026-10-27' }, HOJE)
    assert.deepEqual(r.patch, { vencimento: '2026-10-27', data_vencimento: '2026-10-27', vencimento_original: '2026-10-15', status: 'pendente' })
  })

  test('antecipar para antes de hoje vira vencido', () => {
    const r = patchDaEdicao({ valor: 10, vencimento: '2026-10-30', status: 'pendente' }, { vencimento: '2026-10-19' }, HOJE)
    assert.equal(r.patch?.status, 'vencido')
  })

  test('vence hoje continua a vencer', () => {
    const r = patchDaEdicao(conta, { vencimento: HOJE }, HOJE)
    assert.equal(r.patch?.status, 'pendente')
  })

  test('mudar o valor guarda o original só na primeira vez', () => {
    assert.deepEqual(patchDaEdicao(conta, { valor: 480 }, HOJE).patch, { valor: 480, valor_original: 500 })
    const jaEditada = { ...conta, valor: 480, valor_original: 500 }
    assert.deepEqual(patchDaEdicao(jaEditada, { valor: 470 }, HOJE).patch, { valor: 470 })
  })

  test('status pendente esquecido em conta vencida é corrigido junto', () => {
    const r = patchDaEdicao({ valor: 10, vencimento: '2026-10-01', status: 'pendente' }, { valor: 12 }, HOJE)
    assert.equal(r.patch?.status, 'vencido')
  })

  test('nada mudou: sem patch', () => {
    assert.deepEqual(patchDaEdicao(conta, { valor: 500, vencimento: '2026-10-15' }, HOJE), { patch: null })
  })

  test('recusa valor zero, data inválida e conta paga', () => {
    assert.ok(patchDaEdicao(conta, { valor: 0 }, HOJE).erro)
    assert.ok(patchDaEdicao(conta, { valor: null }, HOJE).erro)
    assert.ok(patchDaEdicao(conta, { vencimento: '2026-13-40' }, HOJE).erro)
    assert.ok(patchDaEdicao({ ...conta, status: 'pago' }, { valor: 1 }, HOJE).erro)
  })
})
