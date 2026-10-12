import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolverFornecedorId, sugestaoReposicao, abaixoDoMinimo, montarLinhasCompra, type ProdutoCompra } from '../../src/lib/faltas/listaCompra'

test('fornecedor: padrão > preferencial > última compra', () => {
  const hist = [
    { fornecedor_id: 'A', ultima_compra_em: '2026-09-01', preferencial: false },
    { fornecedor_id: 'B', ultima_compra_em: '2026-10-01', preferencial: false },
  ]
  assert.deepEqual(resolverFornecedorId('P', hist), { id: 'P', origem: 'padrao' })
  assert.deepEqual(resolverFornecedorId(null, hist), { id: 'B', origem: 'ultima_compra' })
  assert.deepEqual(resolverFornecedorId(null, [...hist, { fornecedor_id: 'C', ultima_compra_em: null, preferencial: true }]), { id: 'C', origem: 'preferencial' })
  assert.equal(resolverFornecedorId(null, []), null)
})

test('mínimo e sugestão', () => {
  assert.equal(abaixoDoMinimo(2, 5), true)
  assert.equal(abaixoDoMinimo(5, 5), false)
  assert.equal(abaixoDoMinimo(0, 0), false)
  assert.equal(sugestaoReposicao(-25, 25), 50)
  assert.equal(sugestaoReposicao(4.5, 5), 1)
})

test('junta falta do vendedor com abaixo do mínimo, uma linha por produto', () => {
  const p = (id: string, estoque: number, minimo: number): ProdutoCompra =>
    ({ id, nome: id, sku: null, unidade: 'UN', estoque, estoque_minimo: minimo, preco_custo: 1 })
  const produtos = new Map([['a', p('a', 1, 5)], ['b', p('b', 10, 3)], ['c', p('c', 0, 6)]])
  const faltas = [
    { id: '1', produto_id: 'a', quantidade_solicitada: 2, status: 'pendente', tipo: 'falta' },
    { id: '2', produto_id: 'b', quantidade_solicitada: 3, status: 'pendente', tipo: 'encomenda' },
    { id: '3', produto_id: 'b', quantidade_solicitada: 1, status: 'recebido', tipo: 'falta' },
    { id: '4', produto_id: null, quantidade_solicitada: 1, status: 'pendente', tipo: 'falta' },
  ]
  const linhas = montarLinhasCompra(faltas, produtos, new Map(), new Map([['c', '000020']]))
  assert.deepEqual(linhas.map(l => l.produtoId), ['b', 'a', 'c'])
  const [b, a, c] = linhas
  assert.equal(b.temEncomenda, true); assert.equal(b.automatico, false); assert.equal(b.quantidadeSugerida, 3)
  assert.equal(a.vendedor, true); assert.equal(a.automatico, true); assert.equal(a.quantidadeSugerida, 4)
  assert.equal(c.vendedor, false); assert.equal(c.automatico, true); assert.equal(c.noPedido, '000020')
})
