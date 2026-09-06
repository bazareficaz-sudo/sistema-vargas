import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  promocaoValeNasFormas, avisoDaRestricao, listar, CONFIG_PADRAO,
} from '../../src/lib/pdv/promocaoPagamento'
import { precoVigente, precoPorQuantidade } from '../../src/lib/produtos/promocao'

// "Este preço é só no Pix" no balcão. A regra decide se o preço promocional
// vale para as formas escolhidas — nunca qual preço cobrar, que continua em
// produtos/promocao.ts.

const SO_PIX_E_DINHEIRO = { exigirFormaPagamento: true, formasPermitidas: ['pix', 'dinheiro'] }

describe('promoção condicionada à forma de pagamento', () => {
  test('empresa sem a regra ligada: nada muda', () => {
    const v = promocaoValeNasFormas(CONFIG_PADRAO, ['credito'])
    assert.equal(v.vale, true)
    assert.equal(v.restricaoAtiva, false)
    assert.equal(v.motivo, null)
  })

  test('config ausente não inventa restrição', () => {
    assert.equal(promocaoValeNasFormas(null, ['credito']).vale, true)
    assert.equal(promocaoValeNasFormas(undefined, ['credito']).vale, true)
  })

  test('forma autorizada: vale, e a restrição continua sinalizada', () => {
    const v = promocaoValeNasFormas(SO_PIX_E_DINHEIRO, ['pix'])
    assert.equal(v.vale, true)
    // Sinalizada mesmo cumprida: o vendedor precisa saber que existe condição,
    // senão não sabe explicar por que o preço muda se o cliente trocar de ideia.
    assert.equal(v.restricaoAtiva, true)
  })

  test('forma não autorizada: não vale, e o motivo nomeia as duas coisas', () => {
    const v = promocaoValeNasFormas(SO_PIX_E_DINHEIRO, ['credito'])
    assert.equal(v.vale, false)
    assert.match(v.motivo ?? '', /PIX ou Dinheiro/)
    assert.match(v.motivo ?? '', /Crédito/)
  })

  test('NADA ESCOLHIDO AINDA: vale — é o preço da etiqueta', () => {
    // Enquanto os itens entram, o cliente vê o preço anunciado. A perda do
    // desconto acontece e é comunicada quando a forma é escolhida, não antes.
    const v = promocaoValeNasFormas(SO_PIX_E_DINHEIRO, [])
    assert.equal(v.vale, true)
    assert.equal(v.restricaoAtiva, true)
  })

  test('PAGAMENTO DIVIDIDO: uma forma não autorizada derruba a promoção', () => {
    // Metade em Pix e metade em crédito não cumpre "só no Pix". Ratear o
    // desconto seria uma conta que ninguém confere no balcão.
    const v = promocaoValeNasFormas(SO_PIX_E_DINHEIRO, ['pix', 'credito'])
    assert.equal(v.vale, false)
    assert.match(v.motivo ?? '', /Crédito não dá direito/)
    // O Pix escolhido não é acusado: ele estava certo.
    assert.doesNotMatch(v.motivo ?? '', /PIX não dá/)
  })

  test('pagamento dividido só com formas autorizadas vale', () => {
    assert.equal(promocaoValeNasFormas(SO_PIX_E_DINHEIRO, ['pix', 'dinheiro']).vale, true)
  })

  test('duas formas não autorizadas: o plural sai certo', () => {
    const v = promocaoValeNasFormas(SO_PIX_E_DINHEIRO, ['credito', 'debito'])
    assert.match(v.motivo ?? '', /Crédito e Débito não dão direito/)
  })

  test('LISTA VAZIA com o interruptor ligado não mata a promoção em silêncio', () => {
    // Configuração pela metade não pode tirar desconto que o cliente já viu.
    const v = promocaoValeNasFormas({ exigirFormaPagamento: true, formasPermitidas: [] }, ['credito'])
    assert.equal(v.vale, true)
    assert.equal(v.restricaoAtiva, false)
  })

  test('fiado e carteira são formas como as outras', () => {
    assert.equal(promocaoValeNasFormas(SO_PIX_E_DINHEIRO, ['fiado']).vale, false)
    const soFiado = { exigirFormaPagamento: true, formasPermitidas: ['fiado'] }
    assert.equal(promocaoValeNasFormas(soFiado, ['fiado']).vale, true)
  })
})

describe('a frase que o vendedor lê', () => {
  test('lista com duas formas usa "ou"', () => {
    assert.equal(listar(['pix', 'dinheiro']), 'PIX ou Dinheiro')
  })

  test('lista com três formas usa vírgula e "ou"', () => {
    assert.equal(listar(['pix', 'dinheiro', 'debito']), 'PIX, Dinheiro ou Débito')
  })

  test('aviso permanente só existe quando há restrição de verdade', () => {
    assert.equal(avisoDaRestricao(CONFIG_PADRAO), null)
    assert.equal(avisoDaRestricao({ exigirFormaPagamento: true, formasPermitidas: [] }), null)
    assert.match(avisoDaRestricao(SO_PIX_E_DINHEIRO) ?? '', /só em PIX ou Dinheiro/)
  })
})

describe('o preço que sai da decisão', () => {
  const TIJOLO = {
    preco_venda: 1.69,
    preco_promocional: 1.60,
    promocao_ativa: true,
    promocao_inicio: null,
    promocao_fim: null,
  }

  test('promoção autorizada cobra o preço promocional', () => {
    assert.equal(precoVigente(TIJOLO, new Date(), true), 1.60)
  })

  test('promoção NÃO autorizada cobra o preço normal, sem mexer na vigência', () => {
    // A campanha não acabou; ela só não se aplica a esta venda.
    assert.equal(precoVigente(TIJOLO, new Date(), false), 1.69)
  })

  test('faixa de atacado continua valendo sem a promoção', () => {
    // A faixa é política de venda, não campanha: quem leva 60 paga o preço de
    // 60 mesmo pagando no crédito. O que muda é a base contra a qual compete.
    const comFaixa = { ...TIJOLO, precos_quantidade: [{ qtd: 50, preco: 1.55 }] }
    assert.equal(precoPorQuantidade(comFaixa, 60, new Date(), false), 1.55)
    assert.equal(precoPorQuantidade(comFaixa, 60, new Date(), true), 1.55)
  })

  test('sem faixa, 60 unidades no crédito pagam o preço cheio', () => {
    assert.equal(precoPorQuantidade(TIJOLO, 60, new Date(), false), 1.69)
    assert.equal(precoPorQuantidade(TIJOLO, 60, new Date(), true), 1.60)
  })

  test('o padrão continua sendo promoção autorizada', () => {
    // Todo chamador que existia antes não passa o parâmetro e não pode mudar.
    assert.equal(precoVigente(TIJOLO), 1.60)
    assert.equal(precoPorQuantidade(TIJOLO, 1), 1.60)
  })
})
