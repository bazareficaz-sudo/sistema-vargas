import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ratear, totalDosEncargos, somaPorTipo, type Encargo, type ItemRateavel } from '../../src/lib/entradas/rateio'

// O QUE ESTES TESTES PROTEGEM.
//
// Rateio é onde dinheiro some sem ninguém notar: o valor é distribuído, cada
// pedaço é arredondado, e a soma dos pedaços fica alguns centavos abaixo do
// encargo. Ninguém confere. Meses depois o custo dos produtos está baixo e a
// margem parece melhor do que é.
//
// A afirmação central destes testes é sempre a mesma: SOMA DO QUE FOI
// DISTRIBUÍDO + NÃO RATEADO = VALOR DO ENCARGO, exatamente, em centavos.

const enc = (p: Partial<Encargo>): Encargo => ({
  id: p.id ?? 'e1', tipo: p.tipo ?? 'frete', valor: p.valor ?? 0,
  base: p.base ?? 'valor', itens: p.itens ?? [], descricao: p.descricao ?? null,
})

const soma = (v: number[]) => Math.round(v.reduce((s, x) => s + x, 0) * 100) / 100

describe('rateio de encargos da entrada', () => {
  test('frete por valor: cada item recebe na proporção do seu subtotal', () => {
    const itens: ItemRateavel[] = [
      { quantidade: 10, precoUnitario: 30 },  // 300 → 3/4
      { quantidade: 10, precoUnitario: 10 },  // 100 → 1/4
    ]
    const r = ratear(itens, [enc({ tipo: 'frete', valor: 100, base: 'valor' })])
    assert.equal(r.porItem[0], 75)
    assert.equal(r.porItem[1], 25)
    assert.equal(r.custoUnitarioFinal[0], 37.5)
    assert.equal(r.custoUnitarioFinal[1], 12.5)
    assert.equal(r.naoRateado, 0)
  })

  test('frete por quantidade ignora o preço', () => {
    const itens: ItemRateavel[] = [
      { quantidade: 500, precoUnitario: 40 },
      { quantidade: 1, precoUnitario: 4000 },
    ]
    const r = ratear(itens, [enc({ tipo: 'frete', valor: 501, base: 'quantidade' })])
    assert.equal(r.porItem[0], 500)
    assert.equal(r.porItem[1], 1)
  })

  test('SOMA FECHA MESMO COM DÍZIMA: 100,00 entre 3 itens iguais', () => {
    const itens: ItemRateavel[] = [
      { quantidade: 1, precoUnitario: 10 },
      { quantidade: 1, precoUnitario: 10 },
      { quantidade: 1, precoUnitario: 10 },
    ]
    const r = ratear(itens, [enc({ tipo: 'frete', valor: 100 })])
    // 33,34 / 33,33 / 33,33 — e não 33,33 três vezes, que perderia 1 centavo.
    assert.equal(soma(r.porItem), 100)
    assert.deepEqual([...r.porItem].sort((a, b) => a - b), [33.33, 33.33, 33.34])
  })

  test('soma fecha em cima de pesos irregulares e valor quebrado', () => {
    const itens: ItemRateavel[] = [
      { quantidade: 3, precoUnitario: 7.77 },
      { quantidade: 11, precoUnitario: 1.13 },
      { quantidade: 2, precoUnitario: 99.99 },
      { quantidade: 7, precoUnitario: 0.55 },
    ]
    const r = ratear(itens, [enc({ tipo: 'frete', valor: 187.43 })])
    assert.equal(soma(r.porItem), 187.43)
  })

  test('desconto e bonificação abatem o custo; frete e seguro encarecem', () => {
    const itens: ItemRateavel[] = [{ quantidade: 10, precoUnitario: 10 }]
    const r = ratear(itens, [
      enc({ id: 'a', tipo: 'frete', valor: 20 }),
      enc({ id: 'b', tipo: 'seguro', valor: 10 }),
      enc({ id: 'c', tipo: 'desconto', valor: 5 }),
      enc({ id: 'd', tipo: 'bonificacao', valor: 5 }),
    ])
    // +20 +10 −5 −5 = +20 em 10 unidades = +2,00 por unidade
    assert.equal(r.porItem[0], 20)
    assert.equal(r.custoUnitarioFinal[0], 12)
  })

  test('encargo restrito a itens selecionados não toca nos demais', () => {
    const itens: ItemRateavel[] = [
      { quantidade: 1, precoUnitario: 1000 },
      { quantidade: 100, precoUnitario: 2 },
    ]
    const r = ratear(itens, [enc({ tipo: 'frete', valor: 300, itens: [0] })])
    assert.equal(r.porItem[0], 300)
    assert.equal(r.porItem[1], 0)
    assert.equal(r.custoUnitarioFinal[1], 2, 'o parafuso não paga o frete da máquina')
  })

  test('índice de item que já foi removido é ignorado, o resto rateia', () => {
    const itens: ItemRateavel[] = [{ quantidade: 1, precoUnitario: 10 }]
    const r = ratear(itens, [enc({ tipo: 'frete', valor: 50, itens: [0, 7] })])
    assert.equal(r.porItem[0], 50)
    assert.equal(r.naoRateado, 0)
  })

  test('DINHEIRO NUNCA SOME: seleção vazia de itens vira naoRateado, com aviso', () => {
    const itens: ItemRateavel[] = [{ quantidade: 1, precoUnitario: 10 }]
    const r = ratear([], [enc({ tipo: 'frete', valor: 80 })])
    assert.equal(r.naoRateado, 80)
    assert.equal(r.alertas.length, 1)
    // e com itens, o mesmo encargo é integralmente distribuído
    assert.equal(ratear(itens, [enc({ tipo: 'frete', valor: 80 })]).naoRateado, 0)
  })

  test('itens de custo zero: cai de valor para quantidade em vez de descartar', () => {
    const itens: ItemRateavel[] = [
      { quantidade: 3, precoUnitario: 0 },
      { quantidade: 1, precoUnitario: 0 },
    ]
    const r = ratear(itens, [enc({ tipo: 'frete', valor: 40, base: 'valor' })])
    assert.equal(soma(r.porItem), 40)
    assert.equal(r.porItem[0], 30)
    assert.equal(r.porItem[1], 10)
    assert.match(r.alertas[0], /rateado por quantidade/)
  })

  test('sem valor e sem quantidade, o encargo fica visível em naoRateado', () => {
    const itens: ItemRateavel[] = [{ quantidade: 0, precoUnitario: 0 }]
    const r = ratear(itens, [enc({ tipo: 'frete', valor: 15 })])
    assert.equal(r.naoRateado, 15)
    assert.equal(soma(r.porItem), 0)
  })

  test('abatimento maior que o custo para em zero e avisa — nunca custo negativo', () => {
    const itens: ItemRateavel[] = [{ quantidade: 2, precoUnitario: 5 }]
    const r = ratear(itens, [enc({ tipo: 'desconto', valor: 50 })])
    assert.equal(r.custoUnitarioFinal[0], 0)
    assert.match(r.alertas.join(' '), /maior que o custo/)
  })

  test('o mesmo rateio duas vezes dá o mesmo resultado', () => {
    const itens: ItemRateavel[] = [
      { quantidade: 1, precoUnitario: 3 }, { quantidade: 1, precoUnitario: 3 },
      { quantidade: 1, precoUnitario: 3 }, { quantidade: 1, precoUnitario: 3 },
    ]
    const e = [enc({ tipo: 'frete', valor: 10 })]
    assert.deepEqual(ratear(itens, e).porItem, ratear(itens, e).porItem)
  })

  test('encargo de valor zero não gera linha nem aviso', () => {
    const r = ratear([{ quantidade: 1, precoUnitario: 10 }], [enc({ tipo: 'frete', valor: 0 })])
    assert.equal(r.porItem[0], 0)
    assert.equal(r.alertas.length, 0)
  })

  test('totalDosEncargos aplica o sinal de cada tipo', () => {
    assert.equal(totalDosEncargos([
      enc({ id: '1', tipo: 'frete', valor: 100 }),
      enc({ id: '2', tipo: 'desconto', valor: 30 }),
      enc({ id: '3', tipo: 'bonificacao', valor: 20 }),
      enc({ id: '4', tipo: 'seguro', valor: 10 }),
    ]), 60)
  })

  test('somaPorTipo agrupa para as colunas antigas da tabela entradas', () => {
    const lista = [
      enc({ id: '1', tipo: 'frete', valor: 100 }),
      enc({ id: '2', tipo: 'frete', valor: 50 }),
      enc({ id: '3', tipo: 'seguro', valor: 25 }),
      enc({ id: '4', tipo: 'desconto', valor: 10 }),
    ]
    assert.equal(somaPorTipo(lista, ['frete']), 150)
    assert.equal(somaPorTipo(lista, ['seguro', 'despesas', 'outros']), 25)
    assert.equal(somaPorTipo(lista, ['desconto', 'bonificacao']), 10)
  })
})
