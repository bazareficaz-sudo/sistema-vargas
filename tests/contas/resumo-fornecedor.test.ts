import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resumoDoFornecedor, mesSeguinteDe } from '../../src/lib/contas/resumoFornecedor'

const HOJE = '2026-09-01'

describe('mês seguinte', () => {
  test('mês comum', () => assert.equal(mesSeguinteDe('2026-09-15'), '2026-10'))
  test('vira o ano em dezembro', () => assert.equal(mesSeguinteDe('2026-12-31'), '2027-01'))
  test('mês com um dígito ganha zero à esquerda', () =>
    assert.equal(mesSeguinteDe('2026-08-10'), '2026-09'))
})

describe('resumo do fornecedor — as três faixas', () => {
  const contas = [
    { vencimento: '2026-08-28', valor: 878.52, status: 'vencido' },   // venceu
    { vencimento: '2026-08-31', valor: 100, status: 'pendente' },     // venceu, status atrasado
    { vencimento: '2026-09-01', valor: 967.53, status: 'pendente' },  // hoje → este mês
    { vencimento: '2026-09-22', valor: 751.94, status: 'pendente' },  // este mês
    { vencimento: '2026-10-05', valor: 500, status: 'pendente' },     // mês seguinte
    { vencimento: '2026-11-05', valor: 300, status: 'pendente' },     // depois
  ]

  test('vencido, este mês e o seguinte', () => {
    const r = resumoDoFornecedor(contas, HOJE)
    assert.equal(r.vencido.quantidade, 2)
    assert.equal(r.vencido.total, 978.52)
    assert.equal(r.mesCorrente.quantidade, 2)
    assert.equal(r.mesCorrente.total, 1719.47)
    assert.equal(r.mesSeguinte.quantidade, 1)
    assert.equal(r.mesSeguinte.total, 500)
  })

  test('o que vence depois não some — aparece em `depois`', () => {
    // Sem isto um fornecedor com parcelas longas pareceria dever menos do
    // que deve: os três cartões somariam menos que o total em aberto.
    const r = resumoDoFornecedor(contas, HOJE)
    assert.equal(r.depois.quantidade, 1)
    assert.equal(r.depois.total, 300)
    assert.equal(
      r.vencido.total + r.mesCorrente.total + r.mesSeguinte.total + r.depois.total,
      r.totalAberto.total,
      'as quatro faixas somam exatamente o total em aberto',
    )
  })

  test('o que vence HOJE conta como a vencer, não como vencido', () => {
    const r = resumoDoFornecedor([{ vencimento: HOJE, valor: 50, status: 'pendente' }], HOJE)
    assert.equal(r.vencido.quantidade, 0)
    assert.equal(r.mesCorrente.quantidade, 1)
  })

  test('vencido sai da DATA, não do status', () => {
    // `atualizar_contas_vencidas` só roda quando a tela abre. Entre a virada
    // do dia e a próxima execução, uma conta vencida ainda está 'pendente' —
    // e o resumo não pode esperar por rotina nenhuma.
    const r = resumoDoFornecedor([{ vencimento: '2026-08-30', valor: 77, status: 'pendente' }], HOJE)
    assert.equal(r.vencido.quantidade, 1, 'a data já passou, então está vencida')
  })
})

describe('resumo do fornecedor — o que fica de fora', () => {
  test('paga e cancelada não entram', () => {
    // O resumo responde "quanto ainda devo". Somar o que já foi pago
    // inflaria os três números e levaria a pagar de novo.
    const r = resumoDoFornecedor([
      { vencimento: '2026-08-01', valor: 1000, status: 'pago' },
      { vencimento: '2026-08-02', valor: 2000, status: 'cancelado' },
      { vencimento: '2026-08-03', valor: 30, status: 'vencido' },
    ], HOJE)
    assert.equal(r.totalAberto.total, 30)
    assert.equal(r.vencido.quantidade, 1)
  })

  test('conta sem vencimento é ignorada em vez de virar vencida', () => {
    const r = resumoDoFornecedor([{ vencimento: null, valor: 99, status: 'pendente' }], HOJE)
    assert.equal(r.totalAberto.quantidade, 0)
  })

  test('lista vazia devolve zeros, não NaN', () => {
    const r = resumoDoFornecedor([], HOJE)
    assert.equal(r.totalAberto.total, 0)
    assert.equal(r.vencido.total, 0)
  })
})

describe('resumo do fornecedor — a virada do ano', () => {
  test('em dezembro, o mês seguinte é janeiro do ano que vem', () => {
    const r = resumoDoFornecedor([
      { vencimento: '2026-12-20', valor: 10, status: 'pendente' },
      { vencimento: '2027-01-10', valor: 20, status: 'pendente' },
      { vencimento: '2027-02-10', valor: 40, status: 'pendente' },
    ], '2026-12-01')
    assert.equal(r.mesCorrente.total, 10)
    assert.equal(r.mesSeguinte.total, 20, 'janeiro de 2027 é o mês seguinte a dezembro de 2026')
    assert.equal(r.depois.total, 40)
  })
})
