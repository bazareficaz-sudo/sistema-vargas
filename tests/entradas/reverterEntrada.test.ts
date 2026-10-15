import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { efeitoLiquidoPorProduto } from '../../src/lib/entradas/reverterEntrada'

const mov = (produto_id: string, estoque_anterior: number, estoque_novo: number) => ({ produto_id, estoque_anterior, estoque_novo })

describe('efeito líquido da entrada no estoque', () => {
  test('entrada simples: soma a quantidade', () => {
    assert.equal(efeitoLiquidoPorProduto([mov('a', 3, 13)]).get('a'), 10)
  })

  test('"zerar antes" com saldo positivo: o caso do disco (tinha 10, zerou e somou 10)', () => {
    // Desfazer não pode tirar 10 — o efeito líquido foi zero.
    assert.equal(efeitoLiquidoPorProduto([mov('d', 10, 0), mov('d', 0, 10)]).get('d'), 0)
  })

  test('"zerar antes" com saldo negativo: devolve o negativo também', () => {
    assert.equal(efeitoLiquidoPorProduto([mov('l', -45, 0), mov('l', 0, 50)]).get('l'), 95)
  })

  test('reversão já gravada com a mesma referência zera o efeito (idempotente)', () => {
    assert.equal(efeitoLiquidoPorProduto([mov('a', 3, 13), mov('a', 13, 3)]).get('a'), 0)
  })

  test('vários produtos e precisão de 3 casas', () => {
    const e = efeitoLiquidoPorProduto([mov('a', 0, 0.1), mov('a', 0.1, 0.3), mov('b', 1, 2)])
    assert.equal(e.get('a'), 0.3)
    assert.equal(e.get('b'), 1)
  })
})
