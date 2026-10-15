import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { doCliente, rotuloSaida, tempoDeEspera } from '../../src/lib/whatsapp/conversas'

describe('caixa de entrada do WhatsApp', () => {
  test('só a recebida é do cliente; o resto a loja mandou', () => {
    assert.equal(doCliente('recebida'), true)
    for (const t of ['atendimento', 'enviada_celular', 'orcamento', 'cupom', 'automacao_alerta_pedido']) assert.equal(doCliente(t), false)
  })
  test('rótulo do que a loja mandou; conversa comum sem rótulo', () => {
    assert.equal(rotuloSaida('atendimento'), null)
    assert.equal(rotuloSaida('recebida'), null)
    assert.equal(rotuloSaida('orcamento'), 'Orçamento')
    assert.equal(rotuloSaida('enviada_celular'), 'Pelo celular')
    assert.equal(rotuloSaida('automacao_qualquer_coisa'), 'Automação')
    assert.equal(rotuloSaida('tipo_novo'), 'tipo_novo')
  })
  test('tempo de espera legível', () => {
    const agora = new Date('2026-10-15T12:00:00Z')
    assert.equal(tempoDeEspera('2026-10-15T11:59:40Z', agora), 'agora')
    assert.equal(tempoDeEspera('2026-10-15T11:48:00Z', agora), '12 min')
    assert.equal(tempoDeEspera('2026-10-15T09:00:00Z', agora), '3 h')
    assert.equal(tempoDeEspera('2026-10-14T11:00:00Z', agora), '1 dia')
    assert.equal(tempoDeEspera('2026-10-12T11:00:00Z', agora), '3 dias')
    assert.equal(tempoDeEspera('2026-10-15T12:05:00Z', agora), 'agora')
  })
})
