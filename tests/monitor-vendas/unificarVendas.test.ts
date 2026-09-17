import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  vendaPdvParaVendaUnificada, pedidoMarketplaceParaVendaUnificada, agruparItensPorPedido,
} from '../../src/lib/monitor-vendas/unificarVendas'

describe('vendaPdvParaVendaUnificada', () => {
  test('canal PDV/APP vira Venda normalmente', () => {
    const r = vendaPdvParaVendaUnificada({
      id: 'v1', cliente_nome: 'Fulano', vendedor_nome: 'Eliane', status: 'concluida',
      total: 100, desconto_total: 0, canal: 'PDV', terminal_id: 'PDV-001',
      created_at: '2026-09-01T10:00:00Z', itens: [],
    })
    assert.equal(r?.canal, 'PDV')
    assert.equal(r?.canalNome, 'PDV')
  })

  test('canal de marketplace herdado em vendas é DESCARTADO — vira null', () => {
    // Esse é exatamente o caso real: uma linha de `vendas` com canal
    // 'mercadolivre' porque o pedido ganhou vínculo fiscal. Contar aqui E em
    // marketplace_pedidos somaria a mesma venda duas vezes.
    const r = vendaPdvParaVendaUnificada({
      id: 'v2', cliente_nome: null, vendedor_nome: null, status: 'concluida',
      total: 50, desconto_total: 0, canal: 'mercadolivre', terminal_id: null,
      created_at: '2026-09-01T10:00:00Z', itens: [],
    })
    assert.equal(r, null)
  })

  test('canal nulo é tratado como PDV', () => {
    const r = vendaPdvParaVendaUnificada({
      id: 'v3', cliente_nome: null, vendedor_nome: null, status: 'concluida',
      total: 10, desconto_total: 0, canal: null, terminal_id: null,
      created_at: '2026-09-01T10:00:00Z', itens: [],
    })
    assert.equal(r?.canal, 'PDV')
  })

  test('itens que não são array (nulo/corrompido) viram lista vazia, nunca derrubam a leitura', () => {
    const r = vendaPdvParaVendaUnificada({
      id: 'v4', cliente_nome: null, vendedor_nome: null, status: 'concluida',
      total: 10, desconto_total: 0, canal: 'PDV', terminal_id: null,
      created_at: '2026-09-01T10:00:00Z', itens: null,
    })
    assert.deepEqual(r?.itens, [])
  })
})

describe('pedidoMarketplaceParaVendaUnificada', () => {
  const nomePorCanal = new Map([['canal-1', 'Shopee Ouro'], ['canal-2', 'ML Eficaz']])

  test('usa o nome do canal, não a plataforma genérica', () => {
    const r = pedidoMarketplaceParaVendaUnificada(
      { id: 'p1', canal_id: 'canal-1', cliente_nome: 'Ciclano', valor_total: 200, valor_desconto: 10,
        status: 'confirmado', data_pedido: '2026-09-01T12:00:00Z', created_at: '2026-09-01T11:00:00Z' },
      [], nomePorCanal,
    )
    assert.equal(r.canal, 'Marketplace') // grupo do filtro
    assert.equal(r.canalNome, 'Shopee Ouro') // rótulo específico da coluna
  })

  test('canal sem cadastro em marketplace_canais cai num rótulo genérico, não quebra', () => {
    const r = pedidoMarketplaceParaVendaUnificada(
      { id: 'p2', canal_id: 'canal-desconhecido', cliente_nome: null, valor_total: 50, valor_desconto: 0,
        status: 'novo', data_pedido: null, created_at: '2026-09-01T11:00:00Z' },
      [], nomePorCanal,
    )
    assert.equal(r.canalNome, 'Marketplace')
  })

  test('usa data_pedido quando existe, e cai para created_at quando não', () => {
    const comData = pedidoMarketplaceParaVendaUnificada(
      { id: 'p3', canal_id: null, cliente_nome: null, valor_total: 0, valor_desconto: 0,
        status: 'novo', data_pedido: '2026-09-05T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      [], nomePorCanal,
    )
    assert.equal(comData.created_at, '2026-09-05T00:00:00Z')

    const semData = pedidoMarketplaceParaVendaUnificada(
      { id: 'p4', canal_id: null, cliente_nome: null, valor_total: 0, valor_desconto: 0,
        status: 'novo', data_pedido: null, created_at: '2026-09-01T00:00:00Z' },
      [], nomePorCanal,
    )
    assert.equal(semData.created_at, '2026-09-01T00:00:00Z')
  })

  test('traduz os itens do formato marketplace pro formato comum', () => {
    const r = pedidoMarketplaceParaVendaUnificada(
      { id: 'p5', canal_id: 'canal-2', cliente_nome: null, valor_total: 90, valor_desconto: 0,
        status: 'entregue', data_pedido: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      [{ pedido_id: 'p5', produto_id: 'prod-1', nome_produto: 'FURADEIRA', sku: '123', quantidade: 2, preco_unitario: 45, subtotal: 90 }],
      nomePorCanal,
    )
    assert.deepEqual(r.itens, [{
      produto_id: 'prod-1', produto_nome: 'FURADEIRA', produto_sku: '123',
      quantidade: 2, preco_unitario: 45, subtotal: 90,
    }])
  })
})

describe('agruparItensPorPedido', () => {
  test('agrupa pela chave pedido_id, preservando a ordem de chegada', () => {
    const mapa = agruparItensPorPedido([
      { pedido_id: 'a', x: 1 }, { pedido_id: 'b', x: 2 }, { pedido_id: 'a', x: 3 },
    ])
    assert.deepEqual(mapa.get('a'), [{ pedido_id: 'a', x: 1 }, { pedido_id: 'a', x: 3 }])
    assert.deepEqual(mapa.get('b'), [{ pedido_id: 'b', x: 2 }])
  })

  test('pedido sem item nenhum simplesmente não aparece no mapa', () => {
    const mapa = agruparItensPorPedido<{ pedido_id: string }>([])
    assert.equal(mapa.get('qualquer'), undefined)
  })
})
