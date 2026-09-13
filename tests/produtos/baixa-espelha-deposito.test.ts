import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// DOIS REGISTROS DE ESTOQUE, E A VENDA DE MARKETPLACE SÓ ESCREVIA UM.
//
// `produtos.estoque` e `produto_estoque` (por depósito) são independentes —
// não há gatilho no banco ligando os dois. Venda no PDV e entrada de
// mercadoria já escreviam nos dois, via `ajustarDepositoPrincipal`. A baixa de
// pedido de marketplace escrevia só no primeiro.
//
// MEDIDO EM 13/09/2026, no produto em que o gestor reparou (COLA PASTOSA
// BRANCA): desde a contagem de 27/08 que acertou os dois, 9 unidades saíram
// por marketplace e 2 pelo PDV. Depósito 6, produto −3 — diferença de
// exatamente 9. Na empresa: 613 produtos divergentes, 450 com o depósito
// MAIOR que o produto, 4.320 unidades a mais publicadas.
//
// O estrago não é a tela: a sincronização com os canais lê o DEPÓSITO (o
// estoque unificado aponta para ele). O número anunciado era o que não tinha
// baixado as vendas de marketplace — o sistema alimentava a própria
// sobrevenda que deixou o saldo negativo.
//
// Estes testes são estruturais de propósito: as funções de baixa falam com o
// Supabase em toda linha, e o que precisa ficar travado é que NENHUM caminho
// de escrita de `produtos.estoque` volte a existir sem o espelho.

const FONTE = readFileSync(
  resolve(import.meta.dirname, '../../src/lib/produtos/estoque.ts'), 'utf8')

/** O corpo de uma função do arquivo, do nome dela até a chave de fechamento. */
function corpoDe(nome: string): string {
  const inicio = FONTE.indexOf(`async function ${nome}(`)
  assert.ok(inicio > 0, `função ${nome} não encontrada`)
  const fim = FONTE.indexOf('\n}\n', inicio)
  return FONTE.slice(inicio, fim)
}

describe('toda escrita em produtos.estoque espelha no depósito', () => {
  test('a BAIXA espelha, com o delta negativo', () => {
    const fn = corpoDe('decrementarEstoqueAtomico')
    assert.match(fn, /espelharNoDeposito\(/)
    assert.match(fn, /espelharNoDeposito\(sb, produto\.empresa_id, produtoId, -quantidade\)/)
  })

  test('o ESTORNO espelha, com o delta positivo', () => {
    // Usado quando um componente de kit falha e os anteriores voltam. Sem o
    // espelho aqui, desfazer uma baixa criaria a divergência ao contrário.
    const fn = corpoDe('incrementarEstoque')
    assert.match(fn, /espelharNoDeposito\(sb, produto\.empresa_id, produtoId, quantidade\)/)
  })

  test('o espelho vem DEPOIS da escrita dar certo, não antes', () => {
    // No decremento a escrita é compare-and-swap e pode falhar por
    // concorrência. Espelhar antes de saber se pegou faria o depósito baixar
    // por uma venda que não baixou o produto.
    const fn = corpoDe('decrementarEstoqueAtomico')
    const update = fn.indexOf('.update({ estoque: estoqueNovo })')
    const espelho = fn.indexOf('espelharNoDeposito(')
    assert.ok(update > 0 && espelho > update, 'o espelho tem que vir depois do UPDATE')
    assert.match(fn, /if \(atualizado\) \{[\s\S]*espelharNoDeposito/)
  })

  test('as duas funções leem empresa_id — sem ele não há depósito a achar', () => {
    for (const nome of ['decrementarEstoqueAtomico', 'incrementarEstoque']) {
      assert.match(corpoDe(nome), /select\('estoque, empresa_id'\)/, nome)
    }
  })

  test('falha do espelho NÃO derruba a baixa', () => {
    // O pedido já foi vendido e o estoque do produto já caiu. Propagar o erro
    // aqui desfaria uma baixa legítima por causa do espelho.
    const fn = corpoDe('espelharNoDeposito')
    assert.match(fn, /try \{/)
    assert.match(fn, /catch/)
  })

  test('delta zero não escreve nada', () => {
    assert.match(corpoDe('espelharNoDeposito'), /delta === 0\) return/)
  })
})

describe('o ponto de estrangulamento continua sendo um só', () => {
  test('nenhuma outra função do arquivo escreve produtos.estoque direto', () => {
    // Se um caminho novo aparecer aqui sem espelho, a divergência volta a
    // crescer em silêncio — e levou semanas para alguém reparar da última vez.
    const escritas = [...FONTE.matchAll(/\.update\(\{\s*estoque:/g)]
    assert.equal(escritas.length, 2,
      'só o decremento e o estorno podem escrever produtos.estoque neste arquivo')
  })

  test('a baixa de pedido passa pelas funções espelhadas, não por SQL próprio', () => {
    const fn = corpoDe('baixarEstoquePedidoItem')
    assert.match(fn, /decrementarEstoqueAtomico\(/)
    assert.ok(!/\.update\(\{\s*estoque:/.test(fn),
      'a baixa não pode escrever estoque por fora das funções espelhadas')
  })
})
