import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { gtinParaMarketplace, propostaGtin, situacaoGtin, SEM_GTIN } from '../../src/lib/shopee/gtinRegras'

describe('GTIN para a Shopee', () => {
  test('EAN-13 de verdade passa; dígito errado não', () => {
    assert.equal(gtinParaMarketplace('7891234567895'), '7891234567895')
    assert.equal(gtinParaMarketplace('7891234567890'), null)
  })
  test('EAN interno da loja (prefixo 2) não vai para o marketplace', () => {
    // 2 + 11 dígitos + verificador: o que lib/produtos/ean.ts gera.
    assert.equal(gtinParaMarketplace('2000000000008'), null)
  })
  test('tamanhos aceitos e lixo', () => {
    assert.equal(gtinParaMarketplace('96385074'), '96385074') // EAN-8 válido
    assert.equal(gtinParaMarketplace('0000000000000'), null)
    assert.equal(gtinParaMarketplace('123'), null)
    assert.equal(gtinParaMarketplace(null), null)
  })
  test('situação na Shopee: "00" é sem GTIN, vazio falta', () => {
    assert.equal(situacaoGtin('00'), 'sem_gtin')
    assert.equal(situacaoGtin(''), 'falta')
    assert.equal(situacaoGtin(undefined), 'falta')
    assert.equal(situacaoGtin('7891234567895'), 'tem')
    assert.equal(situacaoGtin('123456'), 'invalido')
  })
  test('proposta: EAN do produto, "sem GTIN", ou resolver antes', () => {
    assert.deepEqual(propostaGtin({ produto: { ean: '7891234567895' }, temVariacao: false }).proposta, { gtin: '7891234567895', origem: 'ean_do_produto' })
    assert.deepEqual(propostaGtin({ produto: { ean: '2000000000008' }, temVariacao: false }).proposta, { gtin: SEM_GTIN, origem: 'sem_gtin' })
    assert.deepEqual(propostaGtin({ produto: { ean: null }, temVariacao: false }).proposta, { gtin: SEM_GTIN, origem: 'sem_gtin' })
    assert.equal(propostaGtin({ produto: null, temVariacao: false }).proposta, null)
    assert.equal(propostaGtin({ produto: { ean: '7891234567895' }, temVariacao: true }).proposta, null)
  })
})

describe('anúncio com variação', () => {
  const m = (ean: string | null) => ({ produto: { ean } })
  test('todas as variações com EAN: vai o EAN de cada uma', () => {
    const p = propostaGtin({ produto: null, temVariacao: true, modelos: [m('7891234567895'), m('96385074')] })
    assert.equal(p.proposta?.origem, 'ean_do_produto')
  })
  test('alguma sem EAN: vai "sem GTIN" nela', () => {
    assert.equal(propostaGtin({ produto: null, temVariacao: true, modelos: [m('7891234567895'), m(null)] }).proposta?.origem, 'sem_gtin')
  })
  test('variação sem produto mapeado: resolver antes', () => {
    const p = propostaGtin({ produto: null, temVariacao: true, modelos: [m('7891234567895'), { produto: null }] })
    assert.equal(p.proposta, null)
    assert.match(p.pendencia ?? '', /1 variação/)
  })
})

describe('GTIN digitado no modal de edição', () => {
  test('aceita "00", EAN válido e o código interno (com aviso na tela)', async () => {
    const { gtinAceitoNaEdicao, ehCodigoInterno } = await import('../../src/lib/shopee/gtinRegras')
    assert.equal(gtinAceitoNaEdicao('00'), true)
    assert.equal(gtinAceitoNaEdicao('7891234567895'), true)
    assert.equal(gtinAceitoNaEdicao('2000000000008'), true)
    assert.equal(ehCodigoInterno('2000000000008'), true)
    assert.equal(ehCodigoInterno('7891234567895'), false)
  })
  test('recusa dígito errado e tamanho errado', async () => {
    const { gtinAceitoNaEdicao } = await import('../../src/lib/shopee/gtinRegras')
    assert.equal(gtinAceitoNaEdicao('7891234567890'), false)
    assert.equal(gtinAceitoNaEdicao('12345'), false)
    assert.equal(gtinAceitoNaEdicao('0000000000000'), false)
  })
})
