import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  destinatarioTiktok, destinatarioShopee, destinatarioMercadoLivre, pendenciasDestinatario, explicarPendencias, ufDe,
} from '../../src/lib/fiscal/destinatario'

// A NF-e não sai sem CPF/CNPJ e endereço completo do comprador, e a UF desse
// endereço decide o CFOP. Os três marketplaces entregam isso em formatos
// diferentes — os casos abaixo usam a ESTRUTURA de pedidos reais de cada um,
// com dados fictícios.

describe('TikTok', () => {
  const pedido = {
    cpf: '123.456.789-09',
    cpf_name: 'Maria da Silva',
    recipient_address: {
      name: 'Maria S',
      postal_code: '28980-000',
      address_line1: 'Parque Hotel',
      address_line2: 'Rua das Flores',
      address_line3: 's/n',
      address_line4: 'lote 12 quadra B',
      district_info: [
        { address_level: 'L0', iso_code: 'BR', address_name: 'Brasil' },
        { address_level: 'L1', iso_code: 'RJ', address_name: 'RJ' },
        { address_level: 'L2', address_name: 'Araruama' },
      ],
    },
  }

  test('linhas em posição fixa: bairro, rua, número, complemento', () => {
    const d = destinatarioTiktok(pedido)
    assert.equal(d.cpfCnpj, '12345678909')
    assert.equal(d.nome, 'Maria da Silva')
    assert.deepEqual(d.endereco, {
      bairro: 'Parque Hotel', logradouro: 'Rua das Flores', numero: 's/n', complemento: 'lote 12 quadra B',
      cep: '28980000', municipio: 'Araruama', uf: 'RJ',
    })
    assert.deepEqual(pendenciasDestinatario(d), [])
  })
})

describe('Shopee', () => {
  test('endereço mascarado vira pendência — não "****" na nota', () => {
    const d = destinatarioShopee({
      buyer_cpf_id: '12345678909',
      recipient_address: { name: 'M****a', state: '****', city: '****', district: '****', zipcode: '****', full_address: '****' },
    })
    assert.equal(d.cpfCnpj, '12345678909')
    assert.equal(d.endereco.uf, null)
    const p = pendenciasDestinatario(d)
    assert.deepEqual(p, ['nome do comprador', 'logradouro', 'bairro', 'cidade', 'UF', 'CEP'])
    assert.match(explicarPendencias(d, p), /mascarado/)
  })

  test('sem buyer_cpf_id o CPF falta, e isso aparece', () => {
    const d = destinatarioShopee({
      recipient_address: { name: 'Maria', state: 'São Paulo', city: 'Campinas', district: 'Centro', zipcode: '13010000', full_address: 'Rua X, 10' },
    })
    assert.equal(d.endereco.uf, 'SP')
    assert.deepEqual(pendenciasDestinatario(d), ['CPF/CNPJ do comprador'])
  })
})

describe('Mercado Livre', () => {
  test('formato atual (x-version 2)', () => {
    const d = destinatarioMercadoLivre({
      buyer: {
        billing_info: {
          name: 'João', last_name: 'Souza',
          identification: { type: 'CPF', number: '98765432100' },
          address: {
            street_name: 'Nicolau de Marcos', street_number: '120', city_name: 'Campos',
            state: { code: 'BR-RJ', name: 'Rio de Janeiro' }, zip_code: '28010-000',
            neighborhood: 'Centro', comment: 'apto 3',
          },
        },
      },
    })
    assert.equal(d.nome, 'João Souza')
    assert.equal(d.cpfCnpj, '98765432100')
    assert.equal(d.endereco.uf, 'RJ')
    assert.equal(d.endereco.complemento, 'apto 3')
    assert.deepEqual(pendenciasDestinatario(d), [])
  })

  test('formato antigo (additional_info) e empresa com IE', () => {
    const d = destinatarioMercadoLivre({
      billing_info: {
        doc_type: 'CNPJ', doc_number: '12.345.678/0001-95',
        additional_info: [
          { type: 'BUSINESS_NAME', value: 'Loja Exemplo Ltda' },
          { type: 'STREET_NAME', value: 'Av. Brasil' }, { type: 'STREET_NUMBER', value: '500' },
          { type: 'NEIGHBORHOOD', value: 'Centro' }, { type: 'CITY_NAME', value: 'Belo Horizonte' },
          { type: 'STATE_NAME', value: 'Minas Gerais' }, { type: 'ZIP_CODE', value: '30110000' },
          { type: 'STATE_REGISTRATION', value: '062.307.904/0081' },
        ],
      },
    })
    assert.equal(d.nome, 'Loja Exemplo Ltda')
    assert.equal(d.cpfCnpj, '12345678000195')
    assert.equal(d.inscricaoEstadual, '0623079040081')
    assert.equal(d.endereco.uf, 'MG')
    assert.deepEqual(pendenciasDestinatario(d), [])
  })

  test('"ISENTO" não é inscrição estadual — continua consumidor final', () => {
    const d = destinatarioMercadoLivre({ buyer: { billing_info: { taxes: { inscriptions: { state_registration: 'ISENTO' } } } } })
    assert.equal(d.inscricaoEstadual, null)
  })
})

describe('UF', () => {
  test('sigla, prefixo BR-, nome com e sem acento', () => {
    assert.equal(ufDe('sp'), 'SP')
    assert.equal(ufDe('BR-PE'), 'PE')
    assert.equal(ufDe('São Paulo'), 'SP')
    assert.equal(ufDe('Espirito Santo'), 'ES')
    assert.equal(ufDe('****'), null)
    assert.equal(ufDe('Narnia'), null)
  })
})
