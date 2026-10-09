import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// RECEBIMENTO EM LOTE — transacional e idempotente.
//
// O laço anterior gravava conta a conta, sem transação. Falha no meio
// deixava as primeiras escritas, o modal ficava aberto com a seleção
// intacta, e o reenvio gravava de novo. Medido: 29 pares duplicados,
// 38 lançamentos excedentes, R$ 2.175,73 — 26 deles em rajadas de até 5
// segundos, a assinatura de reenvio sobre escrita parcial.
//
// Estes testes guardam as três propriedades que a RPC traz: atomicidade,
// identidade de lote travada no banco, e leitura do valor no banco em vez
// da cópia que a tela carregou.

const raiz = path.resolve(__dirname, '..', '..')
const BRUTO = fs.readFileSync(
  path.join(raiz, 'supabase/migrations/20261009154825_receber_contas_em_lote_v1.sql'), 'utf8')
const SQL = BRUTO.replace(/--[^\n]*/g, '')

describe('a identidade do lote é trava de banco', () => {
  test('coluna nullable — o historico sem lote continua valido', () => {
    assert.match(SQL, /ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS lote_id uuid/)
    assert.doesNotMatch(SQL, /lote_id uuid NOT NULL/)
  })

  test('indice unico parcial em (lote_id, conta_id)', () => {
    assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS idx_recebimentos_lote_conta/)
    assert.match(SQL, /ON recebimentos \(lote_id, conta_id\)\s*\n?\s*WHERE lote_id IS NOT NULL/)
  })

  test('o reenvio é barrado pelo indice, nao por verificacao na aplicacao', () => {
    assert.match(SQL, /ON CONFLICT \(lote_id, conta_id\) WHERE lote_id IS NOT NULL DO NOTHING/)
    assert.match(SQL, /RETURNING id INTO v_rec_id/)
    // Sem linha devolvida, a conta nao é tocada de novo.
    assert.match(SQL, /IF v_rec_id IS NULL THEN[\s\S]{0,200}CONTINUE/)
  })

  test('serializa envios simultaneos do mesmo lote', () => {
    assert.match(SQL, /pg_advisory_xact_lock\(hashtextextended\(v_lote::text, 0\)\)/)
  })
})

