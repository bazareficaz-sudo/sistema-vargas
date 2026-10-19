import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RODAPE_SAIR, avisoDaSituacao, esperaAutomatica, montarMensagem, pedeParaSair } from '../../src/lib/whatsapp/envioCategoria'

describe('envio por categoria', () => {
  it('monta a mensagem com o primeiro nome, a loja e o rodapé de saída', () => {
    assert.equal(montarMensagem('Olá, {nome}! Chegou disjuntor na {loja}.', 'JOÃO da silva', 'Vargas'), `Olá, João! Chegou disjuntor na Vargas.\n\n${RODAPE_SAIR}`)
    assert.equal(montarMensagem('Oi{, nome}!', null, 'Vargas'), `Oi!\n\n${RODAPE_SAIR}`)
  })
  it('SAIR só quando a mensagem inteira pede', () => {
    for (const t of ['SAIR', 'sair.', ' Parar ', 'Stop!', 'não quero receber', 'NÃO QUERO MAIS']) assert.ok(pedeParaSair(t), t)
    for (const t of ['vou sair agora, passo aí', 'pode parar de mandar o orçamento?', '', 'ok']) assert.ok(!pedeParaSair(t), t)
  })
  it('espera do automático entre 60 e 120 s', () => {
    assert.equal(esperaAutomatica(0), 60); assert.equal(esperaAutomatica(1), 120); assert.equal(esperaAutomatica(5), 120)
  })
  it('avisos do ritmo', () => {
    assert.match(avisoDaSituacao('aguarde', 12), /12 s/)
    assert.match(avisoDaSituacao('limite'), /30/)
    assert.equal(avisoDaSituacao('ok'), '')
  })
})
