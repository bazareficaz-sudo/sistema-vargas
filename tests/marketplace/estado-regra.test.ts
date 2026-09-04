import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { estadoDaRegra } from '../../src/lib/marketplace/estadoRegra'

// SETE interruptores EM SÉRIE decidem se um anúncio recebe preço e estoque.
// Medido em 03/09/2026: dos 9.281 anúncios das seis contas, ZERO tinham regra
// vinculada. Ligar o envio real não enviaria nada, e a tela não explicava.
//
// Eram quatro até 04/09/2026, quando um anúncio marcado "enviando" ficou 12
// horas com o estoque inicial na Shopee. `fila.ts` exigia três coisas que
// esta função não olhava — e o fixture abaixo era prova disso: um canal sem
// `plataforma` e sem `sincronizar_estoque` que `canalAceitaEnvio` recusa e
// este teste chamava de "tudo ligado".

const CANAL_OK = {
  plataforma: 'shopee', sincronizar_estoque: true,
  atualizar_estoque_canal: true, fila_simulacao: false,
}
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
      canal: { ...CANAL_OK, atualizar_estoque_canal: false }, config: EMPRESA_SIMULANDO,
    })
    assert.equal(e.estado, 'parado')
    assert.match(e.estado === 'parado' ? e.falta : '', /sem produto/)
  })

  test('com produto e sem regra, a falta é a regra', () => {
    const e = estadoDaRegra({
      anuncio: { regra_id: null, produto_id: 'p1' },
      canal: { ...CANAL_OK, atualizar_estoque_canal: false }, config: EMPRESA_SIMULANDO,
    })
    assert.match(e.estado === 'parado' ? e.falta : '', /sem regra/)
  })

  test('com regra e canal desligado, a falta é o canal', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { ...CANAL_OK, atualizar_estoque_canal: false },
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
      anuncio: PRONTO, canal: { ...CANAL_OK, fila_simulacao: true },
      config: EMPRESA_ENVIANDO, nomeRegra: '20%',
    })
    assert.equal(e.estado, 'simulando')
    assert.match(e.estado === 'simulando' ? e.porque : '', /este canal/)
  })

  test('herdando da empresa, diz que é a empresa', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { ...CANAL_OK, fila_simulacao: null },
      config: EMPRESA_SIMULANDO, nomeRegra: '20%',
    })
    assert.equal(e.estado, 'simulando')
    assert.match(e.estado === 'simulando' ? e.porque : '', /a empresa/)
  })

  test('canal com false vence a empresa simulando', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { ...CANAL_OK, fila_simulacao: false },
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


describe('os três interruptores que faltavam — e que a fila sempre exigiu', () => {
  test('canal com "sincronizar estoque" desligado: a fila recusa, a tela precisa dizer', () => {
    // `canalAceitaEnvio` exige os DOIS interruptores. A tela olhava só um, e
    // a fila registrava `canal_desligado` — que não conta como falha, some da
    // fila e não repete na rodada seguinte.
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { ...CANAL_OK, sincronizar_estoque: false },
      config: EMPRESA_ENVIANDO,
    })
    assert.equal(e.estado, 'parado')
    assert.match(e.estado === 'parado' ? e.falta : '', /sincronizar estoque/)
  })

  test('NULO não é ligado: a tela testava `=== false` e deixava nulo passar', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { ...CANAL_OK, atualizar_estoque_canal: null },
      config: EMPRESA_ENVIANDO,
    })
    assert.equal(e.estado, 'parado')
    assert.match(e.estado === 'parado' ? e.falta : '', /atualizar estoque do canal/)
  })

  test('anúncio com variação: a fila pula antes de calcular', () => {
    const e = estadoDaRegra({
      anuncio: { ...PRONTO, tem_variacao: true }, canal: CANAL_OK,
      config: EMPRESA_ENVIANDO,
    })
    assert.equal(e.estado, 'parado')
    assert.match(e.estado === 'parado' ? e.falta : '', /variação/)
  })

  test('fila da empresa desligada: nenhuma rodada acontece', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: CANAL_OK, config: EMPRESA_ENVIANDO, filaAtiva: false,
    })
    assert.equal(e.estado, 'parado')
    assert.match(e.estado === 'parado' ? e.falta : '', /fila de atualização desligada/)
  })

  test('quem não sabe se a fila está ligada não afirma que está', () => {
    // `filaAtiva` ausente não pode virar "ligada" por omissão — seria a mesma
    // classe de erro que este commit conserta.
    const semSaber = estadoDaRegra({ anuncio: PRONTO, canal: CANAL_OK, config: EMPRESA_ENVIANDO })
    const sabendo = estadoDaRegra({ anuncio: PRONTO, canal: CANAL_OK, config: EMPRESA_ENVIANDO, filaAtiva: true })
    assert.equal(semSaber.estado, 'enviando')
    assert.equal(sabendo.estado, 'enviando')
  })

  test('Loja Online não recebe envio, por mais ligada que esteja', () => {
    const e = estadoDaRegra({
      anuncio: PRONTO, canal: { ...CANAL_OK, plataforma: 'loja' },
      config: EMPRESA_ENVIANDO,
    })
    assert.equal(e.estado, 'parado')
  })
})
