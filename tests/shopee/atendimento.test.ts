import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DEVOLUCAO_ABERTA, lerDevolucao, ordenarAvaliacoes, semResposta } from '../../src/lib/shopee/atendimentoRegras'

describe('devolução da Shopee', () => {
  // Formato real de get_return_list (20/10/2026), com valores inventados.
  const bruta = {
    return_sn: 'R1', order_sn: '2610ABC', status: 'PROCESSING', reason: 'ITEM_DAMAGED', text_reason: ' Chegou quebrado ',
    refund_amount: 45.9, image: ['https://cf.shopee.com.br/a.jpg', 'http://inseguro/b.jpg'],
    item: [{ name: 'Disjuntor 32A', amount: 2, images: ['https://cf.shopee.com.br/i.jpg'] }],
    create_time: 1760900000, return_seller_due_date: 1761100000, due_date: 1761300000,
    negotiation_status: 'PENDING_RESPOND', tracking_number: '',
  }
  test('lê motivo, prazo da loja, fotos e itens', () => {
    const d = lerDevolucao(bruta, { id: 'c', nome: 'Shp Eficaz' })
    assert.equal(d.motivo, 'produto danificado')
    assert.equal(d.textoComprador, 'Chegou quebrado')
    assert.equal(d.prazoLoja, new Date(1761100000 * 1000).toISOString())
    assert.deepEqual(d.fotos, ['https://cf.shopee.com.br/a.jpg'])
    assert.deepEqual(d.itens, [{ nome: 'Disjuntor 32A', quantidade: 2, foto: 'https://cf.shopee.com.br/i.jpg' }])
    assert.equal(d.negociacao, 'esperando a loja responder')
    assert.equal(d.rastreio, null)
  })
  test('sem prazo da loja, usa o prazo geral', () => {
    assert.equal(lerDevolucao({ ...bruta, return_seller_due_date: 0 }, { id: 'c', nome: 'x' }).prazoLoja, new Date(1761300000 * 1000).toISOString())
  })
  test('motivo desconhecido aparece legível', () => {
    assert.equal(lerDevolucao({ ...bruta, reason: 'SOME_NEW_REASON' }, { id: 'c', nome: 'x' }).motivo, 'some new reason')
  })
  test('devolução já aceita não tem prazo da loja', () => {
    assert.equal(lerDevolucao({ ...bruta, status: 'ACCEPTED' }, { id: 'c', nome: 'x' }).prazoLoja, null)
  })
  test('motivos vistos sem tradução', () => {
    assert.equal(lerDevolucao({ ...bruta, reason: 'ITEM_NOT_FIT' }, { id: 'c', nome: 'x' }).motivo, 'não serviu')
    assert.equal(lerDevolucao({ ...bruta, reason: 'SPILLED_CONTENTS' }, { id: 'c', nome: 'x' }).motivo, 'conteúdo vazou')
  })
  test('encerrada e cancelada não estão abertas', () => {
    assert.ok(DEVOLUCAO_ABERTA.has('PROCESSING'))
    assert.ok(!DEVOLUCAO_ABERTA.has('CLOSED') && !DEVOLUCAO_ABERTA.has('CANCELLED'))
  })
})

describe('avaliações da Shopee', () => {
  test('sem resposta = sem comment_reply com texto', () => {
    assert.equal(semResposta({}), true)
    assert.equal(semResposta({ comment_reply: { reply: '  ' } }), true)
    assert.equal(semResposta({ comment_reply: { reply: 'Obrigado!' } }), false)
  })
  test('pior nota primeiro; na mesma nota, a mais recente', () => {
    const r = ordenarAvaliacoes([
      { nota: 5, criadaEm: '2026-10-19' }, { nota: 1, criadaEm: '2026-10-01' }, { nota: 3, criadaEm: '2026-10-10' }, { nota: 1, criadaEm: '2026-10-15' },
    ])
    assert.deepEqual(r.map(x => `${x.nota}@${x.criadaEm}`), ['1@2026-10-15', '1@2026-10-01', '3@2026-10-10', '5@2026-10-19'])
  })
})
