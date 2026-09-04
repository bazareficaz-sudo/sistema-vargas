import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { falhasNaResposta } from '../../src/lib/shopee/write'

// A RECUSA QUE VEM DENTRO DE UMA RESPOSTA ACEITA.
//
// `parseShopeeResponse` só lança quando o envelope traz `error` preenchido —
// e está certo, é o contrato do envelope. Mas a Shopee também recusa item e
// modelo DENTRO de `response`, com `error: ""`, e `pushPrecoEstoque`
// descartava o corpo inteiro.
//
// O estrago não era o envio perdido: era a fila gravar `estoque_externo` com
// o número "enviado", tirar o produto da fila, e toda rodada seguinte
// concluir "já igual" comparando o espelho com ele mesmo.

describe('falhasNaResposta', () => {
  test('resposta limpa não inventa falha', () => {
    assert.equal(falhasNaResposta({ error: '', response: { success_list: [{ model_id: 0 }] } }), null)
  })

  test('resposta sem `response` não quebra', () => {
    assert.equal(falhasNaResposta({ error: '', message: '' }), null)
    assert.equal(falhasNaResposta(null), null)
    assert.equal(falhasNaResposta(undefined), null)
  })

  test('failure_list vazia é sucesso, não falha', () => {
    assert.equal(falhasNaResposta({ error: '', response: { failure_list: [] } }), null)
  })

  test('recusa por MODELO nomeia o modelo e repete o motivo da Shopee', () => {
    const s = falhasNaResposta({
      error: '',
      response: {
        failure_list: [{ model_id: 189626342500, failed_reason: 'model not found' }],
        success_list: [],
      },
    })
    assert.match(s ?? '', /modelo 189626342500/)
    assert.match(s ?? '', /model not found/)
  })

  test('recusa por ITEM nomeia o item', () => {
    const s = falhasNaResposta({
      error: '',
      response: { failure_list: [{ item_id: 58267446668, failed_reason: 'item is in promotion' }] },
    })
    assert.match(s ?? '', /item 58267446668/)
    assert.match(s ?? '', /item is in promotion/)
  })

  test('várias recusas viram uma frase só, sem perder nenhuma', () => {
    const s = falhasNaResposta({
      error: '',
      response: {
        failure_list: [
          { model_id: 1, failed_reason: 'a' },
          { model_id: 2, failed_reason: 'b' },
        ],
      },
    })
    assert.match(s ?? '', /modelo 1: a/)
    assert.match(s ?? '', /modelo 2: b/)
  })

  test('`fail_list` também conta — é o nome que o desconto usa', () => {
    const s = falhasNaResposta({
      error: '',
      response: { fail_list: [{ item_id: 7, fail_message: 'discount not editable' }] },
    })
    assert.match(s ?? '', /item 7/)
    assert.match(s ?? '', /discount not editable/)
  })

  test('recusa sem motivo declarado ainda é recusa', () => {
    // Silenciar por falta de texto seria repetir o defeito num nível abaixo.
    const s = falhasNaResposta({ error: '', response: { failure_list: [{ model_id: 5 }] } })
    assert.match(s ?? '', /modelo 5/)
    assert.match(s ?? '', /sem motivo informado/)
  })
})
