import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  classificarMargem, limitePromocionalEfetivo, podeExecutarSemAprovacao, estaBloqueado,
  type Margens,
} from '../../src/lib/precificacao/margens'

// AS TRÊS MARGENS.
//
// Exemplo do prompt da Fase 2, que estes testes percorrem posição a posição:
//
//   alvo 20% · promocional mínima 15% · piso 10%
//
//   >= 20%            meta atingida
//   >= 15% e < 20%    promoção aceitável
//   >= 10% e < 15%    requer aprovação
//   <  10%            bloqueado

const POLITICA: Margens = { alvo: 20, promocionalMinima: 15, piso: 10 }

describe('margens — as sete posições', () => {
  const casos: [number, string][] = [
    [25, 'alvo'],
    [20, 'alvo'],              // exatamente no alvo conta como alcançado
    [17.8, 'promocional'],
    [15, 'promocional'],       // exatamente no mínimo promocional ainda vale
    [12.3, 'requer_aprovacao'],
    [10, 'requer_aprovacao'],  // exatamente no piso NÃO é bloqueio
    [7.1, 'bloqueado'],
  ]
  for (const [margem, esperado] of casos) {
    test(`${margem}% → ${esperado}`, () => {
      assert.equal(classificarMargem(margem, POLITICA).classificacao, esperado)
    })
  }

  test('margem negativa é bloqueada', () => {
    assert.equal(classificarMargem(-3, POLITICA).classificacao, 'bloqueado')
  })
})

describe('margens — distâncias e folgas', () => {
  test('mede a distância do alvo nos dois sentidos', () => {
    assert.equal(classificarMargem(25, POLITICA).distanciaDoAlvo, 5)
    assert.equal(classificarMargem(12, POLITICA).distanciaDoAlvo, -8)
  })

  test('folga até o piso e até o promocional', () => {
    const r = classificarMargem(17.8, POLITICA)
    assert.equal(r.folgaAtePiso, 7.8)
    assert.equal(r.folgaAtePromocional, 2.8)
  })

  test('sem piso declarado, não há folga até o piso', () => {
    const r = classificarMargem(17.8, { alvo: 20, promocionalMinima: 15, piso: null })
    assert.equal(r.folgaAtePiso, null)
  })
})

describe('margens — o fallback quando a política não foi declarada', () => {
  // A migration NÃO inventa 15%. Ausente significa "sem política
  // promocional", e o limite passa a ser o próprio piso: a faixa promocional
  // fica vazia e nada é aprovado automaticamente.
  const SEM_POLITICA: Margens = { alvo: 20, promocionalMinima: null, piso: 10 }

  test('o limite promocional efetivo vira o piso', () => {
    assert.equal(limitePromocionalEfetivo(SEM_POLITICA), 10)
    assert.equal(limitePromocionalEfetivo(POLITICA), 15)
  })

  test('sem política, o que estaria na faixa promocional cai em promocional pelo piso', () => {
    // Com piso 10 e sem política declarada, 12% >= 10 → promocional.
    // Não é ideal, e é DELIBERADO: sem política, o piso é a única linha que
    // existe, e respeitá-la é o comportamento conservador possível.
    assert.equal(classificarMargem(12, SEM_POLITICA).classificacao, 'promocional')
    assert.equal(classificarMargem(9, SEM_POLITICA).classificacao, 'bloqueado')
  })

  test('sem piso nem política, nada é bloqueado — mas nada é aprovado como promoção', () => {
    const nada: Margens = { alvo: 20, promocionalMinima: null, piso: null }
    assert.equal(classificarMargem(25, nada).classificacao, 'alvo')
    assert.equal(classificarMargem(5, nada).classificacao, 'requer_aprovacao')
    assert.equal(classificarMargem(-10, nada).classificacao, 'requer_aprovacao')
    assert.match(classificarMargem(5, nada).motivo, /sem política promocional/)
  })

  test('piso sem política promocional continua bloqueando abaixo dele', () => {
    const soPiso: Margens = { alvo: 20, promocionalMinima: null, piso: 12 }
    assert.equal(classificarMargem(11.9, soPiso).classificacao, 'bloqueado')
  })
})

describe('margens — guardrail', () => {
  test('alvo e promocional passam sem aprovação; os outros não', () => {
    assert.equal(podeExecutarSemAprovacao('alvo'), true)
    assert.equal(podeExecutarSemAprovacao('promocional'), true)
    assert.equal(podeExecutarSemAprovacao('requer_aprovacao'), false)
    assert.equal(podeExecutarSemAprovacao('bloqueado'), false)
  })

  test('só o bloqueado é bloqueio', () => {
    assert.equal(estaBloqueado('bloqueado'), true)
    assert.equal(estaBloqueado('requer_aprovacao'), false)
  })
})

describe('margens — o motivo é frase pronta, não código', () => {
  test('cada classificação explica a si mesma com os números', () => {
    assert.match(classificarMargem(25, POLITICA).motivo, /alcança a meta/)
    assert.match(classificarMargem(17.8, POLITICA).motivo, /política promocional/)
    assert.match(classificarMargem(12, POLITICA).motivo, /precisa de decisão/)
    assert.match(classificarMargem(7, POLITICA).motivo, /abaixo do piso/)
    // Os números aparecem no texto: é o que a tela e o histórico mostram.
    assert.match(classificarMargem(7, POLITICA).motivo, /7,0%/)
    assert.match(classificarMargem(7, POLITICA).motivo, /10,0%/)
  })
})

describe('margens — o piso é conferido ANTES do alvo', () => {
  test('margem abaixo do piso é bloqueada mesmo quando o alvo é zero', () => {
    // Acontece de verdade: se o piso da regra for inatingível com as taxas do
    // canal, o motor não fecha o preço da regra e a margem alvo derivada cai
    // para zero. Com o alvo conferido primeiro, QUALQUER margem passaria como
    // "meta atingida" — inclusive prejuízo.
    const r = classificarMargem(23, { alvo: 0, promocionalMinima: null, piso: 95 })
    assert.equal(r.classificacao, 'bloqueado')
  })

  test('prejuízo com alvo zero também é bloqueado', () => {
    assert.equal(classificarMargem(-5, { alvo: 0, promocionalMinima: null, piso: 10 }).classificacao, 'bloqueado')
  })

  test('sem piso declarado, alvo zero continua sendo alvo atingido', () => {
    // Sem piso não há o que bloquear: a ausência de política não pode virar
    // proibição.
    assert.equal(classificarMargem(23, { alvo: 0, promocionalMinima: null, piso: null }).classificacao, 'alvo')
  })
})
