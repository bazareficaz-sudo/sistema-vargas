import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  validarPagamento, validarPagamentosDaVenda, somarPagamentos,
  efeitoNaGaveta, projetarPagamentos, derivarDoLegado,
  ehEspecie, FORMAS_ACEITAS,
} from '../../src/lib/vendas/pagamento'

// FASE 4C.1 — O PAGAMENTO COMO ENTIDADE.
//
// A regra que sustenta tudo: o total da venda NÃO é a entrada na gaveta.
// Venda de R$ 150 com R$ 50 em dinheiro e R$ 100 em cartão move o caixa em
// R$ 50 — e é o valor APLICADO, não o que o cliente entregou.
//
// Nada aqui lança movimento: a integração com o ledger é da 4E. O que está
// aqui é o contrato, conferível antes de existir.

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'

describe('o que é um pagamento válido', () => {
  test('dinheiro simples passa', () => {
    assert.equal(validarPagamento({ id: P1, forma: 'dinheiro', valor: 50 }).ok, true)
  })

  test('O ID É OBRIGATÓRIO — sem ele não há idempotência', () => {
    const r = validarPagamento({ forma: 'dinheiro', valor: 50 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /dentificador/)
  })

  test('id que não é uuid é recusado', () => {
    assert.equal(validarPagamento({ id: 'pag-1', forma: 'dinheiro', valor: 50 }).ok, false)
  })

  test('valor zero e negativo são recusados', () => {
    assert.equal(validarPagamento({ id: P1, forma: 'dinheiro', valor: 0 }).ok, false)
    assert.equal(validarPagamento({ id: P1, forma: 'dinheiro', valor: -50 }).ok, false)
  })

  test('forma fora da lista é recusada', () => {
    const r = validarPagamento({ id: P1, forma: 'bitcoin', valor: 50 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /não reconhecida/)
  })

  test('o legado continua aceito — não se recusa o que já existe', () => {
    for (const f of ['devolucao', 'marketplace', 'credito_cliente']) {
      assert.ok(FORMAS_ACEITAS.includes(f), f)
    }
  })

  test('as seis formas canônicas estão aceitas', () => {
    for (const f of ['dinheiro', 'debito', 'credito', 'pix', 'carteira', 'fiado']) {
      assert.ok(FORMAS_ACEITAS.includes(f), f)
    }
  })
})

describe('dinheiro, entregue e troco', () => {
  test('entregue maior que aplicado gera troco', () => {
    const r = validarPagamento({ id: P1, forma: 'dinheiro', valor: 47, valor_entregue: 50 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.valor.valor, 47)
    assert.equal(r.valor.valor_entregue, 50)
    assert.equal(r.valor.troco, 3)
  })

  test('entregue que não cobre o aplicado é recusado', () => {
    assert.equal(validarPagamento({ id: P1, forma: 'dinheiro', valor: 50, valor_entregue: 30 }).ok, false)
  })

  test('SÓ DINHEIRO TEM ENTREGUE', () => {
    // Preencher "entregue = valor" num cartão inventaria um troco de zero
    // que nunca existiu.
    const r = validarPagamento({ id: P1, forma: 'credito', valor: 100, valor_entregue: 100 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /só pagamento em dinheiro/)
  })

  test('cartão e PIX ficam com entregue e troco nulos', () => {
    for (const f of ['credito', 'debito', 'pix', 'carteira']) {
      const r = validarPagamento({ id: P1, forma: f, valor: 100 })
      assert.equal(r.ok, true, f)
      if (!r.ok) return
      assert.equal(r.valor.valor_entregue, null, f)
      assert.equal(r.valor.troco, null, f)
    }
  })

  test('troco sem entregue não tem de onde ser conferido', () => {
    assert.equal(validarPagamento({ id: P1, forma: 'dinheiro', valor: 47, troco: 3 }).ok, false)
  })

  test('troco que não confere é recusado', () => {
    assert.equal(validarPagamento({
      id: P1, forma: 'dinheiro', valor: 47, valor_entregue: 50, troco: 99,
    }).ok, false)
  })

  test('entregue igual ao aplicado dá troco zero, não nulo', () => {
    const r = validarPagamento({ id: P1, forma: 'dinheiro', valor: 50, valor_entregue: 50 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.valor.troco, 0)
  })
})

describe('a lista de pagamentos de uma venda', () => {
  test('uma forma só continua sendo o caso normal', () => {
    const r = validarPagamentosDaVenda([{ id: P1, forma: 'dinheiro', valor: 100 }], 100)
    assert.equal(r.ok, true)
  })

  test('DINHEIRO + CARTÃO fecha', () => {
    const r = validarPagamentosDaVenda([
      { id: P1, forma: 'dinheiro', valor: 50 },
      { id: P2, forma: 'credito', valor: 100 },
    ], 150)
    assert.equal(r.ok, true)
  })

  test('dinheiro + PIX + cartão fecha', () => {
    const r = validarPagamentosDaVenda([
      { id: P1, forma: 'dinheiro', valor: 50 },
      { id: P2, forma: 'pix', valor: 100 },
      { id: P3, forma: 'credito', valor: 150 },
    ], 300)
    assert.equal(r.ok, true)
  })

  test('DOIS CARTÕES DE MESMO VALOR são dois pagamentos', () => {
    // É o motivo de a identidade não poder ser (venda, forma, valor).
    const r = validarPagamentosDaVenda([
      { id: P1, forma: 'credito', valor: 50 },
      { id: P2, forma: 'credito', valor: 50 },
    ], 100)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.valor.length, 2)
  })

  test('o mesmo id duas vezes é duplicata', () => {
    const r = validarPagamentosDaVenda([
      { id: P1, forma: 'credito', valor: 50 },
      { id: P1, forma: 'credito', valor: 50 },
    ], 100)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /mesmo identificador/)
  })

  test('soma que não fecha é recusada, com os dois números na mensagem', () => {
    const r = validarPagamentosDaVenda([{ id: P1, forma: 'dinheiro', valor: 50 }], 150)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /50\.00/)
    assert.match(r.erro, /150\.00/)
  })

  test('lista vazia é recusada', () => {
    assert.equal(validarPagamentosDaVenda([], 100).ok, false)
  })

  test('a soma não acumula erro de ponto flutuante', () => {
    // Em produção existe um 197.32000000000002 gravado no jsonb — o tipo
    // que `numeric(14,2)` não deixa nascer e que esta soma não reproduz.
    const r = validarPagamentosDaVenda([
      { id: P1, forma: 'dinheiro', valor: 0.1 },
      { id: P2, forma: 'pix', valor: 0.2 },
    ], 0.3)
    assert.equal(r.ok, true)
    assert.equal(somarPagamentos([{ valor: 0.1 }, { valor: 0.2 }]), 0.3)
  })

  test('a sequência é atribuída quando não vem', () => {
    const r = validarPagamentosDaVenda([
      { id: P1, forma: 'dinheiro', valor: 50 },
      { id: P2, forma: 'credito', valor: 50 },
    ], 100)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.deepEqual(r.valor.map(p => p.sequencia), [1, 2])
  })
})

describe('O EFEITO NA GAVETA — o contrato do ledger', () => {
  test('só dinheiro é espécie', () => {
    assert.equal(ehEspecie('dinheiro'), true)
    for (const f of ['credito', 'debito', 'pix', 'carteira', 'fiado', 'marketplace']) {
      assert.equal(ehEspecie(f), false, f)
    }
  })

  test('R$ 150 com 50 dinheiro + 100 cartão move a gaveta em 50, NÃO em 150', () => {
    const pagamentos = [
      { forma: 'dinheiro', valor: 50 },
      { forma: 'credito', valor: 100 },
    ]
    assert.equal(efeitoNaGaveta(pagamentos), 50)
    assert.notEqual(efeitoNaGaveta(pagamentos), 150)
  })

  test('venda inteira em cartão não move a gaveta', () => {
    assert.equal(efeitoNaGaveta([{ forma: 'credito', valor: 300 }]), 0)
  })

  test('CARTEIRA NÃO É DINHEIRO', () => {
    // Ela vira conta a receber pelo trigger existente. Contá-la na gaveta
    // seria o dinheiro entrando duas vezes.
    assert.equal(efeitoNaGaveta([{ forma: 'carteira', valor: 100 }]), 0)
  })

  test('o cenário dos três: 100 dinheiro + 100 cartão + 100 carteira', () => {
    const p = [
      { forma: 'dinheiro', valor: 100 },
      { forma: 'credito', valor: 100 },
      { forma: 'carteira', valor: 100 },
    ]
    assert.equal(somarPagamentos(p), 300)   // a venda vale 300
    assert.equal(efeitoNaGaveta(p), 100)    // a gaveta recebe 100
  })

  test('o efeito é o APLICADO, não o entregue', () => {
    // Cliente entrega 100 por uma parcela de 50 e leva 50 de troco: os dois
    // atos acontecem juntos, e o líquido é 50.
    assert.equal(efeitoNaGaveta([{ forma: 'dinheiro', valor: 50 }]), 50)
  })
})

describe('a projeção para vendas.pagamentos', () => {
  test('agrupa por forma na ordem da sequência', () => {
    const r = projetarPagamentos([
      { forma: 'dinheiro', valor: 50, sequencia: 1 },
      { forma: 'credito', valor: 100, sequencia: 2 },
    ])
    assert.deepEqual(r, [
      { forma: 'dinheiro', valor: 50 },
      { forma: 'credito', valor: 100 },
    ])
  })

  test('dois cartões viram uma linha somada no array', () => {
    // O array é o que os consumidores antigos esperam: quanto foi pago em
    // cada forma. A identidade individual fica na tabela.
    const r = projetarPagamentos([
      { forma: 'credito', valor: 50, sequencia: 1 },
      { forma: 'credito', valor: 50, sequencia: 2 },
    ])
    assert.deepEqual(r, [{ forma: 'credito', valor: 100 }])
  })

  test('ESTORNO DESCONTA, e a forma zerada some', () => {
    const r = projetarPagamentos([
      { forma: 'dinheiro', valor: 50, sequencia: 1 },
      { forma: 'credito', valor: 100, sequencia: 2 },
      { forma: 'dinheiro', valor: 50, sequencia: 3, estorno_de_id: 'x' },
    ])
    assert.deepEqual(r, [{ forma: 'credito', valor: 100 }])
  })

  test('estorno parcial deixa o saldo', () => {
    const r = projetarPagamentos([
      { forma: 'dinheiro', valor: 100, sequencia: 1 },
      { forma: 'dinheiro', valor: 30, sequencia: 2, estorno_de_id: 'x' },
    ])
    assert.deepEqual(r, [{ forma: 'dinheiro', valor: 70 }])
  })

  test('tudo estornado vira array vazio, não nulo', () => {
    const r = projetarPagamentos([
      { forma: 'dinheiro', valor: 50, sequencia: 1 },
      { forma: 'dinheiro', valor: 50, sequencia: 2, estorno_de_id: 'x' },
    ])
    assert.deepEqual(r, [])
  })
})

describe('compatibilidade com o PDV antigo', () => {
  test('forma única vira um pagamento', () => {
    assert.deepEqual(derivarDoLegado('dinheiro', 100), { forma: 'dinheiro', valor: 100 })
  })

  test('MISTO NÃO É DECOMPOSTO — devolve null', () => {
    // 12 vendas em produção onde a parcela em dinheiro é indeterminável.
    // Dividir ao meio seria transformar ausência de informação em
    // informação.
    assert.equal(derivarDoLegado('misto', 150), null)
  })

  test('multiplo também não é decomposto', () => {
    assert.equal(derivarDoLegado('multiplo', 150), null)
  })

  test('sem forma não deriva nada', () => {
    assert.equal(derivarDoLegado(null, 100), null)
    assert.equal(derivarDoLegado(undefined, 100), null)
    assert.equal(derivarDoLegado('', 100), null)
  })

  test('total zero ou negativo não deriva', () => {
    // As 18 devoluções têm total negativo.
    assert.equal(derivarDoLegado('dinheiro', 0), null)
    assert.equal(derivarDoLegado('dinheiro', -50), null)
  })

  test('forma desconhecida não deriva', () => {
    assert.equal(derivarDoLegado('bitcoin', 100), null)
  })

  test('o derivado fecha com o total', () => {
    const d = derivarDoLegado('pix', 250)
    assert.notEqual(d, null)
    assert.equal(validarPagamentosDaVenda([{ ...d!, id: P1 }], 250).ok, true)
  })
})

// GARANTIAS ESTRUTURAIS DA MIGRATION.
//
// Os comentarios dela EXPLICAM o que ela nao faz — e citam "CHECK de
// SUM(...)" e "anon" ao fazer isso. Testar contra o texto bruto casaria com
// a explicacao em vez do comando, entao os comentarios saem antes.
describe('a migration nao toca em producao', () => {
  const raiz = path.join(__dirname, '..', '..')
  const MIG = fs.readFileSync(
    path.join(raiz, 'supabase/migrations/20260924113939_venda_pagamento_v1.sql'), 'utf8')
  const SQL = MIG.replace(/--[^\n]*/g, '')

  test('nao altera a tabela vendas', () => {
    assert.equal(/ALTER TABLE\s+vendas\b/i.test(SQL), false)
  })

  test('nao mexe nos triggers existentes de vendas', () => {
    assert.equal(/DROP TRIGGER[^;]*ON\s+vendas\b/i.test(SQL), false)
    assert.equal(/criar_conta_carteira/i.test(SQL), false)
  })

  test('nao toca no ledger do Caixa', () => {
    assert.equal(/INSERT INTO caixa|UPDATE caixa_|DELETE FROM caixa/i.test(SQL), false)
  })

  test('nao faz backfill', () => {
    assert.equal(/INSERT INTO venda_pagamento/i.test(SQL), false)
  })

  test('anon nao ganha nada', () => {
    assert.match(SQL, /REVOKE ALL ON TABLE venda_pagamento FROM anon/)
    assert.equal(/GRANT[^;]*\banon\b/i.test(SQL), false, 'nenhum GRANT cita anon')
  })

  test('append-only: sem policy de UPDATE nem DELETE', () => {
    assert.equal(/CREATE POLICY[^;]*FOR UPDATE/i.test(SQL), false)
    assert.match(SQL, /REVOKE UPDATE, DELETE, TRUNCATE ON TABLE venda_pagamento FROM authenticated/)
  })

  test('a empresa e derivada da venda, nao aceita do payload', () => {
    assert.match(SQL, /NEW\.empresa_id := v_emp/)
  })

  test('NAO existe CHECK de soma — a validacao e da ingestao', () => {
    assert.equal(/CHECK\s*\([^)]*\bsum\s*\(/i.test(SQL), false)
  })
})
