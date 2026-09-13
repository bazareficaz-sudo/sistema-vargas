import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validarNovoMovimento, calcularSaldo, prepararEstorno } from '../../src/lib/caixa/movimento'

// O CONTRATO DO LEDGER (Fase 1 — só tesouraria).
//
// Não existe controle de caixa hoje (docs/auditoria/FASE-0-CONTROLE-DE-CAIXA.md):
// nenhuma tabela financeira do sistema tem teste que toque em dinheiro. Esta
// fase começa a fechar essa lacuna pela parte pura — validação de lançamento,
// cálculo de saldo e regra de estorno — que é o que a rota de servidor chama
// antes de qualquer INSERT no ledger.

describe('validarNovoMovimento — o que pode nascer no ledger', () => {
  test('aporte só pode ser entrada', () => {
    const r = validarNovoMovimento({ tipo: 'saida', natureza: 'aporte', valor: 100 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /só pode ser entrada/)
  })

  test('retirada de sócio só pode ser saída', () => {
    const r = validarNovoMovimento({ tipo: 'entrada', natureza: 'retirada_socio', valor: 100 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /só pode ser saída/)
  })

  test('depósito no banco só pode ser saída (dinheiro saindo da tesouraria física)', () => {
    const r = validarNovoMovimento({ tipo: 'entrada', natureza: 'deposito_banco', valor: 500 })
    assert.equal(r.ok, false)
  })

  test('ajuste aceita entrada, para sobra de contagem', () => {
    const r = validarNovoMovimento({ tipo: 'entrada', natureza: 'ajuste', valor: 12.5 })
    assert.equal(r.ok, true)
  })

  test('ajuste aceita saída, para falta de contagem', () => {
    const r = validarNovoMovimento({ tipo: 'saida', natureza: 'ajuste', valor: 12.5 })
    assert.equal(r.ok, true)
  })

  test('valor zero é recusado', () => {
    assert.equal(validarNovoMovimento({ tipo: 'entrada', natureza: 'aporte', valor: 0 }).ok, false)
  })

  test('valor negativo é recusado — o sinal vive em tipo, nunca em valor', () => {
    assert.equal(validarNovoMovimento({ tipo: 'entrada', natureza: 'aporte', valor: -50 }).ok, false)
  })

  test('SANGRIA NÃO EXISTE AINDA — é Fase 2, e depende de um caixa tipo=pdv que a Fase 1 não cria', () => {
    const r = validarNovoMovimento({ tipo: 'saida', natureza: 'sangria', valor: 200 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /inválida/)
  })

  test('forma de pagamento fora da lista é recusada', () => {
    const r = validarNovoMovimento({ tipo: 'entrada', natureza: 'aporte', valor: 100, forma_pagamento: 'boleto' })
    assert.equal(r.ok, false)
  })

  test('forma de pagamento ausente é aceita como null', () => {
    const r = validarNovoMovimento({ tipo: 'entrada', natureza: 'aporte', valor: 100 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.movimento.forma_pagamento, null)
  })

  test('observação em branco vira null, não string vazia', () => {
    const r = validarNovoMovimento({ tipo: 'entrada', natureza: 'aporte', valor: 100, observacao: '   ' })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.movimento.observacao, null)
  })

  test('valor com fração de centavo é arredondado', () => {
    const r = validarNovoMovimento({ tipo: 'entrada', natureza: 'aporte', valor: 100.006 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.movimento.valor, 100.01)
  })
})

describe('calcularSaldo — sempre soma, nunca uma coluna', () => {
  test('aporte de R$500 seguido de retirada de R$100 fecha em R$400', () => {
    const saldo = calcularSaldo([
      { tipo: 'entrada', valor: 500 },
      { tipo: 'saida', valor: 100 },
    ])
    assert.equal(saldo, 400)
  })

  test('caixa novo, sem nenhum movimento, tem saldo zero — não null, não erro', () => {
    assert.equal(calcularSaldo([]), 0)
  })

  test('estorno neutraliza o original automaticamente, sem regra especial', () => {
    // O estorno é só mais um movimento de sinal contrário — a soma já
    // resolve sozinha, sem o código precisar saber que uma das linhas é
    // reversão da outra.
    const saldo = calcularSaldo([
      { tipo: 'entrada', valor: 1000 }, // aporte errado
      { tipo: 'saida', valor: 1000 },   // estorno do aporte
    ])
    assert.equal(saldo, 0)
  })

  test('soma não acumula erro de ponto flutuante em muitos lançamentos de centavos', () => {
    // 0.1 + 0.2 !== 0.3 em ponto flutuante puro; a soma em centavos evita
    // que o saldo do dia feche com um resto de fração que ninguém explica.
    const movimentos = Array.from({ length: 10 }, () => ({ tipo: 'entrada' as const, valor: 0.1 }))
    assert.equal(calcularSaldo(movimentos), 1)
  })
})

describe('prepararEstorno — correção é movimento novo, nunca UPDATE/DELETE', () => {
  const aporte = { id: 'm1', tipo: 'entrada' as const, natureza: 'aporte' as const, valor: 300, estorno_de_id: null }

  test('reverter um aporte gera uma saída da mesma natureza e valor, referenciando o original', () => {
    const r = prepararEstorno(aporte, new Set())
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.deepEqual(r.estorno, { tipo: 'saida', natureza: 'aporte', valor: 300, estorno_de_id: 'm1' })
  })

  test('um estorno não pode ser estornado — evita corrente de reversões', () => {
    const estornoDoAporte = { id: 'm2', tipo: 'saida' as const, natureza: 'aporte' as const, valor: 300, estorno_de_id: 'm1' }
    const r = prepararEstorno(estornoDoAporte, new Set())
    assert.equal(r.ok, false)
  })

  test('o mesmo movimento não pode ser estornado duas vezes', () => {
    const r = prepararEstorno(aporte, new Set(['m1']))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /já foi estornado/)
  })
})
