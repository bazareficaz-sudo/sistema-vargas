import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// A TAXA QUE ARREDONDAVA PARA ZERO DERRUBAVA A VENDA INTEIRA.
//
// Medido em 22/10/2026, com três dias de lançamento automático: 271 vendas,
// 254 lançadas. Das 17 de fora, 14 eram esperadas. As outras TRÊS eram pix de
// R$ 0,90, R$ 1,00 e R$ 0,96, sem motivo nenhum.
//
// Numa venda de R$ 0,90 no pix, a taxa de 0,49% dá R$ 0,0044 — que arredondado
// vira R$ 0,00. E `caixa_movimento` tem CHECK (valor > 0). O INSERT da taxa
// era recusado, a exceção subia, e como os dois movimentos estão na MESMA
// função, a entrada da venda era desfeita junto.
//
// O bloco EXCEPTION do trigger engolia o erro com um RAISE WARNING que
// ninguém lê, e a venda sumia do caixa SEM aparecer na view de pendências —
// porque o destino existia, então `motivo` vinha nulo.
//
// São R$ 2,86. O valor não é o ponto: o ponto é que existia uma classe de
// venda que sumia em silêncio, e silêncio é exatamente o que o lançamento
// automático existe para acabar.

const raiz = path.resolve(__dirname, '..', '..')
const dir = path.join(raiz, 'supabase', 'migrations')

/** A última definição de `venda_lanca_no_caixa_v1` entre as migrações. */
function funcaoAtual(): string {
  const arquivos = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  let corpo = ''
  for (const a of arquivos) {
    const sql = fs.readFileSync(path.join(dir, a), 'utf8')
    const i = sql.indexOf('CREATE OR REPLACE FUNCTION venda_lanca_no_caixa_v1')
    if (i < 0) continue
    // Até o fim do corpo da função, que termina no `$$;` depois do END.
    const fim = sql.indexOf('$$;', i)
    corpo = sql.slice(i, fim > 0 ? fim + 3 : undefined)
  }
  return corpo
}

describe('a taxa de centavo não pode derrubar a venda', () => {
  const fn = funcaoAtual()

  test('a função existe nas migrações', () => {
    assert.ok(fn.length > 800, `funcao=${fn.length}`)
  })

  test('o valor em reais é CALCULADO antes de decidir', () => {
    // É a correção inteira. Sem esta variável, a decisão volta a ser sobre a
    // alíquota.
    assert.match(fn, /v_taxa_rs\s*:=\s*round\(/)
  })

  test('a decisão olha o VALOR, não a alíquota', () => {
    // `IF COALESCE(v_taxa, 0) > 0` era a versão com defeito: 0,49% é maior
    // que zero, então ela tentava lançar R$ 0,00.
    assert.match(fn, /IF v_taxa_rs > 0 THEN/)
    assert.doesNotMatch(fn, /IF COALESCE\(v_taxa, 0\) > 0 THEN/)
  })

  test('e o INSERT da taxa usa o valor já calculado', () => {
    // Recalcular no INSERT permitiria a condição e o valor divergirem.
    const insert = fn.slice(fn.indexOf("'saida', 'taxa'"))
    assert.match(insert, /v_taxa_rs/)
    assert.doesNotMatch(insert, /round\(v_valor \* v_taxa/)
  })
})

describe('o que NÃO mudou na correção', () => {
  const fn = funcaoAtual()

  test('continua SECURITY DEFINER com search_path fixo', () => {
    // Sem isto a trigger roda como `anon` em toda venda do balcão, a policy
    // de caixa_movimento recusa, e nada lança — com aparência de funcionar.
    assert.match(fn, /SECURITY DEFINER SET search_path = public, pg_temp/)
  })

  test('continua com a trava de data', () => {
    assert.match(fn, /lancar_vendas_desde/)
    assert.match(fn, /v\.created_at::date < v_desde/)
  })

  test('continua idempotente pelo banco', () => {
    // Duas ocorrências: a da venda e a da taxa. A idempotência vem da trava
    // de unicidade, nunca de conferir antes de inserir.
    assert.equal(fn.split('ON CONFLICT DO NOTHING').length - 1, 2)
  })

  test('venda sem vendedor continua fora, em vez de inventar usuário', () => {
    assert.match(fn, /IF v\.vendedor_id IS NULL THEN RETURN 0/)
  })

  test('devolução continua entrando como estorno, e como saída', () => {
    assert.match(fn, /'estorno_venda'/)
    assert.match(fn, /THEN 'saida' ELSE 'entrada'/)
  })
})
