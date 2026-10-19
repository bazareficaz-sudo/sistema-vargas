import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { caminhoDaFoto, fotoDoCliente, linkDoWhatsapp } from '../../src/lib/clientes/foto'

const E = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222'

describe('foto do cliente', () => {
  it('caminho na pasta da empresa e do cliente, só jpg/png/webp', () => {
    assert.equal(caminhoDaFoto(E, C, 'image/jpeg', 'x'), `${E}/${C}/x.jpg`)
    assert.equal(caminhoDaFoto(E, C, 'image/png; charset=binary', 'x'), `${E}/${C}/x.png`)
    assert.equal(caminhoDaFoto(E, C, 'image/gif', 'x'), null)
    assert.equal(caminhoDaFoto(E, C, 'text/html', 'x'), null)
  })
  it('foto de outro cliente não vale', () => {
    assert.ok(fotoDoCliente(`${E}/${C}/a.jpg`, E, C))
    assert.ok(!fotoDoCliente(`${E}/outro/a.jpg`, E, C))
    assert.ok(!fotoDoCliente(null, E, C))
  })
  it('só baixa link do WhatsApp/Z-API em https', () => {
    assert.ok(linkDoWhatsapp('https://pps.whatsapp.net/v/t61/abc.jpg?oe=1'))
    assert.ok(linkDoWhatsapp('https://storage.z-api.io/foto.jpg'))
    assert.ok(!linkDoWhatsapp('http://pps.whatsapp.net/a.jpg'))
    assert.ok(!linkDoWhatsapp('https://pps.whatsapp.net.malicioso.com/a.jpg'))
    assert.ok(!linkDoWhatsapp('https://169.254.169.254/latest'))
    assert.ok(!linkDoWhatsapp('nada'))
  })
})
