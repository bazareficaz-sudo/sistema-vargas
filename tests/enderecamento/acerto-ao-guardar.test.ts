import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { acertoAoGuardar } from '../../src/lib/enderecamento/estoque'

describe('guardar o que chegou com endereço desatualizado', () => {
  test('cabe no depósito: só soma', () => {
    assert.deepEqual(acertoAoGuardar({ anterior: 5, recebida: 10, totalDeposito: 20, outros: [] }), { nova: 15, cortesOutros: [], acerto: 0 })
  })

  test('caso real: endereço marcava 13, depósito tinha 8, chegaram 10 → fica com 18', () => {
    const r = acertoAoGuardar({ anterior: 13, recebida: 10, totalDeposito: 18, outros: [] })
    assert.equal(r.nova, 18)
    assert.equal(r.acerto, 5)
    assert.deepEqual(r.cortesOutros, [])
  })

  test('o excesso sai primeiro do próprio endereço, depois dos outros (mais cheio primeiro)', () => {
    // Depósito 12 após a entrada de 10; endereço 3, outros 6 e 2 → 21, excesso 9.
    const r = acertoAoGuardar({ anterior: 3, recebida: 10, totalDeposito: 12, outros: [{ id: 'b', quantidade: 2 }, { id: 'a', quantidade: 6 }] })
    assert.equal(r.nova, 10)
    assert.deepEqual(r.cortesOutros, [{ id: 'a', de: 6, para: 0 }])
    assert.equal(r.acerto, 9)
  })

  test('escolher outro endereço: o recebido entra inteiro e o endereço velho é acertado', () => {
    const r = acertoAoGuardar({ anterior: 0, recebida: 10, totalDeposito: 18, outros: [{ id: 'velho', quantidade: 13 }] })
    assert.equal(r.nova, 10)
    assert.deepEqual(r.cortesOutros, [{ id: 'velho', de: 13, para: 8 }])
  })

  test('vendeu parte do recebido antes de guardar: guarda só o que existe', () => {
    const r = acertoAoGuardar({ anterior: 4, recebida: 10, totalDeposito: 7, outros: [] })
    assert.equal(r.nova, 7)
  })

  test('depósito zerado ou negativo: nada a guardar', () => {
    assert.equal(acertoAoGuardar({ anterior: 2, recebida: 3, totalDeposito: -1, outros: [] }).nova, 0)
  })

  test('a soma final nunca passa do depósito', () => {
    for (const [anterior, recebida, total, o1, o2] of [[13, 10, 18, 0, 0], [5, 5, 6, 4, 9], [0, 20, 25, 30, 1], [7, 1, 100, 3, 3]]) {
      const outros = [{ id: 'x', quantidade: o1 }, { id: 'y', quantidade: o2 }]
      const r = acertoAoGuardar({ anterior, recebida, totalDeposito: total, outros })
      const outrosDepois = outros.reduce((s, o) => s + (r.cortesOutros.find(c => c.id === o.id)?.para ?? o.quantidade), 0)
      assert.ok(r.nova + outrosDepois <= Math.max(0, total), `${anterior},${recebida},${total}`)
    }
  })
})
