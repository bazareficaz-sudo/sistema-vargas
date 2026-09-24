import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// FASE 4C.1.1 — `clientes.saldo_devedor` é PROJEÇÃO de `contas_receber`.
//
// O defeito corrigido: `criar_conta_carteira` inseria a conta — o que dispara
// o gatilho que recalcula o saldo a partir de SUM(valor_aberto) — e em
// seguida somava a MESMA conta de novo. Medido em produção: 9 de 23 clientes
// com conta divergentes, R$ 610,12 a mais, e nos 9 a diferença era
// exatamente o valor da última conta de carteira criada.
//
// É saldo em coluna escrito por duas fontes: o mesmo erro de
// `produto_estoque × produtos.estoque`. O que estes testes travam é a volta
// do segundo escritor.

const raiz = path.resolve(__dirname, '..', '..')
const ler = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8')

const MIG = ler(
  fs.readdirSync(path.join(raiz, 'supabase/migrations'))
    .filter(f => f.includes('saldo_devedor_projecao'))
    .map(f => `supabase/migrations/${f}`)[0],
)
// Comentário explica o defeito; asserção não pode casar com a explicação.
const SQL = MIG.replace(/--[^\n]*/g, '')

describe('a migration deixa UMA fonte do saldo', () => {
  test('cria a regra autoritativa', () => {
    assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.saldo_devedor_autoritativo/)
    assert.match(SQL, /sum\(cr\.valor_aberto\)/)
  })

  test('a regra exclui apenas cancelado — vencido continua sendo dívida', () => {
    const corpo = SQL.slice(SQL.indexOf('saldo_devedor_autoritativo'))
    assert.match(corpo, /status IS DISTINCT FROM 'cancelado'/)
    assert.doesNotMatch(corpo.slice(0, corpo.indexOf('$fn$;')), /'vencido'/)
  })

  test('o gatilho chama a regra em vez de repetir a fórmula', () => {
    const t = SQL.slice(SQL.indexOf('sincronizar_saldo_devedor_cliente'))
    assert.match(t, /saldo_devedor = saldo_devedor_autoritativo\(/)
  })

  test('criar_conta_carteira NAO tem mais incremento cego', () => {
    const f = SQL.slice(SQL.indexOf('criar_conta_carteira'))
    assert.doesNotMatch(f, /saldo_devedor\s*=\s*COALESCE\(\s*saldo_devedor/i)
    assert.doesNotMatch(f, /UPDATE clientes SET/i)
  })

  test('mas continua criando a conta, com a guarda de duplicidade', () => {
    const f = SQL.slice(SQL.indexOf('criar_conta_carteira'))
    assert.match(f, /INSERT INTO contas_receber/)
    assert.match(f, /IF EXISTS \(SELECT 1 FROM contas_receber/)
  })
})

describe('uma venda, uma conta de carteira', () => {
  test('o índice é único e parcial', () => {
    assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS idx_cr_carteira_uma_por_venda/)
    assert.match(SQL, /WHERE origem = 'carteira' AND origem_id IS NOT NULL/)
  })

  test('NAO é um único global em origem_id — isso quebraria o fiado parcelado', () => {
    // O fiado cria N parcelas com o MESMO origem_id. Um índice sem o filtro
    // de origem recusaria a segunda parcela.
    assert.doesNotMatch(SQL, /CREATE UNIQUE INDEX[^;]*\(origem_id\)\s*;/)
  })
})

describe('o saneamento corrige a projeção e NADA mais', () => {
  test('recalcula pela regra, sem valor fixo', () => {
    const bf = SQL.slice(SQL.indexOf('UPDATE clientes c'))
    assert.match(bf, /SET saldo_devedor = public\.saldo_devedor_autoritativo\(c\.id\)/)
    assert.doesNotMatch(bf, /610|299\.34|saldo_devedor\s*=\s*\d/)
  })

  test('só onde há diferença', () => {
    assert.match(SQL, /WHERE round\(coalesce\(c\.saldo_devedor, 0\), 2\)\s*<>/)
  })

  test('não toca documento financeiro nenhum', () => {
    for (const proibido of [
      /UPDATE contas_receber/i, /DELETE FROM contas_receber/i,
      /UPDATE recebimentos/i,   /DELETE FROM recebimentos/i,
      /INSERT INTO recebimentos/i,
      /valor_original\s*=/i,    /valor_recebido\s*=/i,
    ]) assert.doesNotMatch(SQL, proibido)
  })

  test('não encosta no ledger do Caixa nem em pagamentos', () => {
    for (const proibido of [/caixa_movimento/i, /caixa_sessao/i,
      /caixa_transferencia/i, /venda_pagamento/i]) {
      assert.doesNotMatch(SQL, proibido)
    }
  })
})

describe('nenhum escritor cego sobrou no código', () => {
  const arquivos = [
    'src/components/contas-receber/ContasReceberClient.tsx',
    'src/components/contas-receber/ReceberEmMassaModal.tsx',
    'src/app/api/vendas/[id]/cancelar/route.ts',
    'src/components/pdv/PDVClient.tsx',
  ]

  for (const a of arquivos) {
    test(`${a} não escreve saldo_devedor`, () => {
      const codigo = ler(a).replace(/\/\/[^\n]*/g, '')
      // Declarar o campo no tipo e LE-LO na tela e legitimo - o limite de
      // credito do PDV depende disso. O que nao pode voltar e o campo dentro
      // de um `.update({ ... })`, que e o segundo escritor do saldo.
      assert.doesNotMatch(codigo, /[.]update[(][{][^}]*saldo_devedor/)
    })
  }

  test('o PDV preserva a data da compra fiada', () => {
    assert.match(ler('src/components/pdv/PDVClient.tsx'), /data_ultima_compra_fiada:/)
  })
})
