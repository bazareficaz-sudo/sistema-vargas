import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  variacoesElegiveis, decidirPausaComVariacoes, rotuloDaVariacao, resumoDosAlvos,
  type VariacaoDoAnuncio, type AlvoCalculado,
} from '../../src/lib/marketplace/estoqueVariacoes'
import { corpoDeVariacoes } from '../../src/lib/mercadolivre/write'

// A fila tratava anúncio com variação como fora de escopo, e o comentário
// dizia por quê: "mandar um número só sobrescreveria a distribuição inteira".
// Isso vale para um número no ITEM. Não vale para um número por MODELO, que é
// o que as duas plataformas aceitam.
//
// O que estes testes protegem são as duas decisões que, se erradas, causam
// estrago comercial de verdade:
//
//   1. mexer em variação que não está mapeada (apagaria a distribuição do
//      vendedor com um número que não é dela);
//   2. derrubar o anúncio inteiro porque UMA variação acabou.

const v = (over: Partial<VariacaoDoAnuncio> = {}): VariacaoDoAnuncio => ({
  id: 'var-1', model_id: '100', nome_variacao: 'Azul M', sku_variacao: 'AZ-M',
  produto_id: 'prod-1', preco: 50, estoque: 7, ...over,
})

const alvo = (over: Partial<AlvoCalculado> = {}): AlvoCalculado => ({
  variacaoId: 'var-1', modelId: '100', rotulo: 'Azul M', produtoId: 'prod-1',
  estoqueNovo: 5, precoNovo: null, emRisco: false, enviar: true, ...over,
})

describe('só é tocado o que está mapeado', () => {
  test('variação sem produto vinculado fica INTOCADA, com motivo acionável', () => {
    // O estoque dela na plataforma é a distribuição que o vendedor fez. Não
    // temos número do ERP para pôr no lugar — e zero seria uma invenção.
    const r = variacoesElegiveis([v(), v({ id: 'var-2', model_id: '200', produto_id: null })])
    assert.equal(r.elegiveis.length, 1)
    assert.equal(r.elegiveis[0].id, 'var-1')
    assert.equal(r.ignoradas.length, 1)
    assert.equal(r.ignoradas[0].motivo, 'sem_produto')
    assert.match(r.ignoradas[0].detalhe, /Mapa de anúncios/)
    assert.match(r.ignoradas[0].detalhe, /NÃO foi alterado/)
  })

  test('variação sem id na plataforma também fica de fora, com OUTRO motivo', () => {
    // Os dois casos pedem ações diferentes: um se resolve mapeando, o outro
    // é linha que nunca veio de sincronização e não tem endereço para onde
    // mandar. Uma frase só para os dois esconderia isso.
    const r = variacoesElegiveis([v({ model_id: null })])
    assert.equal(r.elegiveis.length, 0)
    assert.equal(r.ignoradas[0].motivo, 'sem_model_id')
  })

  test('anúncio com nenhuma variação mapeada não produz alvo nenhum', () => {
    const r = variacoesElegiveis([
      v({ produto_id: null }),
      v({ id: 'var-2', model_id: '200', produto_id: null }),
    ])
    assert.equal(r.elegiveis.length, 0)
    assert.equal(r.ignoradas.length, 2)
  })
})

