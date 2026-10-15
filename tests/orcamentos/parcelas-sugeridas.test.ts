import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parcelasSugeridas } from '../../src/lib/orcamentos/condicoes'

// PARCELAMENTO DO ORCAMENTO — a regra é a PARCELA, nao o numero de vezes.
//
// Medido em producao: dos 72 orcamentos dos ultimos 12 meses, 8 tinham
// parcelamento preenchido e 69 seguiam "aberto". O campo nascia em branco e
// dependia de o vendedor lembrar de digitar com o cliente na frente.
//
// A regra pedida pelo lojista: parcela minima de R$ 50.

const cfg = { parcelaMinima: 50, teto: 6 }

describe('a conta base', () => {
  test('os tres casos que o lojista deu', () => {
    assert.equal(parcelasSugeridas(80, cfg), 1)    // nao alcanca a minima
    assert.equal(parcelasSugeridas(100, cfg), 2)
    assert.equal(parcelasSugeridas(150, cfg), 3)
  })

  test('a parcela nunca fica abaixo da minima', () => {
    // É a propriedade inteira da regra. Qualquer total, qualquer teto.
    for (const total of [50, 99, 149, 150, 151, 275, 999, 1000]) {
      const n = parcelasSugeridas(total, cfg)
      if (n > 1) {
        assert.ok(total / n >= 50,
          `R$ ${total} em ${n}x daria parcela de ${(total / n).toFixed(2)}`)
      }
    }
  })

  test('o teto da configuracao segura o ticket alto', () => {
    // Sem teto, R$ 1.000 viraria 20x e R$ 5.000 viraria 100x.
    assert.equal(parcelasSugeridas(1000, cfg), 6)
    assert.equal(parcelasSugeridas(5000, cfg), 6)
  })

  test('exatamente na minima ainda parcela', () => {
    assert.equal(parcelasSugeridas(100, cfg), 2)
    assert.equal(parcelasSugeridas(99.99, cfg), 1)
  })
})

describe('o teto da FAIXA manda sobre o da configuracao', () => {
  // Parcelar custa dinheiro: credito é `vista + (n-1) × parcelado`, entao 3x
  // sai por 8% da venda com as taxas reais. Margem apertada nao sustenta.
  test('faixa "Boa" limita a 3x mesmo com teto 6', () => {
    assert.equal(parcelasSugeridas(1000, { ...cfg, tetoFaixa: 3 }), 3)
  })

  test('faixa "Atencao" derruba para a vista', () => {
    assert.equal(parcelasSugeridas(1000, { ...cfg, tetoFaixa: 1 }), 1)
  })

  test('faixa generosa NAO levanta o teto da empresa', () => {
    // Vence o MENOR dos dois. A faixa pode apertar, nunca afrouxar.
    assert.equal(parcelasSugeridas(1000, { ...cfg, tetoFaixa: 12 }), 6)
  })

  test('sem faixa informada, vale so a configuracao', () => {
    assert.equal(parcelasSugeridas(1000, { ...cfg, tetoFaixa: null }), 6)
    assert.equal(parcelasSugeridas(1000, { ...cfg, tetoFaixa: undefined }), 6)
  })

  test('e a parcela minima continua valendo com faixa junto', () => {
    // Faixa permite 6, mas R$ 80 so da uma parcela acima de R$ 50.
    assert.equal(parcelasSugeridas(80, { ...cfg, tetoFaixa: 6 }), 1)
  })
})

describe('entradas que nao fazem proposta nenhuma', () => {
  test('total zero, negativo ou invalido devolve 1', () => {
    for (const t of [0, -100, NaN]) {
      assert.equal(parcelasSugeridas(t, cfg), 1, `falhou para ${t}`)
    }
  })

  test('minima zero nao divide por zero', () => {
    // `floor(total/0)` seria Infinity e o teto viraria o unico limite —
    // silenciosamente trocando a regra por outra.
    assert.equal(parcelasSugeridas(1000, { parcelaMinima: 0, teto: 6 }), 1)
  })

  test('teto 1 desliga o parcelamento', () => {
    // É a forma configurada de nao oferecer parcela. Sem numero magico.
    assert.equal(parcelasSugeridas(1000, { parcelaMinima: 50, teto: 1 }), 1)
  })

  test('nunca devolve menos que 1', () => {
    assert.equal(parcelasSugeridas(1000, { parcelaMinima: 50, teto: 0 }), 1)
    assert.equal(parcelasSugeridas(1000, { parcelaMinima: 50, teto: -5 }), 1)
  })

  test('centavos nao viram parcela a mais', () => {
    // 149,99 / 50 = 2,9998 — arredondar para cima daria 3x de R$ 50,00 menos
    // um centavo, e a promessa do papel deixaria de ser verdade.
    assert.equal(parcelasSugeridas(149.99, cfg), 2)
  })
})
