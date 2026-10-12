import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarAvisoChegada, primeiroNome, telefoneAvisavel, MENSAGEM_PADRAO_AVISO } from '../../src/lib/faltas/avisoChegada'

test('preenche nome, produto e loja', () => {
  assert.equal(
    montarAvisoChegada(null, { nome: 'JOÃO DA SILVA', produto: 'TRENA 5M', loja: 'Bazar Eficaz' }),
    'Olá, João! O produto TRENA 5M que você procurou na Bazar Eficaz já chegou. Estamos te esperando! 😊',
  )
})

test('sem nome não deixa "Olá, !"', () => {
  assert.equal(montarAvisoChegada(MENSAGEM_PADRAO_AVISO, { nome: '', produto: 'X', loja: 'L' }).startsWith('Olá! O produto X'), true)
  assert.equal(montarAvisoChegada('Oi {nome}, chegou {produto}', { produto: 'Y', loja: 'L' }), 'Oi, chegou Y')
})

test('primeiro nome e telefone', () => {
  assert.equal(primeiroNome('  maria  clara '), 'Maria')
  assert.equal(telefoneAvisavel('(21) 99120-3602'), '21991203602')
  assert.equal(telefoneAvisavel('+55 21 3333-4444'), '2133334444')
  assert.equal(telefoneAvisavel('99120-3602'), null)
})