describe('pausar é do ITEM, e por isso exige unanimidade', () => {
  test('UMA variação em risco NÃO derruba o anúncio', () => {
    // O caso que motiva a regra: 5 cores, uma esgotou. Pausar tiraria as
    // outras quatro do ar — um problema maior que o que a pausa resolve.
    const d = decidirPausaComVariacoes([
      alvo({ emRisco: true }),
      alvo({ variacaoId: 'var-2', emRisco: false }),
    ])
    assert.equal(d.pausar, false)
    assert.match(d.porque, /1 de 2/)
    assert.match(d.porque, /continua no ar/)
  })

  test('TODAS em risco: aí sim o item inteiro sai do ar', () => {
    const d = decidirPausaComVariacoes([
      alvo({ emRisco: true }),
      alvo({ variacaoId: 'var-2', emRisco: true }),
    ])
    assert.equal(d.pausar, true)
    assert.match(d.porque, /todas as 2/)
  })

  test('nenhuma em risco: não pausa', () => {
    assert.equal(decidirPausaComVariacoes([alvo(), alvo({ variacaoId: 'var-2' })]).pausar, false)
  })

  test('sem variação controlada, a decisão NÃO é nossa', () => {
    // Nenhum estoque calculado = nenhuma base para tirar o anúncio do ar.
    // Pausar aqui seria decidir por quem cuida do anúncio, sem dado nenhum.
    const d = decidirPausaComVariacoes([])
    assert.equal(d.pausar, false)
    assert.match(d.porque, /nenhuma variação controlada/)
  })

  test('variação sem estoque calculado não conta como "em risco"', () => {
    // Regra que não pôde ser aplicada deixa `estoqueNovo` indefinido. Contar
    // isso como risco pausaria anúncio por causa de regra mal configurada.
    const d = decidirPausaComVariacoes([
      alvo({ estoqueNovo: undefined, emRisco: false }),
      alvo({ variacaoId: 'var-2', emRisco: true }),
    ])
    assert.equal(d.pausar, true, 'a única controlada está em risco')

    const d2 = decidirPausaComVariacoes([alvo({ estoqueNovo: undefined })])
    assert.equal(d2.pausar, false)
  })
})

describe('como a variação aparece no extrato', () => {
  test('nome, senão SKU, senão o id do modelo', () => {
    assert.equal(rotuloDaVariacao(v()), 'Azul M')
    assert.equal(rotuloDaVariacao(v({ nome_variacao: null })), 'SKU AZ-M')
    assert.equal(rotuloDaVariacao(v({ nome_variacao: null, sku_variacao: null })), 'modelo 100')
    assert.equal(
      rotuloDaVariacao(v({ nome_variacao: '  ', sku_variacao: '', model_id: null })),
      'variação sem identificação')
  })

  test('o resumo diz quantas foram e quantas ficaram sem produto', () => {
    const { ignoradas } = variacoesElegiveis([v({ id: 'var-9', model_id: '900', produto_id: null })])
    const r = resumoDosAlvos([alvo(), alvo({ variacaoId: 'var-2', rotulo: 'Azul G', enviar: false })], ignoradas)
    assert.match(r, /1 de 3 variação/)
    assert.match(r, /Azul M → 5/)
    assert.ok(!r.includes('Azul G'), 'quem não vai não entra na lista do que vai')
    assert.match(r, /1 sem produto vinculado/)
  })
})

// ── O PAYLOAD QUE VAI PARA O MERCADO LIVRE ──────────────────────────────
//
// Num item com variação a quantidade mora em `variations[].available_quantity`.
// Mandar `available_quantity` no nível do item é recusado pelo ML — e era
// exatamente isso que `atualizarPrecoEstoque` faria se a fila o chamasse para
// um anúncio com variação.

describe('corpo da atualização de variações no Mercado Livre', () => {
  test('cada variação vira uma entrada com o SEU número', () => {
    const corpo = corpoDeVariacoes([
      { variationId: '111', estoque: 4 },
      { variationId: '222', estoque: 9, preco: 30 },
    ])
    assert.deepEqual(corpo, {
      variations: [
        { id: 111, available_quantity: 4 },
        { id: 222, available_quantity: 9, price: 30 },
      ],
    })
  })

  test('não manda `available_quantity` no nível do item', () => {
    const corpo = corpoDeVariacoes([{ variationId: '111', estoque: 4 }])
    assert.ok(corpo && !('available_quantity' in corpo), 'o item não recebe quantidade')
    assert.ok(corpo && !('price' in corpo))
  })

  test('variação sem nada a mudar não entra na lista', () => {
    assert.equal(corpoDeVariacoes([{ variationId: '111' }]), null)
    const corpo = corpoDeVariacoes([{ variationId: '111' }, { variationId: '222', estoque: 0 }])
    assert.equal(corpo?.variations.length, 1)
    assert.equal(corpo?.variations[0].id, 222)
  })

  test('estoque ZERO é um número, não "sem valor"', () => {
    // `if (v.estoque)` teria engolido o zero — e zerar uma variação esgotada
    // é justamente o que a sincronização precisa conseguir fazer.
    const corpo = corpoDeVariacoes([{ variationId: '111', estoque: 0 }])
    assert.equal(corpo?.variations[0].available_quantity, 0)
  })
})
