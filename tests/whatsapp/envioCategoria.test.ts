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

describe('prévia do envio por categoria', () => {
  it('explica quem fica de fora, só com os motivos que aconteceram', async () => {
    const { motivosDeFora } = await import('../../src/lib/whatsapp/envioCategoria')
    const p = { na_categoria: 4, entram: 1, repetidos: 0, cadastro: 0, nao_quer: 0, sem_celular: 2, equipe: 1, nao_comprou: 0, recente: 0 }
    assert.deepEqual(motivosDeFora(p), [
      '1 é número da equipe (destinatário da Betina)',
      '2 não têm celular válido no cadastro (fixo ou sem DDD)',
    ])
    assert.deepEqual(motivosDeFora({ ...p, sem_celular: 0, equipe: 0 }), [])
  })
})
