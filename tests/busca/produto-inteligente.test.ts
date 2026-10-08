import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { montarGrupos } from '../../src/lib/busca/produtoInteligente'

// Caso real de 07/10/2026: "temos quantos disjuntores de 32a mono da
// Guepar?" não achava "GUEPAR DISJUNTOR MONOPOLAR - 32A".
const casa = (grupos: string[][], nome: string) => {
  const n = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return grupos.every(g => g.some(a => n.includes(a)))
}

describe('frase do dono → termos de busca', () => {
  test('o caso do disjuntor: tira palavras vazias, plural, unidade e sinônimo', () => {
    const g = montarGrupos('Entendi, temos quantos disjuntores de 32a mono da Guepar?')
    assert.ok(casa(g, 'GUEPAR DISJUNTOR MONOPOLAR - 32A'))
    assert.ok(!casa(g, 'GUEPAR DISJUNTOR BIPOLAR - 32A'), 'bipolar não é mono')
    assert.ok(!casa(g, 'GUEPAR DISJUNTOR MONOPOLAR - 16A'), '16A não é 32A')
  })

  test('"32 amperes monofásico" acha o mesmo produto, e acha unipolar/1P de outra marca', () => {
    const g = montarGrupos('qual o estoque dos disjuntores de 32 amperes monofásicos')
    assert.ok(casa(g, 'GUEPAR DISJUNTOR MONOPOLAR - 32A'))
    assert.ok(casa(g, 'STECK DISJUNTOR 1P 32A CURVA C 3KA SDD61C32'))
    assert.ok(casa(g, 'DISJUNTOR DIN SIEMENS MONO 32A'))
  })

  test('acento e caixa não importam; gênero e plural também não', () => {
    const g = montarGrupos('torneiras elétricas brancas')
    assert.ok(casa(g, 'TORNEIRA ELÉTRICA BRANCO 5500W'))
  })

  test('abreviação de cadastro: "parafuso" acha "PARAF"', () => {
    const g = montarGrupos('parafuso mdf 4,0 x 20mm')
    assert.ok(casa(g, 'PARAF MDF CH 4,0 X 20MM'))
  })

  test('"bi" e "tri" viram bipolar/tripolar', () => {
    assert.ok(casa(montarGrupos('disjuntor bi 32a'), 'GUEPAR DISJUNTOR BIPOLAR - 32A'))
    assert.ok(casa(montarGrupos('disjuntor tri 32a'), 'GUEPAR DISJUNTOR TRIPLOR - 32A'))
  })

  test('frase só de palavras vazias não vira busca', () => {
    assert.deepEqual(montarGrupos('quantos tem no estoque?'), [])
  })
})
