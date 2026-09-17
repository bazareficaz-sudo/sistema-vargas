import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  construirIndiceProdutos, buscarProduto, estoqueDoProduto, calcularLucroVenda,
  markupItem, corMarkup, corMargem, situacaoEstoque, sugestaoDeCompra,
  type ProdutoCache, type ItemVendido, type KitComponente,
} from '../../src/lib/monitor-vendas/calculos'

const produto = (p: Partial<ProdutoCache> & { id: string }): ProdutoCache => ({
  nome: 'Produto', sku: null, ean: null, categoria: null, marca: null, unidade: 'UN',
  custo: 0, estoque: 0, estoqueMinimo: 0, tipo: 'simples', ativo: true, ...p,
})

const item = (i: Partial<ItemVendido> & { produto_nome: string }): ItemVendido => ({
  produto_id: null, produto_sku: null, quantidade: 1, preco_unitario: 0, desconto: 0, subtotal: 0, ...i,
})

describe('buscarProduto — ordem id → sku → nome', () => {
  const catalogo = [
    produto({ id: 'p1', nome: 'PARAFUSO 3/4', sku: 'SKU1', custo: 2 }),
    produto({ id: 'p2', nome: 'BUCHA 6MM', sku: 'SKU2', custo: 1 }),
  ]
  const indice = construirIndiceProdutos(catalogo)

  test('casa pelo id quando presente', () => {
    const achado = buscarProduto(indice, { produto_id: 'p2', produto_sku: 'SKU1', produto_nome: 'qualquer' })
    assert.equal(achado?.id, 'p2')
  })

  test('sem id, casa pelo SKU', () => {
    const achado = buscarProduto(indice, { produto_id: null, produto_sku: 'SKU1', produto_nome: 'qualquer' })
    assert.equal(achado?.id, 'p1')
  })

  test('sem id nem SKU, casa pelo nome — ignorando maiúsculas e espaços nas pontas', () => {
    const achado = buscarProduto(indice, { produto_id: null, produto_sku: null, produto_nome: '  bucha 6mm  ' })
    assert.equal(achado?.id, 'p2')
  })

  test('produto excluído do cadastro não casa com nada', () => {
    const achado = buscarProduto(indice, { produto_id: 'sumiu', produto_sku: 'SUMIU', produto_nome: 'sumiu' })
    assert.equal(achado, undefined)
  })
})

describe('calcularLucroVenda — custo sempre vem do catálogo', () => {
  const catalogo = [produto({ id: 'p1', nome: 'FURADEIRA', custo: 100 })]
  const indice = construirIndiceProdutos(catalogo)
  const semKits = new Map<string, KitComponente[]>()

  test('lucro = total − custo − desconto', () => {
    const itens = [item({ produto_id: 'p1', produto_nome: 'FURADEIRA', quantidade: 2, preco_unitario: 150, subtotal: 300 })]
    const r = calcularLucroVenda(300, 10, itens, indice, semKits)
    // custo: 100 * 2 = 200; lucro: 300 - 200 - 10 = 90
    assert.equal(r.custoTotal, 200)
    assert.equal(r.lucro, 90)
    assert.equal(r.temItemSemCusto, false)
  })

  test('produto sem custo cadastrado marca temItemSemCusto — nunca inventa lucro', () => {
    const itens = [item({ produto_id: 'nao-existe', produto_nome: 'sumiu', quantidade: 1, preco_unitario: 50, subtotal: 50 })]
    const r = calcularLucroVenda(50, 0, itens, indice, semKits)
    assert.equal(r.custoTotal, 0)
    assert.equal(r.temItemSemCusto, true)
    assert.equal(r.lucro, 50) // lucro aparece cheio — é o alerta que avisa que não é real
  })

  test('margem é lucro sobre o total, e zero quando o total é zero (não divide por zero)', () => {
    const r = calcularLucroVenda(0, 0, [], indice, semKits)
    assert.equal(r.margem, 0)
  })
})

