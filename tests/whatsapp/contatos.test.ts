import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { chaveTelefone, nomeDoMetadata, nomeDoRemetente, numeroOculto, telefoneDoRemetente, textoDaMensagem } from '../../src/lib/whatsapp/contatos'
import { mesmoNumero } from '../../src/lib/getulio/numero'

// Medido em 15/10/2026: 100 números escreveram para a loja em uma semana e só
// 4 eram clientes. Quem não era cliente ficava só como linha solta no
// histórico — aqui está a regra que transforma a mensagem em contato.

describe('chave do telefone (igual à função SQL tel_chave)', () => {
  test('com e sem 55, com e sem o 9 extra, com máscara: mesma pessoa', () => {
    const chaves = ['5521991203602', '21991203602', '(21) 99120-3602', '+55 21 9120-3602', '2191203602', '021991203602'].map(chaveTelefone)
    assert.deepEqual(new Set(chaves), new Set(['2191203602']))
  })
  test('fixo com DDD também tem chave', () => {
    assert.equal(chaveTelefone('(21) 3333-4444'), '2133334444')
    assert.equal(chaveTelefone('552133334444'), '2133334444')
  })
  test('sem DDD ou número estrangeiro: sem chave (não chuta cliente)', () => {
    assert.equal(chaveTelefone('99120-3602'), null)
    assert.equal(chaveTelefone('447911123456'), null)
    assert.equal(chaveTelefone(''), null)
    assert.equal(chaveTelefone(null), null)
  })
  test('concorda com a regra do Getúlio para dono e equipe', () => {
    for (const [a, b] of [['5521988887777', '2188887777'], ['21988887777', '552188887777']]) {
      assert.equal(mesmoNumero(a, b), chaveTelefone(a) === chaveTelefone(b))
    }
  })
})

describe('o que vira contato', () => {
  test('conversa de pessoa', () => {
    assert.equal(telefoneDoRemetente({ phone: '5521991203602' }), '5521991203602')
    assert.equal(telefoneDoRemetente({ from: '5521991203602@s.whatsapp.net' }), '5521991203602')
  })
  test('grupo, canal, transmissão e mensagem da própria loja ficam de fora', () => {
    assert.equal(telefoneDoRemetente({ phone: '5521991203602', isGroup: true }), null)
    assert.equal(telefoneDoRemetente({ phone: '120363025246125486-group' }), null)
    assert.equal(telefoneDoRemetente({ phone: '5521991203602', fromMe: true }), null)
    assert.equal(telefoneDoRemetente({ phone: '5521991203602', isNewsletter: true }), null)
    assert.equal(telefoneDoRemetente({ phone: 'status@broadcast' }), null)
    assert.equal(telefoneDoRemetente({ phone: '5521991203602@g.us' }), null)
    assert.equal(telefoneDoRemetente({}), null)
  })
  test('número escondido pelo WhatsApp (@lid) também vira contato, sem telefone conhecido', () => {
    // 22 de 99 contatos em 15/10/2026 chegaram assim.
    assert.equal(telefoneDoRemetente({ phone: '123456789012345@lid' }), '123456789012345')
    assert.equal(numeroOculto('123456789012345'), true)
    assert.equal(numeroOculto('5521991203602'), false)
  })
  test('nome do WhatsApp: o do remetente, senão o da conversa, limitado', () => {
    assert.equal(nomeDoRemetente({ senderName: ' João da Obra ', chatName: 'João' }), 'João da Obra')
    assert.equal(nomeDoRemetente({ chatName: 'Maria' }), 'Maria')
    assert.equal(nomeDoRemetente({ senderName: '   ' }), null)
    assert.equal(nomeDoRemetente({ senderName: 'x'.repeat(200) })!.length, 80)
  })
  test('texto do histórico: mensagem, foto com legenda ou mídia', () => {
    assert.equal(textoDaMensagem({ text: { message: 'tem cimento?' } }), 'tem cimento?')
    assert.equal(textoDaMensagem({ image: { imageUrl: 'https://x/y.jpg', caption: 'esse aqui' } }), '[foto] esse aqui')
    assert.equal(textoDaMensagem({ image: { imageUrl: 'https://x/y.jpg' } }), '[foto]')
    assert.equal(textoDaMensagem({}), '[mídia]')
  })
})

describe('nome pela consulta de contato da Z-API', () => {
  // 15/10/2026: os contatos da carga do histórico chegaram sem nome — o
  // histórico nunca guardou. O "~Leilane" que aparece no celular é o `notify`.
  test('o nome que a pessoa colocou no WhatsApp vem primeiro', () => {
    assert.equal(nomeDoMetadata({ notify: 'Leilane', name: null, short: null }), 'Leilane')
    assert.equal(nomeDoMetadata({ notify: '~Leilane' }), 'Leilane')
    assert.equal(nomeDoMetadata({ notify: null, name: 'Leilane Souza', short: 'Leilane' }), 'Leilane Souza')
  })
  test('número no lugar do nome, vazio ou resposta estranha: sem nome', () => {
    assert.equal(nomeDoMetadata({ notify: '+55 21 99247-9657' }), null)
    assert.equal(nomeDoMetadata({ notify: '   ' }), null)
    assert.equal(nomeDoMetadata({}), null)
    assert.equal(nomeDoMetadata(null), null)
    assert.equal(nomeDoMetadata({ notify: 123 }), null)
  })
})

