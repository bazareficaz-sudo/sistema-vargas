import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { telefoneParaWhatsapp } from '../../src/lib/whatsapp/contatos'

describe('nova conversa: número', () => {
  test('aceita com máscara, com 0 e com 55', () => {
    assert.equal(telefoneParaWhatsapp('(21) 97305-6130'), '5521973056130')
    assert.equal(telefoneParaWhatsapp('021 97305-6130'), '5521973056130')
    assert.equal(telefoneParaWhatsapp('+55 21 97305-6130'), '5521973056130')
    assert.equal(telefoneParaWhatsapp('21 3333-4444'), '552133334444')
  })
  test('recusa o que não tem DDD ou não é do Brasil', () => {
    assert.equal(telefoneParaWhatsapp('97305-6130'), null)
    assert.equal(telefoneParaWhatsapp('123'), null)
    assert.equal(telefoneParaWhatsapp('+1 415 555 0100'), null)
    assert.equal(telefoneParaWhatsapp(''), null)
    assert.equal(telefoneParaWhatsapp(null), null)
  })
})