describe('estoqueDoProduto — kit é o piso dos componentes', () => {
  const indice = construirIndiceProdutos([
    produto({ id: 'kit1', nome: 'KIT FURADEIRA', tipo: 'kit', estoque: 999 }),
    produto({ id: 'broca', nome: 'BROCA', estoque: 10 }),
    produto({ id: 'bateria', nome: 'BATERIA', estoque: 3 }),
    produto({ id: 'parafuso-solto', nome: 'PARAFUSO BRINDE', estoque: 0 }),
  ])
  const componentesPorKit = new Map<string, KitComponente[]>([
    ['kit1', [
      { produtoId: 'broca', quantidade: 2, controlaEstoque: true },     // 10/2 = 5
      { produtoId: 'bateria', quantidade: 1, controlaEstoque: true },   // 3/1 = 3 ← o piso
      { produtoId: 'parafuso-solto', quantidade: 1, controlaEstoque: false }, // ignorado
    ]],
  ])

  test('o estoque do kit é o menor entre os componentes que controlam estoque', () => {
    const kit = indice.porId.get('kit1')!
    assert.equal(estoqueDoProduto(kit, componentesPorKit, indice), 3)
  })

  test('componente sem controle de estoque nunca derruba a conta mesmo zerado', () => {
    const semBateria = new Map<string, KitComponente[]>([
      ['kit1', [{ produtoId: 'parafuso-solto', quantidade: 1, controlaEstoque: false }]],
    ])
    const kit = indice.porId.get('kit1')!
    assert.equal(estoqueDoProduto(kit, semBateria, indice), 0) // sem componente que controle, min fica Infinity → 0
  })

  test('produto simples usa o próprio campo de estoque, sem olhar kit_itens', () => {
    const broca = indice.porId.get('broca')!
    assert.equal(estoqueDoProduto(broca, componentesPorKit, indice), 10)
  })
})

describe('badges de cor', () => {
  test('markup negativo é vermelho, sem custo é laranja, ≥20% é verde', () => {
    assert.equal(corMarkup(markupItem(80, 100)), 'vermelho') // vendeu abaixo do custo
    assert.equal(corMarkup(markupItem(100, 0)), 'laranja')   // sem custo
    assert.equal(corMarkup(markupItem(130, 100)), 'verde')   // 30% de markup
    assert.equal(corMarkup(markupItem(110, 100)), 'laranja') // 10%, abaixo de 20%
  })

  test('margem: vermelho <0, laranja <15%, verde caso contrário', () => {
    assert.equal(corMargem(-5), 'vermelho')
    assert.equal(corMargem(10), 'laranja')
    assert.equal(corMargem(15), 'verde')
    assert.equal(corMargem(30), 'verde')
  })
})

describe('situacaoEstoque', () => {
  test('produto não achado no cadastro é "não vinculado", mesmo com número de estoque', () => {
    assert.equal(situacaoEstoque(false, 50, 10), 'nao_vinculado')
  })
  test('zerado prevalece sobre mínimo', () => {
    assert.equal(situacaoEstoque(true, 0, 0), 'zerado')
  })
  test('abaixo ou igual ao mínimo é baixo', () => {
    assert.equal(situacaoEstoque(true, 5, 5), 'baixo')
    assert.equal(situacaoEstoque(true, 3, 5), 'baixo')
  })
  test('acima do mínimo é ok', () => {
    assert.equal(situacaoEstoque(true, 20, 5), 'ok')
  })
})

describe('sugestaoDeCompra', () => {
  test('com mínimo: falta = mínimo − atual + vendido no período', () => {
    assert.equal(sugestaoDeCompra(2, 10, 5), 13) // 10 - 2 + 5
  })
  test('sem mínimo cadastrado, sugere repor a própria quantidade vendida', () => {
    assert.equal(sugestaoDeCompra(0, 0, 7), 7)
  })
  test('nunca sugere número negativo — estoque bem acima do mínimo é "OK" (zero)', () => {
    assert.equal(sugestaoDeCompra(100, 10, 1), 0)
  })
})
