import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { xmlDaEmissao, alvoDoEnvio } from '../../src/lib/fiscal/enviarNfeAoMarketplace'
import { pedidoAguardandoEnvioAoCanal } from '../../src/lib/automacoes/tipos-nfe-marketplace'

// A nota emitida só destrava o pedido quando chega ao marketplace. Estes
// testes prendem as decisões que não dependem da API de cada canal: o XML
// guardado, para onde ele vai, e quando a automação tenta de novo.

const XML = '<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe/></nfeProc>'
const dataUrl = (s: string, mime = 'application/xml') => `data:${mime};base64,${Buffer.from(s).toString('base64')}`

describe('XML guardado na emissão', () => {
  test('data URL base64 da Brasil NFe vira o XML em texto', () => {
    assert.equal(xmlDaEmissao({ xmlUrl: dataUrl(XML) }), XML)
  })

  test('o que não é NF-e não é enviado (PDF, HTML, vazio)', () => {
    assert.equal(xmlDaEmissao({ xmlUrl: dataUrl('%PDF-1.4 ...', 'application/pdf') }), null)
    assert.equal(xmlDaEmissao({ xmlUrl: dataUrl('<html></html>', 'text/html') }), null)
    assert.equal(xmlDaEmissao({}), null)
    assert.equal(xmlDaEmissao(null), null)
  })
})

describe('para onde a nota vai', () => {
  test('Mercado Livre: o pack; sem pack, o próprio pedido', () => {
    assert.deepEqual(alvoDoEnvio('mercadolivre', { id_externo: '2000001', pack_id: '3000009' }), { plataforma: 'mercadolivre', packId: '3000009' })
    assert.deepEqual(alvoDoEnvio('mercadolivre', { id_externo: '2000001', pack_id: null }), { plataforma: 'mercadolivre', packId: '2000001' })
  })

  test('Shopee: o order_sn', () => {
    assert.deepEqual(alvoDoEnvio('shopee', { id_externo: '251003ABCD' }), { plataforma: 'shopee', orderSn: '251003ABCD' })
  })

  test('TikTok: o pedido e o primeiro pacote', () => {
    assert.deepEqual(alvoDoEnvio('tiktok', { id_externo: '5863', pacotes: [{ id: '1153' }] }), { plataforma: 'tiktok', orderId: '5863', packageId: '1153' })
    assert.deepEqual(alvoDoEnvio('tiktok', { id_externo: '5863' }), { plataforma: 'tiktok', orderId: '5863', packageId: null })
  })

  test('canal sem envio de nota: diz, não finge', () => {
    assert.ok('erro' in alvoDoEnvio('nuvemshop', { id_externo: '1' }))
  })
})

describe('reenvio pela automação', () => {
  const agora = Date.parse('2026-10-05T15:00:00Z')
  const base = { status: 'confirmado', nfe_status: 'autorizada', nfe_informada_em: null, nfe_ambiente: 'producao', nfe_enviada_em: null }

  test('nota de produção não entregue: reenvia', () => {
    assert.equal(pedidoAguardandoEnvioAoCanal({ ...base }, agora), true)
  })

  test('tentativa há menos de 30 min espera; há mais, tenta de novo', () => {
    assert.equal(pedidoAguardandoEnvioAoCanal({ ...base, nfe_envio_tentativa_em: '2026-10-05T14:45:00Z' }, agora), false)
    assert.equal(pedidoAguardandoEnvioAoCanal({ ...base, nfe_envio_tentativa_em: '2026-10-05T14:20:00Z' }, agora), true)
  })

  test('homologação, já enviada, já informada ou pedido que andou: não reenvia', () => {
    assert.equal(pedidoAguardandoEnvioAoCanal({ ...base, nfe_ambiente: 'homologacao' }, agora), false)
    assert.equal(pedidoAguardandoEnvioAoCanal({ ...base, nfe_enviada_em: '2026-10-05T14:00:00Z' }, agora), false)
    assert.equal(pedidoAguardandoEnvioAoCanal({ ...base, nfe_informada_em: '2026-10-05T14:00:00Z' }, agora), false)
    assert.equal(pedidoAguardandoEnvioAoCanal({ ...base, status: 'enviado' }, agora), false)
  })
})
