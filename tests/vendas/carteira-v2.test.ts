import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// FASE 4C.2 — CHECKPOINT 3, PARTE B.
//
// A carteira passa a nascer do PAGAMENTO, não da venda. Em v1 a conta vinha
// de `criar_conta_carteira` lendo `NEW.pagamentos` no INSERT da venda; em v2
// os pagamentos chegam depois, e aquele gatilho não veria nada.
//
// O que estes testes travam são as três regras que você fixou: uma venda
// gera UMA conta pelo valor agregado, recalculado da fonte autoritativa; e
// conta já movimentada não é reescrita.

const raiz = path.resolve(__dirname, '..', '..')
const ler = (f: string) => fs.readFileSync(path.join(raiz, 'supabase/migrations', f), 'utf8')
const semComentarios = (s: string) => s.replace(/--[^\n]*/g, '')

const GATILHO = semComentarios(ler('20261009003826_venda_pagamento_carteira_trigger.sql'))
const RPC     = semComentarios(ler('20261009004028_venda_pagamentos_v2_carteira_liberada.sql'))

describe('uma venda, uma conta, pelo valor agregado', () => {
  test('a soma vem de venda_pagamento, nao de incremento', () => {
    // `valor_existente + novo_pagamento` foi o defeito que a 4C.1.1
    // extirpou do saldo devedor. Não volta por aqui.
    assert.match(GATILHO, /sum\(CASE WHEN p\.estorno_de_id IS NULL THEN p\.valor ELSE -p\.valor END\)/)
    assert.match(GATILHO, /FROM venda_pagamento p[\s\S]{0,120}forma = 'carteira'/)
    assert.doesNotMatch(GATILHO, /valor_original\s*=\s*valor_original\s*\+/)
    assert.doesNotMatch(GATILHO, /valor_original\s*\+\s*NEW\.valor/)
  })

  test('estorno entra na conta com sinal negativo', () => {
    assert.match(GATILHO, /ELSE -p\.valor/)
  })

  test('procura a conta por (origem, origem_id) — uma por venda', () => {
    assert.match(GATILHO, /WHERE origem = 'carteira' AND origem_id = NEW\.venda_id/)
  })

  test('NAO cria parcela 2', () => {
    const insert = GATILHO.slice(GATILHO.indexOf('INSERT INTO contas_receber'))
    assert.match(insert.slice(0, 600), /1, 1, /) // parcela_numero=1, total_parcelas=1
    assert.doesNotMatch(GATILHO, /parcela_numero\s*=\s*2/)
    assert.doesNotMatch(GATILHO, /parcela_numero\s*\+\s*1/)
  })
})

describe('conta ja movimentada nao é reescrita', () => {
  test('o gatilho recusa recebida, quitada ou cancelada', () => {
    assert.match(GATILHO, /v_conta\.valor_recebido <> 0 OR v_conta\.status IN \('cancelado', 'recebido'\)/)
    assert.match(GATILHO, /RAISE EXCEPTION/)
  })

  test('a RPC verifica ANTES, e devolve estado terminal', () => {
    // Deixar o gatilho abortar devolveria erro, que o terminal leria como
    // pendente e tentaria para sempre.
    assert.match(RPC, /CREATE OR REPLACE FUNCTION public\.sincronizar_venda_pdv_v1_checar_carteira/)
    assert.match(RPC, /v_chk := sincronizar_venda_pdv_v1_checar_carteira\(v_venda_id, p_payload\)/)
    assert.match(RPC, /IF v_chk IS NOT NULL THEN RETURN v_chk; END IF/)
  })

  test('o estado devolvido é conflito_pagamentos, que o cliente ja conhece', () => {
    // Um estado novo seria lido como desconhecido pelo terminal, que o
    // trataria como pendente — retry infinito.
    const chk = RPC.slice(RPC.indexOf('checar_carteira'), RPC.indexOf('-- 2. A RPC'))
    assert.match(chk, /'estado','conflito_pagamentos'/)
    assert.doesNotMatch(chk, /'estado','conflito_carteira'/)
  })

  test('a verificacao é STABLE — nao escreve nada', () => {
    const chk = RPC.slice(RPC.indexOf('checar_carteira'))
    assert.match(chk.slice(0, 400), /\bSTABLE\b/)
  })
})

describe('o saldo devedor continua sendo projecao', () => {
  test('o gatilho NAO escreve clientes.saldo_devedor', () => {
    // Quem o mantém é z_trg_sincronizar_saldo_devedor, que dispara sozinho
    // na escrita de contas_receber. Escrever aqui seria o segundo escritor
    // que a 4C.1.1 eliminou.
    assert.doesNotMatch(GATILHO, /UPDATE clientes/i)
    assert.doesNotMatch(GATILHO, /saldo_devedor/i)
  })
})

describe('a carteira deixou de ser recusada em v2', () => {
  test('a recusa seca da parte A saiu da RPC', () => {
    assert.doesNotMatch(RPC, /carteira ainda nao suportado em v2/)
  })

  test('mas o resto das validacoes de pagamento ficou', () => {
    assert.match(RPC, /round\(v_soma \* 100\) <> round\(coalesce\(\(p_payload->>'total'\)::numeric,0\) \* 100\)/)
    assert.match(RPC, /v_versao NOT IN \(1, 2\)/)
    assert.match(RPC, /v_versao = 1 AND v_tem_pag/)
  })

  test('conflito_payload continua intacto', () => {
    assert.match(RPC, /v_reg\.fingerprint IS DISTINCT FROM v_fingerprint/)
    assert.match(RPC, /'estado','conflito_payload'/)
  })
})

describe('o que a parte B NAO faz', () => {
  test('nao encosta no ledger do Caixa', () => {
    for (const proibido of [/caixa_movimento/i, /caixa_sessao/i, /caixa_transferencia/i]) {
      assert.doesNotMatch(GATILHO, proibido)
      assert.doesNotMatch(RPC, proibido)
    }
  })

  test('nao escreve recebimentos', () => {
    assert.doesNotMatch(GATILHO, /INSERT INTO recebimentos/i)
    assert.doesNotMatch(GATILHO, /UPDATE recebimentos/i)
  })

  test('nao faz backfill de venda historica', () => {
    assert.doesNotMatch(GATILHO, /INSERT INTO contas_receber[\s\S]{0,200}SELECT/i)
  })

  test('o gatilho legado criar_conta_carteira nao é alterado', () => {
    // Ele continua valendo para o caminho v1/legado, que é como a loja
    // inteira opera hoje.
    assert.doesNotMatch(GATILHO, /CREATE OR REPLACE FUNCTION public\.criar_conta_carteira/)
    assert.doesNotMatch(RPC, /CREATE OR REPLACE FUNCTION public\.criar_conta_carteira/)
  })
})
