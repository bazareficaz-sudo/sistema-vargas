import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidirPausa, podeReligarAutomaticamente, pausadoManualmente,
  camposPausaAutomatica, camposPausaManual, camposReativacao,
} from '../../src/lib/marketplace/pausa'

// A regra pedida em 03/09/2026, em três partes:
//   1. estoque zerou → o sistema pausa;
//   2. pessoa pausou → PAUSA MANUAL, só pessoa reativa;
//   3. estoque voltou → religa o que a falta de estoque desligou, e NÃO
//      religa o que a pessoa desligou.

describe('1 — estoque acabou: o sistema pausa', () => {
  test('anúncio ativo com estoque no limite é pausado, com motivo', () => {
    const d = decidirPausa({
      anuncio: { status: 'ativo' }, paraPausar: true, estoqueEnviado: 0, risco: 0,
    })
    assert.equal(d.acao, 'pausar')
    assert.match(d.acao === 'pausar' ? d.motivo : '', /Estoque 0 chegou ao limite de risco \(0\)/)
  })

  test('com complemento, o motivo mostra o número que foi enviado', () => {
    // Complemento 1000 e risco 1000: envia 1000 quando o saldo real zera.
    const d = decidirPausa({
      anuncio: { status: 'ativo' }, paraPausar: true, estoqueEnviado: 1000, risco: 1000,
    })
    assert.match(d.acao === 'pausar' ? d.motivo : '', /Estoque 1000 chegou ao limite de risco \(1000\)/)
  })

  test('já pausado não é pausado de novo', () => {
    const d = decidirPausa({ anuncio: { status: 'pausado', pausa_origem: 'automatica' }, paraPausar: true })
    assert.equal(d.acao, 'nada')
  })
})

describe('2 — pausa manual: só pessoa reativa', () => {
  test('pausa manual NÃO é religada quando o estoque volta', () => {
    const d = decidirPausa({ anuncio: { status: 'pausado', pausa_origem: 'manual' }, paraPausar: false })
    assert.equal(d.acao, 'nada')
    assert.match(d.acao === 'nada' ? d.porque : '', /pausa manual/)
  })

  test('pausadoManualmente reconhece o manual e o desconhecido', () => {
    assert.equal(pausadoManualmente({ status: 'pausado', pausa_origem: 'manual' }), true)
    assert.equal(pausadoManualmente({ status: 'pausado', pausa_origem: null }), true)
    assert.equal(pausadoManualmente({ status: 'pausado', pausa_origem: 'automatica' }), false)
    assert.equal(pausadoManualmente({ status: 'ativo' }), false)
  })
})

describe('3 — estoque voltou: religa só o que o sistema desligou', () => {
  test('pausa automática é reativada', () => {
    const d = decidirPausa({ anuncio: { status: 'pausado', pausa_origem: 'automatica' }, paraPausar: false })
    assert.equal(d.acao, 'reativar')
  })

  test('anúncio já ativo não é mexido', () => {
    const d = decidirPausa({ anuncio: { status: 'ativo' }, paraPausar: false })
    assert.equal(d.acao, 'nada')
  })
})

describe('origem desconhecida é tratada como manual', () => {
  // Os anúncios pausados ANTES desta coluna existir não dizem por quê.
  // Religar no escuro reativaria, na primeira reposição, algo que alguém
  // tirou do ar meses atrás — foto errada, preço errado, produto com defeito.
  // O prejuízo de religar o que não devia é maior que o de manter pausado o
  // que já estava pausado.
  test('pausa_origem nula NÃO religa sozinha', () => {
    const d = decidirPausa({ anuncio: { status: 'pausado', pausa_origem: null }, paraPausar: false })
    assert.equal(d.acao, 'nada')
    assert.match(d.acao === 'nada' ? d.porque : '', /desconhecida.*tratado como manual/i)
  })

  test('podeReligarAutomaticamente exige a marca explícita', () => {
    assert.equal(podeReligarAutomaticamente({ status: 'pausado', pausa_origem: 'automatica' }), true)
    assert.equal(podeReligarAutomaticamente({ status: 'pausado', pausa_origem: null }), false)
    assert.equal(podeReligarAutomaticamente({ status: 'pausado', pausa_origem: undefined }), false)
    assert.equal(podeReligarAutomaticamente({ status: 'pausado', pausa_origem: 'manual' }), false)
  })
})

describe('os campos gravados', () => {
  test('pausa automática marca a origem e guarda o motivo', () => {
    const c = camposPausaAutomatica('Estoque 0 chegou ao limite de risco (0).')
    assert.equal(c.status, 'pausado')
    assert.equal(c.pausa_origem, 'automatica')
    assert.equal(c.pausa_por, null)
    assert.ok(c.pausa_motivo)
  })

  test('pausa manual registra QUEM pausou', () => {
    const c = camposPausaManual('user-1')
    assert.equal(c.pausa_origem, 'manual')
    assert.equal(c.pausa_por, 'user-1')
    assert.equal(c.pausa_motivo, null, 'motivo é da pausa automática; manual quem sabe é a pessoa')
  })

  test('reativar LIMPA a origem — senão a próxima leitura acha que ainda está pausado', () => {
    const c = camposReativacao()
    assert.equal(c.status, 'ativo')
    assert.equal(c.pausa_origem, null)
    assert.equal(c.pausa_em, null)
    assert.equal(c.pausa_por, null)
    assert.equal(c.pausa_motivo, null)
  })
})
