import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CORES, SUGERIDAS, corValida, diferenca, emOrdem, nomeCategoria, nomeRepetido } from '../../src/lib/clientes/categorias'

describe('categorias de cliente', () => {
  it('nome limpo, até 40 letras; vazio não vale', () => {
    assert.equal(nomeCategoria('  Bombeiro   hidráulico '), 'Bombeiro hidráulico')
    assert.equal(nomeCategoria('   '), null)
    assert.equal(nomeCategoria('x'.repeat(50))?.length, 40)
  })
  it('nome repetido sem diferenciar maiúscula (mesma regra do índice do banco)', () => {
    const lista = [{ id: '1', nome: 'Eletricista' }]
    assert.ok(nomeRepetido(lista, ' eletricista '))
    assert.ok(!nomeRepetido(lista, 'Eletricista', '1')) // renomear a própria
    assert.ok(!nomeRepetido(lista, 'Pedreiro'))
  })
  it('o que inserir e apagar ao salvar', () => {
    assert.deepEqual(diferenca(['a', 'b'], ['b', 'c']), { inserir: ['c'], apagar: ['a'] })
    assert.deepEqual(diferenca([], []), { inserir: [], apagar: [] })
  })
  it('cor fora da lista vira cinza; sugeridas usam cores válidas e nomes únicos', () => {
    assert.equal(corValida('preto'), 'cinza')
    assert.equal(corValida('azul'), 'azul')
    assert.ok(SUGERIDAS.every(s => s.cor in CORES))
    assert.equal(new Set(SUGERIDAS.map(s => s.nome.toLowerCase())).size, SUGERIDAS.length)
  })
  it('ordem alfabética em português', () => {
    assert.deepEqual(emOrdem([{ nome: 'Pedreiro' }, { nome: 'Eletricista' }, { nome: 'Árbitro' }]).map(c => c.nome), ['Árbitro', 'Eletricista', 'Pedreiro'])
  })
})
