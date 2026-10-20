import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { acoesDoVendedor, avisoDeContato, horasAte, prazoDaReclamacao, tempoDesde } from '../../src/lib/mercadolivre/atendimentoRegras'

describe('reclamação do Mercado Livre', () => {
  // Formato real (20/10/2026): o vendedor é o "respondent"; cada ação tem prazo.
  const players = [
    { role: 'complainant', available_actions: [{ action: 'send_message_to_respondent', due_date: '2026-10-19T10:00:00.000-04:00' }] },
    { role: 'respondent', available_actions: [
      { action: 'send_message_to_complainant', due_date: '2026-10-20T22:48:00.000-04:00' },
      { action: 'refund', due_date: '2026-10-22T22:48:00.000-04:00' },
      { action: 'open_dispute' },
    ] },
  ]
  test('prazo é o mais próximo das ações do VENDEDOR', () => {
    assert.equal(prazoDaReclamacao(players), '2026-10-20T22:48:00.000-04:00')
  })
  test('ações do vendedor', () => {
    assert.deepEqual(acoesDoVendedor(players), ['send_message_to_complainant', 'refund', 'open_dispute'])
  })
  test('sem ação do vendedor: sem prazo', () => {
    assert.equal(prazoDaReclamacao([{ role: 'respondent', available_actions: [] }]), null)
    assert.equal(prazoDaReclamacao(null), null)
  })
})

describe('tempo', () => {
  const agora = new Date('2026-10-20T12:00:00Z')
  test('tempo desde', () => {
    assert.equal(tempoDesde('2026-10-20T09:00:00Z', agora), '3 h')
    assert.equal(tempoDesde('2026-10-15T12:00:00Z', agora), '5 d')
    assert.equal(tempoDesde('2026-10-20T11:50:00Z', agora), '10 min')
  })
  test('horas até o prazo; negativo é vencido', () => {
    assert.equal(horasAte('2026-10-20T18:00:00Z', agora), 6)
    assert.ok(horasAte('2026-10-20T10:00:00Z', agora) < 0)
  })
})

describe('dado de contato (proibido pelo ML)', () => {
  test('pega telefone, e-mail, link e WhatsApp', () => {
    assert.ok(avisoDeContato('me chama no (21) 98217-1121'))
    assert.ok(avisoDeContato('manda pra loja@exemplo.com'))
    assert.ok(avisoDeContato('veja em www.loja.com.br'))
    assert.ok(avisoDeContato('fala comigo no WhatsApp'))
  })
  test('resposta normal passa', () => {
    assert.equal(avisoDeContato('Olá! Sim, o disjuntor é de 32A, bivolt. Obrigado pela pergunta!'), null)
    assert.equal(avisoDeContato('Olá! Temos sim, 10 metros. Agradecemos o contato.'), null)
  })
})
