import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sinalDeEstoque, sinalDeVendas } from '../../src/lib/precificacao/sinais'
import { capacidadesDoCanal, podePublicar, explicarPublicacao } from '../../src/lib/precificacao/capacidades'

// SINAIS COMERCIAIS E CAPACIDADES DO CANAL.
//
// Os casos que a cobertura de estoque precisa acertar são justamente os que
// uma divisão ingênua erra: sem venda (dividir por zero), produto novo (média
// de poucos dias vira profecia), estoque zero (cobertura zero, não infinita) e
// o pico solitário (uma venda grande que não se repete).

describe('estoque — sinal', () => {
  test('número válido vira estoque com origem', () => {
    const s = sinalDeEstoque(87, 'unificado')
    assert.equal(s.disponivel, 87)
    assert.equal(s.origem, 'unificado')
    assert.equal(s.temEstoque, true)
  })

  test('zero é estoque conhecido, e é zero', () => {
    const s = sinalDeEstoque(0)
    assert.equal(s.disponivel, 0)
    assert.equal(s.temEstoque, false)
    assert.equal(s.origem, 'sistema')
  })

  test('nulo é desconhecido, não zero', () => {
    const s = sinalDeEstoque(null)
    assert.equal(s.disponivel, null)
    assert.equal(s.origem, 'desconhecido')
    assert.equal(s.temEstoque, false)
  })
})

describe('cobertura — os casos que a divisão ingênua erra', () => {
  const COM_ESTOQUE = sinalDeEstoque(90)

  test('ritmo normal: cobertura em dias', () => {
    const v = sinalDeVendas(COM_ESTOQUE, { unidades: 30, dias: 30, pedidos: 12, maiorPedido: 4 })
    assert.equal(v.mediaDiaria, 1)
    assert.equal(v.coberturaDias, 90)
    assert.equal(v.nivel, 'longa')
    assert.equal(v.confiavel, true)
  })

  test('SEM VENDA: não divide por zero, e diz que não há ritmo', () => {
    const v = sinalDeVendas(COM_ESTOQUE, { unidades: 0, dias: 30 })
    assert.equal(v.coberturaDias, null)
    assert.equal(v.nivel, 'sem_venda')
    assert.equal(v.confiavel, true, 'não ter vendido é um fato, não uma incerteza')
    assert.match(v.motivo, /Nenhuma venda/)
  })

  test('ESTOQUE ZERO: cobertura zero, e nada de estratégia', () => {
    const v = sinalDeVendas(sinalDeEstoque(0), { unidades: 30, dias: 30 })
    assert.equal(v.coberturaDias, 0)
    assert.equal(v.nivel, 'sem_estoque')
    assert.match(v.motivo, /Sem estoque/)
  })

  test('PRODUTO NOVO: janela curta não vira ritmo', () => {
    const v = sinalDeVendas(COM_ESTOQUE, { unidades: 10, dias: 5, pedidos: 6, maiorPedido: 2 })
    assert.equal(v.confiavel, false)
    assert.match(v.motivo, /curta demais/)
    assert.ok(v.coberturaDias != null, 'o número existe; o que não existe é a confiança nele')
  })

  test('PICO SOLITÁRIO: um pedido domina o volume', () => {
    const v = sinalDeVendas(COM_ESTOQUE, { unidades: 30, dias: 30, pedidos: 3, maiorPedido: 25 })
    assert.equal(v.confiavel, false)
    assert.match(v.motivo, /não descreve o ritmo/)
  })

  test('PEDIDO ÚNICO: evento, não ritmo', () => {
    const v = sinalDeVendas(COM_ESTOQUE, { unidades: 20, dias: 30, pedidos: 1, maiorPedido: 20 })
    assert.equal(v.confiavel, false)
    assert.match(v.motivo, /um pedido só/)
  })

  test('sem dados de venda, não se inventa média', () => {
    const v = sinalDeVendas(COM_ESTOQUE, { unidades: null, dias: 30 })
    assert.equal(v.mediaDiaria, null)
    assert.equal(v.nivel, 'desconhecida')
    assert.equal(v.confiavel, false)
  })

  test('cobertura curta e longa pelos limites configurados', () => {
    const rapido = sinalDeVendas(sinalDeEstoque(10), { unidades: 60, dias: 30, pedidos: 20, maiorPedido: 5 })
    assert.equal(rapido.nivel, 'curta')
    const proprio = sinalDeVendas(sinalDeEstoque(10), { unidades: 60, dias: 30, pedidos: 20, maiorPedido: 5 }, { curta: 2, longa: 200 })
    assert.equal(proprio.nivel, 'normal', 'os limites são parâmetro, não constante da tela')
  })
})

describe('capacidades — quatro estados, não dois', () => {
  test('Shopee: leitura de campanha é suportada e tem evidência', () => {
    const c = capacidadesDoCanal('shopee')
    assert.equal(c.campanhasLeitura.estado, 'suportado')
    assert.ok(c.campanhasLeitura.evidencia)
    assert.equal(podePublicar(c.campanhasLeitura), true)
  })

  test('Mercado Livre: campanha é NÃO VERIFICADO, e não "não suportado"', () => {
    const c = capacidadesDoCanal('mercadolivre')
    assert.equal(c.campanhasLeitura.estado, 'nao_verificado')
    assert.notEqual(c.campanhasLeitura.estado, 'nao_suportado')
    assert.match(c.campanhasLeitura.motivo!, /403/)
    assert.equal(podePublicar(c.campanhasLeitura), false)
  })

  test('preço por quantidade não foi verificado em nenhum dos dois', () => {
    assert.equal(capacidadesDoCanal('shopee').precoQuantidade.estado, 'nao_verificado')
    assert.equal(capacidadesDoCanal('mercadolivre').precoQuantidade.estado, 'nao_verificado')
  })

  test('canal sem credencial: indisponível por credencial, não incapaz', () => {
    const c = capacidadesDoCanal('shopee', { temCredencial: false })
    assert.equal(c.campanhasLeitura.estado, 'indisponivel_por_credencial')
    // Conhecimento sobre o modelo da plataforma não depende de token.
    assert.equal(c.variacoes.estado, 'suportado')
  })

  test('plataforma desconhecida não some: vira não verificado com motivo', () => {
    const c = capacidadesDoCanal('nuvemshop')
    assert.equal(c.campanhasLeitura.estado, 'nao_verificado')
    assert.match(c.campanhasLeitura.motivo!, /nuvemshop/)
  })

  test('a frase da tela não esconde a funcionalidade', () => {
    const c = capacidadesDoCanal('mercadolivre')
    const frase = explicarPublicacao(c.precoQuantidade)
    assert.match(frase, /Economicamente válido/)
    assert.match(frase, /ainda não disponível/)
  })
})
