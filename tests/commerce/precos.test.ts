import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRECO_UNICO, descontoPercentual, exibicaoPreco, melhorParcelamento,
  rotuloAVista, textoAVista, textoParcelamento,
} from '../../src/lib/commerce/precos'
import type { PoliticaPreco } from '../../src/lib/commerce/tipos'

// Política de preços da vitrine.
//
// O que estes testes prendem, em uma frase: a loja está NO AR, e a política
// nasce desligada. O caso `preco_unico` aqui não é completude — é a garantia
// de que ligar a migração não muda um pixel para quem já está vendo a loja.
//
// `Intl.NumberFormat` separa "R$" do número com espaço NÃO-SEPARÁVEL (U+00A0).
// Comparar com espaço comum falha por um caractere invisível, que é o tipo de
// teste que se apaga por parecer errado quando o código está certo.
const semNbsp = (s: string) => s.replace(/ /g, ' ')

const pol = (p: Partial<PoliticaPreco>): PoliticaPreco =>
  ({ ...PRECO_UNICO, exibicao: 'dois_precos', ...p })

/** Dez vezes sem juros, piso de R$ 5,00 — a configuração mais provável. */
const DEZ = pol({ parcelasMax: 10, parcelasSemJuros: 10, parcelaMinima: 5 })

describe('melhorParcelamento', () => {
  test('divide igual quando o preço permite', () => {
    assert.deepEqual(melhorParcelamento(100, DEZ),
      { vezes: 10, valorParcela: 10, total: 100, semJuros: true })
  })

  test('o piso da parcela derruba 10x para 2x', () => {
    // R$ 12,00 com piso de R$ 5,00: floor(12/5) = 2. Sem esta trava a
    // vitrine anunciaria "10x de R$ 1,20".
    assert.deepEqual(melhorParcelamento(12, DEZ),
      { vezes: 2, valorParcela: 6, total: 12, semJuros: true })
  })

  test('abaixo do piso não há parcelamento nenhum', () => {
    assert.equal(melhorParcelamento(4.9, DEZ), null)
  })

  test('exatamente no piso ainda oferece 2x', () => {
    assert.deepEqual(melhorParcelamento(10, DEZ),
      { vezes: 2, valorParcela: 5, total: 10, semJuros: true })
  })

  test('sem juros configurados, o teto cai para o limite sem juros', () => {
    // 12 vezes no teto, 6 sem juros, taxa zero: oferecer 12x aqui anunciaria
    // 12x SEM JUROS sem ninguém ter decidido isso.
    assert.deepEqual(
      melhorParcelamento(100, pol({ parcelasMax: 12, parcelasSemJuros: 6, parcelaMinima: 5 })),
      { vezes: 6, valorParcela: 16.67, total: 100, semJuros: true })
  })

  test('com taxa, as parcelas acima do limite saem pela tabela Price', () => {
    assert.deepEqual(
      melhorParcelamento(100, pol({ parcelasMax: 12, parcelasSemJuros: 6, jurosMes: 2, parcelaMinima: 5 })),
      { vezes: 12, valorParcela: 9.46, total: 113.52, semJuros: false })
  })

  test('sem teto configurado, a vitrine não fala de parcelamento', () => {
    assert.equal(melhorParcelamento(100, pol({ parcelasMax: null })), null)
  })

  test('preço zero não parcela', () => {
    assert.equal(melhorParcelamento(0, DEZ), null)
  })

  test('a frase é a mesma do orçamento', () => {
    assert.equal(semNbsp(textoParcelamento(melhorParcelamento(100, DEZ)!)),
      'em até 10x de R$ 10,00 sem juros')
  })
})

describe('exibicaoPreco', () => {
  const COM_PIX = pol({ parcelasMax: 10, parcelasSemJuros: 10, parcelaMinima: 5, pixDescontoPct: 11 })

  test('sem promoção, o destaque é o preço normal', () => {
    const e = exibicaoPreco({ preco: 100, precoDe: null, precoPix: 89 }, COM_PIX)
    assert.equal(e.destaque, 100)
    assert.equal(e.aVistaEmDestaque, false)
    assert.equal(e.aVista, 89)
    assert.equal(e.normal, null)
    assert.equal(e.parcelamento?.vezes, 10)
  })

  test('com promoção vigente, o à vista sobe para o destaque', () => {
    const e = exibicaoPreco({ preco: 100, precoDe: 120, precoPix: 89 }, COM_PIX)
    assert.equal(e.destaque, 89)
    assert.equal(e.aVistaEmDestaque, true)
    assert.equal(e.de, 120)
    assert.equal(e.normal, 100)
    assert.equal(e.descontoPct, 17)
  })

  test('promoção sem preço à vista NÃO inverte', () => {
    // Destacar o preço normal duas vezes não é destaque, é repetição.
    const e = exibicaoPreco({ preco: 100, precoDe: 120, precoPix: null }, COM_PIX)
    assert.equal(e.destaque, 100)
    assert.equal(e.aVistaEmDestaque, false)
  })

  test('preco_unico entrega exatamente a Fase 1', () => {
    // O teste que protege a loja no ar: com a política desligada não há
    // parcelamento, não há inversão, e o à vista continua na terceira linha.
    const e = exibicaoPreco({ preco: 100, precoDe: 120, precoPix: 89 }, PRECO_UNICO)
    assert.equal(e.destaque, 100)
    assert.equal(e.aVistaEmDestaque, false)
    assert.equal(e.aVista, 89)
    assert.equal(e.parcelamento, null)
  })

  test('à vista maior que o preço é ignorado', () => {
    assert.equal(exibicaoPreco({ preco: 100, precoDe: null, precoPix: 130 }, COM_PIX).aVista, null)
  })

  test('riscado menor que o preço é ignorado', () => {
    // Riscado abaixo do praticado é o golpe de vitrine mais comum.
    assert.equal(exibicaoPreco({ preco: 100, precoDe: 80, precoPix: null }, COM_PIX).de, null)
  })
})

describe('descontoPercentual', () => {
  test('o selo e o bloco de preço contam a mesma história', () => {
    assert.equal(descontoPercentual(100, 120), 17)
    assert.equal(exibicaoPreco({ preco: 100, precoDe: 120, precoPix: null }, PRECO_UNICO).descontoPct, 17)
  })

  test('sem riscado, zero', () => {
    assert.equal(descontoPercentual(100, null), 0)
    assert.equal(descontoPercentual(100, 80), 0)
    assert.equal(descontoPercentual(100, 0), 0)
  })
})

describe('rótulos do à vista', () => {
  test('a linha secundária mantém o texto da Fase 1', () => {
    assert.equal(rotuloAVista(PRECO_UNICO), 'no Pix')
  })

  test('no destaque o rótulo diz que é à vista', () => {
    assert.equal(textoAVista(PRECO_UNICO), 'à vista no Pix')
  })

  test('rótulo apagado no painel cai em "à vista"', () => {
    assert.equal(rotuloAVista(pol({ pixRotulo: '  ' })), 'à vista')
  })
})
