import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { precisaEnviar } from '../../src/lib/marketplace/precisaEnviar'

// O CASO REAL DE 04/09/2026, que este módulo existe para não repetir.
//
// Anúncio 58267446668 (Pistola Finca Pino), Shp Ouro, regra "Est +1000".
// Produto com 25 em estoque, regra soma 1000 → 1025 a enviar. A Shopee
// continuava com 30 e nenhuma rodada tentava de novo: o espelho local dizia
// 1025, batia com o que a regra mandaria, e a fila concluía "já igual".
//
// O espelho tinha sido escrito depois de um envio que a Shopee recusou DENTRO
// de uma resposta aceita (`error: ""` no envelope, `failure_list` no corpo) —
// recusa que `pushPrecoEstoque` descartava. A leitura de catálogo, essa sim
// medida, guardou 30 em `estoque_reservado` e ficou contradizendo o espelho
// sem que nada olhasse para os dois juntos.

describe('precisaEnviar — espelho contra medida', () => {
  test('número diferente do espelho: envia, como sempre enviou', () => {
    const d = precisaEnviar({
      estoqueExterno: 30, estoqueMedido: 30, estoqueNovo: 1025,
      precoEspelho: 59.9, precoNovo: null,
    })
    assert.equal(d.enviar, true)
    assert.equal(d.espelhoDivergente, false)
  })

  test('espelho e medida concordam com o que enviaria: não envia', () => {
    const d = precisaEnviar({
      estoqueExterno: 1025, estoqueMedido: 1025, estoqueNovo: 1025,
      precoEspelho: 59.9, precoNovo: null,
    })
    assert.equal(d.enviar, false)
    assert.match(d.motivo, /já está com o mesmo número/)
  })

  test('O CASO TRAVADO: espelho diz 1025, a Shopee devolveu 30 — reenvia', () => {
    const d = precisaEnviar({
      estoqueExterno: 1025, estoqueMedido: 30, estoqueNovo: 1025,
      precoEspelho: 59.9, precoNovo: null,
    })
    assert.equal(d.enviar, true)
    assert.equal(d.espelhoDivergente, true)
    assert.match(d.motivo, /espelho dizia 1025/)
    assert.match(d.motivo, /leitura da plataforma trouxe 30/)
  })

  test('sem leitura da plataforma não se inventa contradição', () => {
    // Anúncio nunca sincronizado: ausência de informação não é discordância,
    // e tratar como tal faria a fila reenviar tudo para sempre.
    const d = precisaEnviar({
      estoqueExterno: 1025, estoqueMedido: null, estoqueNovo: 1025,
      precoEspelho: 59.9, precoNovo: null,
    })
    assert.equal(d.enviar, false)
    assert.equal(d.espelhoDivergente, false)
  })

  test('preço diferente basta, mesmo com estoque igual', () => {
    const d = precisaEnviar({
      estoqueExterno: 1025, estoqueMedido: 1025, estoqueNovo: 1025,
      precoEspelho: 59.9, precoNovo: 54.9,
    })
    assert.equal(d.enviar, true)
  })

  test('regra que não mexe em estoque nem em preço não gera envio', () => {
    const d = precisaEnviar({
      estoqueExterno: 30, estoqueMedido: 999, estoqueNovo: undefined,
      precoEspelho: 59.9, precoNovo: null,
    })
    assert.equal(d.enviar, false)
    // A divergência continua sendo relatada: ela é fato mesmo quando não há
    // o que enviar, e é assim que ela chega a quem olha a linha.
    assert.equal(d.espelhoDivergente, true)
  })

  test('espelho nulo — anúncio novo — envia sem drama', () => {
    const d = precisaEnviar({
      estoqueExterno: null, estoqueMedido: null, estoqueNovo: 1025,
      precoEspelho: null, precoNovo: null,
    })
    assert.equal(d.enviar, true)
    assert.equal(d.espelhoDivergente, false)
  })

  test('divergência sem mudança de número também reenvia', () => {
    // Espelho 1025, medida 30, e a regra hoje mandaria 1025 de novo. É o caso
    // travado; o teste acima cobre a frase, este trava o comportamento.
    const travado = precisaEnviar({
      estoqueExterno: 1025, estoqueMedido: 30, estoqueNovo: 1025,
      precoEspelho: 59.9, precoNovo: null,
    })
    // E o espelho errado para MENOS também: a direção não importa, só a
    // contradição entre o que dizemos e o que a plataforma devolveu.
    const inverso = precisaEnviar({
      estoqueExterno: 30, estoqueMedido: 1025, estoqueNovo: 30,
      precoEspelho: 59.9, precoNovo: null,
    })
    assert.equal(travado.enviar, true)
    assert.equal(inverso.enviar, true)
  })
})
