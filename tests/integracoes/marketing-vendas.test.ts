import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agregarVendas, diaLocal, inicioDoDiaLocal } from '../../src/lib/integracoes/marketing/vendas'

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'

test('dia no fuso de São Paulo (venda às 22h30 de Brasília ainda é o mesmo dia)', () => {
  assert.equal(diaLocal('2026-10-02T01:30:00Z'), '2026-10-01')
  assert.equal(diaLocal('2026-10-02T03:00:00Z'), '2026-10-02')
  assert.equal(inicioDoDiaLocal('2026-10-02'), '2026-10-02T03:00:00.000Z')
})

test('soma por produto e dia, só produtos com a tag, valor em centavos', () => {
  const vendas = [
    { id: 'v1', created_at: '2026-10-01T13:00:00Z' },
    { id: 'v2', created_at: '2026-10-01T20:00:00Z' },
    { id: 'v3', created_at: '2026-10-02T12:00:00Z' },
  ]
  const itens = [
    { venda_id: 'v1', produto_id: A, quantidade: '2', preco_unitario: '15.90' },
    { venda_id: 'v2', produto_id: A, quantidade: 1, preco_unitario: 15.9 },
    { venda_id: 'v2', produto_id: B, quantidade: 5, preco_unitario: 3 },   // sem tag: fica de fora
    { venda_id: 'v3', produto_id: A, quantidade: 1, preco_unitario: null }, // sem preço: conta a unidade, valor 0
    { venda_id: 'v9', produto_id: A, quantidade: 1, preco_unitario: 10 },  // venda fora do recorte
    { venda_id: 'v1', produto_id: null, quantidade: 1, preco_unitario: 10 },
  ]
  assert.deepEqual(agregarVendas(vendas, itens, new Set([A])), [
    { source_product_id: A, day: '2026-10-01', quantity: 3, revenue_minor: 4770 },
    { source_product_id: A, day: '2026-10-02', quantity: 1, revenue_minor: 0 },
  ])
})
