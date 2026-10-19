import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { destinoDaJuncao, fotoDaMensagem, lidDaMensagem, nomeDoRemetente } from '../../src/lib/whatsapp/contatos'

// 18/10/2026: "Fatima Brandao" (21) 98217-1121 e "76746787442896@lid" eram a
// mesma pessoa em duas conversas. O código vem em `chatLid` junto do número.
describe('código oculto (@lid) do WhatsApp', () => {
  test('número e código na mesma mensagem: o código sai do chatLid', () => {
    assert.equal(lidDaMensagem({ phone: '5521982171121', chatLid: '76746787442896@lid' }), '76746787442896')
  })
  test('só o código: vem no phone', () => {
    assert.equal(lidDaMensagem({ phone: '76746787442896@lid' }), '76746787442896')
  })
  test('na mensagem da loja, senderLid é o da loja e não conta', () => {
    assert.equal(lidDaMensagem({ fromMe: true, phone: '5521982171121', senderLid: '11111111111111@lid' }), null)
    assert.equal(lidDaMensagem({ fromMe: true, phone: '5521982171121', chatLid: '76746787442896@lid' }), '76746787442896')
  })
  test('sem código: nulo', () => {
    assert.equal(lidDaMensagem({ phone: '5521982171121' }), null)
  })
  test('código no lugar do nome não é nome', () => {
    assert.equal(nomeDoRemetente({ senderName: '76746787442896@lid', chatName: 'Fatima Brandao' }), 'Fatima Brandao')
    assert.equal(nomeDoRemetente({ senderName: '+55 21 98217-1121' }), null)
  })
})

describe('foto do perfil', () => {
  test('foto da conversa; senderPhoto só na mensagem do cliente', () => {
    assert.equal(fotoDaMensagem({ photo: 'https://pps.whatsapp.net/a.jpg' }), 'https://pps.whatsapp.net/a.jpg')
    assert.equal(fotoDaMensagem({ senderPhoto: 'https://pps.whatsapp.net/b.jpg' }), 'https://pps.whatsapp.net/b.jpg')
    assert.equal(fotoDaMensagem({ fromMe: true, senderPhoto: 'https://pps.whatsapp.net/loja.jpg' }), null)
    assert.equal(fotoDaMensagem({ photo: 'http://inseguro/x.jpg' }), null)
  })
})

describe('juntar conversas', () => {
  const comNumero = { id: 'n', telefone: '5521982171121' }
  const soCodigo = { id: 'l', telefone: '76746787442896' }
  test('a só do código vai para a com número, em qualquer ordem', () => {
    assert.deepEqual(destinoDaJuncao(soCodigo, comNumero), { de: 'l', para: 'n' })
    assert.deepEqual(destinoDaJuncao(comNumero, soCodigo), { de: 'l', para: 'n' })
  })
  test('duas com número não se juntam', () => {
    assert.equal(destinoDaJuncao(comNumero, { id: 'm', telefone: '5521990425264' }), null)
  })
})
