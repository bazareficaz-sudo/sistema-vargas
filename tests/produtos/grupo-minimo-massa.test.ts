import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sugerirNomeGrupo } from '../../src/lib/produtos/similares'
import { minimoPorDias, minimosPorValor } from '../../src/lib/estoque/minimoEmMassa'

describe('nome sugerido do grupo de similares', () => {
  test('palavras em comum no começo', () => {
    assert.equal(sugerirNomeGrupo(['Disjuntor Mono 32A Steck', 'DISJUNTOR MONO 32A WEG']), 'DISJUNTOR MONO 32A')
  })
  test('uma palavra só em comum não basta: usa o nome do primeiro', () => {
    assert.equal(sugerirNomeGrupo(['Cabo flexível 2,5mm', 'Cabo PP 3x1,5']), 'CABO FLEXÍVEL 2,5MM')
  })
  test('lista vazia', () => assert.equal(sugerirNomeGrupo([]), null))
})

describe('estoque mínimo por dias de venda', () => {
  test('arredonda para cima e vale pelo menos 1', () => {
    assert.equal(minimoPorDias(0.4, 30), 12)
    assert.equal(minimoPorDias(0.01, 30), 1)
    assert.equal(minimoPorDias(0, 30), null)
    assert.equal(minimoPorDias(null, 30), null)
  })
  test('agrupa por valor e trata quem não vendeu', () => {
    const medias = new Map([['a', 0.5], ['b', 0.5], ['c', 2]])
    const r = minimosPorValor(['a', 'b', 'c', 'd'], medias, 10, null)
    assert.deepEqual([...r.porValor.entries()], [[5, ['a', 'b']], [20, ['c']]])
    assert.deepEqual([r.comVenda, r.semVendaQtd], [3, 1])
    const r2 = minimosPorValor(['d'], medias, 10, 2)
    assert.deepEqual([...r2.porValor.entries()], [[2, ['d']]])
  })
})
