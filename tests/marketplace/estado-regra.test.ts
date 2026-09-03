import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { estadoDaRegra } from '../../src/lib/marketplace/estadoRegra'

// Quatro interruptores EM SÉRIE decidem se um anúncio recebe preço e estoque.
// Medido em 03/09/2026: dos 9.281 anúncios das seis contas, ZERO tinham regra
// vinculada. Ligar o envio real não enviaria nada, e a tela não explicava.

const CANAL_OK = { atualizar_estoque_canal: true, fila_simulacao: false }
const EMPRESA_SIMULANDO = { simulacaoDaEmpresa: true }
const EMPRESA_ENVIANDO = { simulacaoDaEmpresa: false }
const PRONTO = { regra_id: 'r1', produto_id: 'p1', status: 'ativo' }

describe('tudo ligado: envia', () => {
  test('os quatro verdadeiros', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: CANAL_OK, config: EMPRESA_SIMULANDO, nomeRegra: '20%',
    })
    assert.equal(e.estado, 'enviando')
    assert.equal(e.regra, '20%')
  })
})

describe('a ordem das faltas é a ordem de quem conserta', () => {
  // Sem produto não adianta discutir regra; sem regra não adianta ligar o
  // canal. Mostrar a falta mais rasa primeiro faria o operador ligar o canal
  // e continuar sem entender por que nada acontece.
  test('sem produto vem antes de tudo', () => {
    const e = estadoDaRegra({
      anuncio: { regra_id: null, produto_id: null },
      canal: { atualizar_estoque_canal: false }, config: EMPRESA_SIMULANDO,
    })
    assert.equal(e.estado, 'parado')
    assert.match(e.estado === 'parado' ? e.falta : '', /sem produto/)
  })

  test('com produto e sem regra, a falta é a regra', () => {
    const e = estadoDaRegra({
      anuncio: { regra_id: null, produto_id: 'p1' },
      canal: { atualizar_estoque_canal: false }, config: EMPRESA_SIMULANDO,
    })
    assert.match(e.estado === 'parado' ? e.falta : '', /sem regra/)
  })

  test('com regra e canal desligado, a falta é o canal', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { atualizar_estoque_canal: false },
      config: EMPRESA_ENVIANDO, nomeRegra: '20%',
    })
    assert.match(e.estado === 'parado' ? e.falta : '', /atualizar estoque.*desligado/)
  })

  test('anúncio encerrado não recebe nada', () => {
    // Mandar quantidade para item fechado pode recolocá-lo à venda.
    const e = estadoDaRegra({
      anuncio: { ...PRONTO, status: 'encerrado' }, canal: CANAL_OK,
      config: EMPRESA_ENVIANDO, nomeRegra: '20%',
    })
    assert.match(e.estado === 'parado' ? e.falta : '', /encerrado/)
  })
})

describe('simulação: pronto, mas não envia', () => {
  test('canal em simulação diz que é o canal', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { atualizar_estoque_canal: true, fila_simulacao: true },
      config: EMPRESA_ENVIANDO, nomeRegra: '20%',
    })
    assert.equal(e.estado, 'simulando')
    assert.match(e.estado === 'simulando' ? e.porque : '', /este canal/)
  })

  test('herdando da empresa, diz que é a empresa', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { atualizar_estoque_canal: true, fila_simulacao: null },
      config: EMPRESA_SIMULANDO, nomeRegra: '20%',
    })
    assert.equal(e.estado, 'simulando')
    assert.match(e.estado === 'simulando' ? e.porque : '', /a empresa/)
  })

  test('canal com false vence a empresa simulando', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { atualizar_estoque_canal: true, fila_simulacao: false },
      config: EMPRESA_SIMULANDO, nomeRegra: '20%',
    })
    assert.equal(e.estado, 'enviando')
  })
})

describe('o caso real de 03/09/2026', () => {
  test('anúncio com produto, sem regra: parado, e o motivo é a regra', () => {
    // 192 anúncios da Shp Ouro tinham produto e nenhum tinha regra.
    const e = estadoDaRegra({
      anuncio: { produto_id: 'p1', regra_id: null, status: 'ativo' },
      canal: CANAL_OK, config: EMPRESA_ENVIANDO,
    })
    assert.equal(e.estado, 'parado')
    assert.equal(e.regra, null)
    assert.match(e.estado === 'parado' ? e.falta : '', /sem regra/)
  })
})
