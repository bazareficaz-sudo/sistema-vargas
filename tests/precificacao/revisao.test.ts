import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { revisarDecisao, ordenarFila, PESO_VEREDITO } from '../../src/lib/precificacao/revisao'
import type { Cenario } from '../../src/lib/precificacao/cenarios'

// O caso real: 17 anúncios do Mercado Livre com preço aplicado abaixo de R$ 79
// entre 31/07 e 30/08, margem registrada média de 11,66% sobre preço médio de
// R$ 32,08 — calculada com frete SUPOSTO zero. O frete medido naquela faixa é
// R$ 6,85 a R$ 10,23.
//
// Num preço de R$ 32, R$ 8 de frete são 25 pontos percentuais. O que foi
// decidido como lucro é prejuízo, e está no ar desde julho.

/** Cenário de mentira, com só o que a revisão lê. */
function cenario(margemLiquida: number, lucro: number, valido = true): Cenario {
  return {
    rotulo: 'teste',
    resultado: { margemLiquida, lucro } as Cenario['resultado'],
    saude: 'saudavel' as Cenario['saude'],
    lucroSobreCusto: 0,
    valido,
  }
}

function revisar(over: Partial<Parameters<typeof revisarDecisao>[0]> = {}) {
  return revisarDecisao({
    margemRegistrada: 11.66,
    precoAplicado: 32.08,
    comPremissasDeHoje: cenario(-13.3, -4.27),
    comCustoDeHoje: cenario(-13.3, -4.27),
    origemFrete: 'api_ml',
    piso: 10,
    plataformaTemFreteMedido: true,
    ...over,
  })
}

describe('revisão — os 17 anúncios do ML abaixo de R$ 79', () => {
  test('o que foi aplicado como lucro de 11,66% é prejuízo com o frete medido', () => {
    const r = revisar()
    assert.equal(r.veredito, 'prejuizo')
    assert.match(r.fundamento, /prejuízo de R\$ 4,27|prejuízo de R\$ 4\.27/)
    // A frase precisa dizer o que se acreditava, senão ninguém entende como
    // um preço "de 11,66% de margem" virou prejuízo.
    assert.match(r.fundamento, /11\.7%|11,7%/)
  })

  test('a distorção da premissa é isolada do que o mundo mudou', () => {
    const r = revisar({
      comPremissasDeHoje: cenario(-13.3, -4.27),  // custo de ENTAO, premissas de HOJE
      comCustoDeHoje: cenario(-20.0, -6.40),      // custo de HOJE tambem subiu
    })
    // O engano foi de 24,96 pontos — e so isso. Os outros 6,7 pontos vieram do
    // custo ter subido depois, que e outra conversa e pede outra acao.
    assert.equal(r.distorcaoDaPremissa, 24.96)
    assert.equal(r.margemAtual, -20.0)
  })
})

describe('revisão — não revisar suposição contra suposição', () => {
  test('frete que continua vindo da config NÃO vira revisão confirmada', () => {
    // Este e o coracao do modulo. Com origemFrete de configuracao, o "novo"
    // calculo usa a MESMA suposicao do antigo: daria "nada mudou", uma
    // confirmacao falsa — pior que nao revisar.
    const r = revisar({ origemFrete: 'api_ml_sem_medidas', comPremissasDeHoje: cenario(11.66, 3.74) })
    assert.equal(r.veredito, 'nao_verificavel')
    assert.match(r.impedimento!, /peso e dimens/)
  })

  test('mas numa plataforma sem medição disponível, a config é o que há', () => {
    // Shopee nao tem sonda de frete como o ML. Recusar a revisao ali deixaria
    // 30 anuncios sem nenhuma leitura; o certo e revisar E DIZER que o frete e
    // declarado, nao medido.
    const r = revisar({
      plataformaTemFreteMedido: false,
      origemFrete: 'config',
      comPremissasDeHoje: cenario(13.84, 4.20),
      piso: 10,
    })
    assert.equal(r.veredito, 'confirmada')
    assert.match(r.fundamento, /não há medição disponível/)
  })
})

describe('revisão — os quatro vereditos', () => {
  test('abaixo do piso: rende, mas fora da política', () => {
    const r = revisar({ comPremissasDeHoje: cenario(4.0, 1.28), piso: 10 })
    assert.equal(r.veredito, 'abaixo_do_piso')
    assert.match(r.fundamento, /piso de 10/)
  })

  test('sem piso declarado, nao ha como dizer "abaixo do piso"', () => {
    // Nenhuma das 3 regras tem piso hoje. Sem ele o sistema nao inventa um.
    const r = revisar({ comPremissasDeHoje: cenario(4.0, 1.28), piso: null })
    assert.equal(r.veredito, 'envelhecida')
  })

  test('envelhecida: se sustenta, mas rende menos do que se acreditava', () => {
    const r = revisar({ margemRegistrada: 20, comPremissasDeHoje: cenario(14, 4.5), piso: 10 })
    assert.equal(r.veredito, 'envelhecida')
    assert.equal(r.distorcaoDaPremissa, 6)
  })

  test('confirmada: diferenca de ate 1 ponto e ruido, nao noticia', () => {
    // Arredondamento e mudanca de faixa de comissao produzem decimos. Acordar
    // o operador por isso faria a fila perder credibilidade.
    const r = revisar({ margemRegistrada: 20, comPremissasDeHoje: cenario(19.4, 6.2), piso: 10 })
    assert.equal(r.veredito, 'confirmada')
  })

  test('motor que nao fecha a conta vira nao_verificavel, nunca confirmada', () => {
    const r = revisar({ comPremissasDeHoje: cenario(0, 0, false) })
    assert.equal(r.veredito, 'nao_verificavel')
    assert.match(r.impedimento!, /sem custo|Sem custo/)
  })
})

describe('revisão — a ordem da fila', () => {
  test('prejuizo primeiro, e dentro dele quem perde mais por unidade', () => {
    const fila = ordenarFila([
      { nome: 'confirmado', revisao: revisar({ margemRegistrada: 20, comPremissasDeHoje: cenario(19.5, 6) }) },
      { nome: 'prejuizo pequeno', revisao: revisar({ comPremissasDeHoje: cenario(-2, -0.50) }) },
      { nome: 'sem evidencia', revisao: revisar({ origemFrete: 'config' }) },
      { nome: 'prejuizo grande', revisao: revisar({ comPremissasDeHoje: cenario(-30, -9.80) }) },
      { nome: 'envelhecida', revisao: revisar({ margemRegistrada: 20, comPremissasDeHoje: cenario(12, 4) }) },
    ])
    assert.deepEqual(fila.map(f => f.nome), [
      'prejuizo grande', 'prejuizo pequeno', 'envelhecida', 'confirmado', 'sem evidencia',
    ])
  })

  test('nao_verificavel vai para o FIM, e isso e proposital', () => {
    // Eles precisam de cadastro antes de precisarem de decisao. Misturados com
    // os confirmados, esconderiam que ha trabalho pendente ali.
    assert.ok(PESO_VEREDITO.nao_verificavel > PESO_VEREDITO.confirmada)
  })
})
