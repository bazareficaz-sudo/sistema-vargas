import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPagamentos, mensagemDePagamento, type RecebimentoAviso } from '../../src/lib/alertas/pagamentoCliente'
import { FORMAS_PAGAMENTO, rotuloDaForma } from '../../src/lib/pdv/formasPagamento'

const r = (p: Partial<RecebimentoAviso>): RecebimentoAviso => ({
  id: Math.random().toString(36).slice(2), empresa_id: 'e', cliente_id: 'c1', valor: 10, forma_pagamento: 'pix',
  created_at: '2026-10-20T15:00:10Z', lote_id: null, avisar_cliente: null, ...p,
})

describe('aviso de pagamento', () => {
  test('várias contas pagas juntas viram uma mensagem só', () => {
    const g = agruparPagamentos([
      r({ valor: 10 }), r({ valor: 20.5, created_at: '2026-10-20T15:00:40Z' }),
      r({ valor: 5, lote_id: 'L1', avisar_cliente: true }), r({ valor: 7, lote_id: 'L1', avisar_cliente: true }),
    ], () => true)
    assert.equal(g.length, 2)
    assert.deepEqual(g.map(x => x.valor).sort((a, b) => a - b), [12, 30.5])
  })
  test('quem avisa: a baixa marcou, ou não disse nada e o cadastro pede', () => {
    const recs = [r({ cliente_id: 'a', avisar_cliente: true }), r({ cliente_id: 'b' }), r({ cliente_id: 'c', avisar_cliente: false }), r({ cliente_id: 'd' })]
    const g = agruparPagamentos(recs, id => id === 'b' || id === 'c')
    assert.deepEqual(g.map(x => x.clienteId).sort(), ['a', 'b'])
  })
  test('mensagem com saldo e com carteira quitada', () => {
    const m1 = mensagemDePagamento({ nome: 'Maria Souza', loja: 'Bazar Eficaz', valor: 50, forma: 'pix', em: '2026-10-20T15:00:00Z', saldo: 120.4 })
    assert.match(m1, /Olá, Maria!/)
    assert.match(m1, /R\$\s50,00\* em PIX \(20\/10, 12:00\)/)
    assert.match(m1, /Saldo em aberto na sua carteira: \*R\$\s120,40\*/)
    const m2 = mensagemDePagamento({ nome: 'João', loja: '', valor: 10, forma: null, em: '2026-10-20T15:00:00Z', saldo: 0 })
    assert.match(m2, /quitada/)
  })
})

describe('forma Fiado', () => {
  test('não aparece mais no PDV, mas venda antiga continua com o nome', () => {
    assert.ok(!FORMAS_PAGAMENTO.some(f => f.id === 'fiado'))
    assert.ok(FORMAS_PAGAMENTO.some(f => f.id === 'carteira'))
    assert.equal(rotuloDaForma('fiado'), 'Fiado')
  })
})
