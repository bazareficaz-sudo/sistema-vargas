import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarGrupoSimilar, chaveNome, contarNomesRepetidos, filtroNomeOuMarca,
} from '../../src/lib/produtos/similares'

// Produtos similares no PDV.
//
// O grupo é um rótulo digitado à mão no cadastro. Se dois jeitos de digitar o
// mesmo grupo virassem dois grupos, o produto sumiria dos similares sem
// ninguém perceber — e a busca por marca não pode quebrar com o que o
// vendedor digita no balcão.

describe('normalizarGrupoSimilar', () => {
  test('caixa e espaços não separam o mesmo grupo', () => {
    assert.equal(normalizarGrupoSimilar('  disjuntor   mono din 32a '), 'DISJUNTOR MONO DIN 32A')
    assert.equal(normalizarGrupoSimilar('DISJUNTOR MONO DIN 32A'), 'DISJUNTOR MONO DIN 32A')
  })

  test('vazio vira sem grupo', () => {
    assert.equal(normalizarGrupoSimilar(''), null)
    assert.equal(normalizarGrupoSimilar('   '), null)
    assert.equal(normalizarGrupoSimilar(null), null)
    assert.equal(normalizarGrupoSimilar(undefined), null)
  })
})

describe('contarNomesRepetidos', () => {
  test('nomes iguais com acento e caixa diferentes contam juntos', () => {
    const c = contarNomesRepetidos([
      { nome: 'Disjuntor Monopolar DIN 32A' },
      { nome: 'DISJUNTOR MONOPOLAR  DIN 32A' },
      { nome: 'Disjuntor Monopolar DIN 25A' },
    ])
    assert.equal(c.get(chaveNome('Disjuntor Monopolar DIN 32A')), 2)
    // 25A tem nome quase igual e NÃO é o mesmo produto.
    assert.equal(c.get(chaveNome('Disjuntor Monopolar DIN 25A')), 1)
  })

  test('acento não separa', () => {
    assert.equal(chaveNome('Tomada Padrão'), chaveNome('TOMADA PADRAO'))
  })
})

describe('filtroNomeOuMarca', () => {
  test('procura no nome e na marca', () => {
    assert.equal(filtroNomeOuMarca('steck'), 'nome.ilike."%steck%",marca.ilike."%steck%"')
  })

  test('vírgula decimal fica intacta, protegida pelas aspas', () => {
    assert.equal(filtroNomeOuMarca('2,5mm'), 'nome.ilike."%2,5mm%",marca.ilike."%2,5mm%"')
  })

  test('aspas, barra e curingas digitados saem', () => {
    assert.equal(filtroNomeOuMarca('32"a'), 'nome.ilike."%32a%",marca.ilike."%32a%"')
    assert.equal(filtroNomeOuMarca('10%'), 'nome.ilike."%10%",marca.ilike."%10%"')
    assert.equal(filtroNomeOuMarca('a*b\\'), 'nome.ilike."%ab%",marca.ilike."%ab%"')
  })

  test('termo que só tinha caracteres removidos não vira filtro', () => {
    assert.equal(filtroNomeOuMarca('%'), null)
    assert.equal(filtroNomeOuMarca('"*'), null)
  })
})