describe('atomicidade: confere tudo antes de gravar qualquer coisa', () => {
  // Ancorar em 'PASSO 1'/'PASSO 2' nao serve: esses rotulos vivem so nos
  // comentarios, que sao removidos acima. Os dois lacos sobre
  // `p_payload->'contas'` sao a fronteira real — o primeiro confere, o
  // segundo grava.
  const ANCORA = "FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'contas')"
  const inicio = SQL.indexOf(ANCORA)
  const segundo = SQL.indexOf(ANCORA, inicio + 1)
  const passo1 = SQL.slice(inicio, segundo)
  const passo2 = SQL.slice(segundo)

  test('o recorte dos dois passos nao é vazio', () => {
    assert.ok(passo1.length > 300 && passo2.length > 300,
      `passo1=${passo1.length} passo2=${passo2.length}`)
  })

  test('o passo de conferencia NAO escreve', () => {
    for (const proibido of [/INSERT INTO/i, /UPDATE contas_receber/i, /UPDATE clientes/i]) {
      assert.doesNotMatch(passo1, proibido)
    }
  })

  test('conta cancelada ou quitada recusa o lote INTEIRO', () => {
    assert.match(passo1, /status IN \('cancelado','recebido'\)/)
    assert.match(passo1, /'estado','conta_indisponivel'/)
  })

  test('mas o retry do MESMO lote nao é confundido com divergencia', () => {
    assert.match(passo1, /EXISTS \(SELECT 1 FROM recebimentos r[\s\S]{0,160}lote_id = v_lote[\s\S]{0,120}CONTINUE/)
  })

  test('valor que estouraria a conta é recusado antes de gravar', () => {
    assert.match(passo1, /> round\(v_conta\.valor_original, 2\)/)
    assert.match(passo1, /'estado','valor_excede_a_conta'/)
  })
})

describe('o valor vem do banco, nao da tela', () => {
  test('soma sobre v_conta.valor_recebido lido na hora', () => {
    assert.match(SQL, /v_novo_rec := round\(coalesce\(v_conta\.valor_recebido,0\) \+ v_valor, 2\)/)
  })

  test('status recalculado do valor em aberto', () => {
    assert.match(SQL, /v_aberto\s*:=\s*round\(v_conta\.valor_original - v_novo_rec, 2\)/)
    assert.match(SQL, /CASE WHEN v_aberto <= 0\.01 THEN 'recebido' ELSE 'parcial' END/)
  })
})

describe('saldo_devedor continua sendo projecao', () => {
  test('a RPC NAO escreve clientes.saldo_devedor', () => {
    // Quem o mantem é z_trg_sincronizar_saldo_devedor, que dispara sozinho
    // no UPDATE de contas_receber. Escrever aqui seria o segundo escritor
    // que a 4C.1.1 eliminou.
    assert.doesNotMatch(SQL, /UPDATE clientes/i)
    assert.doesNotMatch(SQL, /saldo_devedor/i)
  })
})

describe('o que a RPC NAO faz', () => {
  test('nao encosta no ledger do Caixa', () => {
    for (const p of [/caixa_movimento/i, /caixa_sessao/i, /caixa_transferencia/i]) {
      assert.doesNotMatch(SQL, p)
    }
  })

  test('nao mexe em vendas nem em pagamentos', () => {
    for (const p of [/INSERT INTO vendas/i, /UPDATE vendas/i, /venda_pagamento/i]) {
      assert.doesNotMatch(SQL, p)
    }
  })

  test('nao apaga recebimento nenhum', () => {
    assert.doesNotMatch(SQL, /DELETE FROM recebimentos/i)
    assert.doesNotMatch(SQL, /UPDATE recebimentos/i)
  })

  test('nao faz backfill de lote nos recebimentos historicos', () => {
    assert.doesNotMatch(SQL, /UPDATE recebimentos\s+SET\s+lote_id/i)
  })
})

describe('o modal usa a RPC, e nao grava mais direto', () => {
  const MODAL = fs.readFileSync(
    path.join(raiz, 'src/components/contas-receber/ReceberEmMassaModal.tsx'), 'utf8')
  const CODIGO = MODAL.replace(/\/\/[^\n]*/g, '')

  test('chama receber_contas_em_lote_v1', () => {
    assert.match(CODIGO, /sb\.rpc\('receber_contas_em_lote_v1'/)
  })

  test('NAO escreve recebimentos, contas_receber nem clientes direto', () => {
    for (const t of ['recebimentos', 'contas_receber', 'clientes', 'creditos_cliente']) {
      assert.doesNotMatch(CODIGO, new RegExp(`from\('${t}'\)`))
    }
  })

  test('o lote_id é ESTAVEL entre tentativas', () => {
    // Gerar um id novo a cada clique seria pior que nada: o reenvio viraria
    // outro lote e gravaria tudo de novo. Em useRef, ele vive enquanto o
    // modal estiver aberto.
    assert.match(CODIGO, /const loteRef = useRef<string>\(crypto\.randomUUID\(\)\)/)
    assert.match(CODIGO, /lote_id: loteRef\.current/)
    assert.doesNotMatch(CODIGO, /lote_id:\s*crypto\.randomUUID\(\)/)
  })

  test('a trava sincrona contra clique duplo continua', () => {
    assert.match(CODIGO, /if \(enviandoRef\.current\) return/)
    assert.match(CODIGO, /enviandoRef\.current = false/)
  })

  test('estado diferente de aplicado vira erro na tela, nao sucesso', () => {
    assert.match(CODIGO, /res\.estado !== 'aplicado'/)
    assert.match(CODIGO, /setErro\(res\.motivo/)
  })
})
