import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { destinatarioDoNumero, mesmoNumero } from '../../src/lib/getulio/numero'
import { chaveConfere, chaveWebhookZapi } from '../../src/lib/getulio/webhook'

describe('quem pode conversar com o Getúlio', () => {
  test('o mesmo número com e sem 55 e com e sem o 9 extra', () => {
    assert.equal(mesmoNumero('5588999887766', '88999887766'), true)
    assert.equal(mesmoNumero('5588999887766', '558899887766'), true)
    assert.equal(mesmoNumero('(88) 99988-7766', '5588999887766'), true)
  })
  test('DDD diferente ou número curto não casa', () => {
    assert.equal(mesmoNumero('5585999887766', '5588999887766'), false)
    assert.equal(mesmoNumero('99887766', '5588999887766'), false)
    assert.equal(mesmoNumero('', ''), false)
  })
  test('acha o destinatário cadastrado', () => {
    const d = destinatarioDoNumero([{ nome: 'Silvano', numero: '5588999887766' }], '558899887766')
    assert.equal(d?.nome, 'Silvano')
    assert.equal(destinatarioDoNumero([{ nome: 'Silvano', numero: '5588999887766' }], '5511912345678'), null)
  })
})

describe('chave do webhook', () => {
  test('confere a chave da própria instância e recusa as outras', () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    const k = chaveWebhookZapi('INST1')
    assert.equal(chaveConfere('INST1', k), true)
    assert.equal(chaveConfere('INST2', k), false)
    assert.equal(chaveConfere('INST1', null), false)
    assert.equal(chaveConfere('INST1', k.slice(0, -1) + (k.endsWith('a') ? 'b' : 'a')), false)
  })
})
