import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { horarioJaPassou, hojeISO, horariosDaRegra, horarioMarcadoVenceu } from '../../src/lib/automacoes/tipos'
import { pedidoAptoParaNfeAutomatica } from '../../src/lib/automacoes/tipos-nfe-marketplace'

// HORÁRIO — o usuário digita hora de Brasília; o servidor roda em UTC.
// Medido em produção antes desta correção: a regra das 08:00 rodava às 05:00
// e a das 18:10 às 15:10.

describe('horário das regras em Brasília', () => {
  const as0800utc = new Date('2026-10-03T08:00:00Z') // 05:00 em Brasília

  test('08:00 ainda não chegou às 08:00 UTC (são 05:00 em Brasília)', () => {
    assert.equal(horarioJaPassou('08:00', as0800utc), false)
    assert.equal(horarioJaPassou('05:00', as0800utc), true)
  })

  test('"hoje" não vira amanhã às 21:00 de Brasília', () => {
    assert.equal(hojeISO(new Date('2026-10-03T23:30:00Z')), '2026-10-03') // 20:30 em Brasília
    assert.equal(hojeISO(new Date('2026-10-04T02:30:00Z')), '2026-10-03') // 23:30 em Brasília
    assert.equal(hojeISO(new Date('2026-10-04T03:00:00Z')), '2026-10-04') // meia-noite
  })
})

describe('vários horários por dia', () => {
  test('lista aceita vírgula, espaço, ponto e vírgula; ordena e normaliza', () => {
    assert.deepEqual(horariosDaRegra('14:00, 9:30;10:00 14:00 lixo 25:00'), ['09:30', '10:00', '14:00'])
    assert.deepEqual(horariosDaRegra(null), [])
  })

  test('cada horário roda uma vez: a das 14:00 roda mesmo com a das 10:00 já feita', () => {
    const regra = '10:00, 14:00'
    const as1005 = new Date('2026-10-03T13:05:00Z') // 10:05 Brasília
    const as1405 = new Date('2026-10-03T17:05:00Z') // 14:05 Brasília

    assert.equal(horarioMarcadoVenceu(regra, null, as1005), true)
    // rodou às 10:05 → até as 14:00 nada
    assert.equal(horarioMarcadoVenceu(regra, as1005.toISOString(), new Date('2026-10-03T16:00:00Z')), false)
    // 14:05: a das 14:00 venceu
    assert.equal(horarioMarcadoVenceu(regra, as1005.toISOString(), as1405), true)
    // rodou às 14:05 → nada mais hoje
    assert.equal(horarioMarcadoVenceu(regra, as1405.toISOString(), new Date('2026-10-03T23:00:00Z')), false)
  })

  test('antes do primeiro horário do dia, nada roda — mesmo tendo rodado ontem', () => {
    const ontem = new Date('2026-10-02T17:05:00Z').toISOString()
    assert.equal(horarioMarcadoVenceu('10:00, 14:00', ontem, new Date('2026-10-03T11:00:00Z')), false) // 08:00
    assert.equal(horarioMarcadoVenceu('10:00, 14:00', ontem, new Date('2026-10-03T13:01:00Z')), true)  // 10:01
  })
})

describe('quais pedidos a automação de NF-e pega', () => {
  function pedido(p: Record<string, any> = {}) {
    return {
      status: 'confirmado', status_externo: 'AWAITING_SHIPMENT', etapa_interna: null,
      nfe_status: null, nfe_numero: null, nfe_informada_em: null,
      need_upload_invoice: 'NEED_INVOICE',
      marketplace_canais: { plataforma: 'tiktok' },
      marketplace_pedido_itens: [{ produto_id: 'p1' }],
      ...p,
    }
  }

  test('pago, sem nota, itens vinculados, canal esperando nota: entra', () => {
    assert.equal(pedidoAptoParaNfeAutomatica(pedido()), true)
  })

  test('nota já aceita pelo canal (emitida em outro sistema): não entra', () => {
    assert.equal(pedidoAptoParaNfeAutomatica(pedido({ need_upload_invoice: 'INVOICE_UPLOADED' })), false)
  })

  test('não pago, enviado ou cancelado: não entra', () => {
    for (const status of ['novo', 'enviado', 'entregue', 'cancelado']) {
      assert.equal(pedidoAptoParaNfeAutomatica(pedido({ status })), false, status)
    }
  })

  test('nota informada à mão, ou já tentada (autorizada, rejeitada, em andamento): não entra', () => {
    assert.equal(pedidoAptoParaNfeAutomatica(pedido({ nfe_numero: '123' })), false)
    for (const nfe_status of ['autorizada', 'rejeitada', 'erro', 'processando']) {
      assert.equal(pedidoAptoParaNfeAutomatica(pedido({ nfe_status })), false, nfe_status)
    }
  })

  test('item sem produto vinculado: não entra (a nota não sairia)', () => {
    assert.equal(pedidoAptoParaNfeAutomatica(pedido({ marketplace_pedido_itens: [{ produto_id: null }] })), false)
  })

  test('bloqueado há pouco espera; bloqueado há mais de 3h volta a ser tentado', () => {
    const agora = Date.parse('2026-10-03T15:00:00Z')
    const recente = pedido({ nfe_status: 'bloqueada', nfe_emissao_em: '2026-10-03T14:00:00Z' })
    const antigo = pedido({ nfe_status: 'bloqueada', nfe_emissao_em: '2026-10-03T11:00:00Z' })
    assert.equal(pedidoAptoParaNfeAutomatica(recente, agora), false)
    assert.equal(pedidoAptoParaNfeAutomatica(antigo, agora), true)
  })

  test('Mercado Livre esperando nota (invoice_pending) entra; já com etiqueta liberada não', () => {
    const ml = { marketplace_canais: { plataforma: 'mercadolivre' }, status_externo: 'paid' }
    assert.equal(pedidoAptoParaNfeAutomatica(pedido({ ...ml, envio_status: 'ready_to_ship', envio_substatus: 'invoice_pending' })), true)
    assert.equal(pedidoAptoParaNfeAutomatica(pedido({ ...ml, envio_status: 'ready_to_ship', envio_substatus: 'ready_to_print' })), false)
  })
})
