import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// FASE 4C.2 — CHECKPOINT 3, PARTE A.
//
// O servidor passa a entender pagamentos. O que estes testes travam é a
// propriedade que torna isso seguro: um payload v1 percorre o MESMO caminho
// de antes, e ganhar composição de pagamentos nunca transforma uma venda já
// aplicada em conflito.
//
// Migration aplicada em 09/10/2026, version 20261009003002. A máquina de
// estados foi exercitada contra a RPC real em transação revertida; estes
// testes guardam o conteúdo do arquivo contra regressão.

const raiz = path.resolve(__dirname, '..', '..')
const SQL_BRUTO = fs.readFileSync(
  path.join(raiz, 'supabase/migrations/20261009003002_venda_pagamentos_v2_protocolo.sql'), 'utf8')

// Comentários explicam o defeito e a regra; asserção não pode casar com a
// explicação, só com o código.
const SQL = SQL_BRUTO.replace(/--[^\n]*/g, '')

describe('os dois fingerprints ficam separados', () => {
  test('cria a funcao do fingerprint de pagamentos', () => {
    assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.venda_pagamentos_fingerprint_v2/)
    assert.match(SQL, /'pg2'/)
  })

  test('ele cobre id, forma, valor, entregue, troco e sequencia', () => {
    const f = SQL.slice(SQL.indexOf('venda_pagamentos_fingerprint_v2'))
    for (const campo of ['id', 'forma', 'valor', 'valor_entregue', 'troco', 'sequencia']) {
      assert.match(f, new RegExp(`'${campo}'`))
    }
  })

  test('ordena por id — a ordem do array nao pode mudar o hash', () => {
    assert.match(SQL, /ORDER BY lower\(coalesce\(p->>'id',''\)\)/)
  })

  test('venda_fingerprint_v1 NAO é redefinido', () => {
    // Se os pagamentos entrassem no fingerprint-base, toda venda já aplicada
    // em v1 viraria conflito ao ganhar composição. É o erro central a evitar.
    assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\.venda_fingerprint_v1/)
  })

  test('a coluna é nullable, e é isso que distingue v1 de v2', () => {
    assert.match(SQL, /ALTER TABLE pdv_venda_sync ADD COLUMN IF NOT EXISTS fingerprint_pagamentos TEXT/)
    assert.doesNotMatch(SQL, /fingerprint_pagamentos TEXT NOT NULL/)
  })
})

describe('retrocompatibilidade: v1 nao muda', () => {
  test('aceita 1 e 2, e so', () => {
    assert.match(SQL, /v_versao NOT IN \(1, 2\)/)
  })

  test('v1 com pagamentos é recusado — nao ha caminho hibrido', () => {
    assert.match(SQL, /v_versao = 1 AND v_tem_pag/)
  })

  test('conflito_payload continua intacto para base divergente', () => {
    assert.match(SQL, /v_reg\.fingerprint IS DISTINCT FROM v_fingerprint/)
    assert.match(SQL, /'estado','conflito_payload'/)
  })

  test('v1 sobre v1 continua devolvendo ja_aplicada', () => {
    assert.match(SQL, /IF NOT v_tem_pag THEN[\s\S]{0,400}'estado','ja_aplicada'/)
  })
})

describe('completada_v2 complementa, nunca reaplica', () => {
  // O ramo vai do fim do bloco `IF NOT v_tem_pag` ate o RETURN de
  // completada_v2. Ancorar no proprio texto 'completada_v2' nao serve: sem
  // comentarios, a primeira ocorrencia JA é o RETURN, e o recorte sairia
  // vazio — fazendo as asercoes de ausencia passarem sem olhar nada.
  const fim = SQL.indexOf("'estado','completada_v2'")
  const ramo = SQL.slice(SQL.lastIndexOf('END IF;', fim), fim)

  test('o recorte do ramo nao é vazio', () => {
    assert.ok(ramo.length > 200, `ramo tem ${ramo.length} chars — asercoes de ausencia seriam vazias`)
  })

  test('insere pagamento', () => {
    assert.match(ramo, /INSERT INTO venda_pagamento/)
  })

  test('NAO toca a venda, os itens nem o estoque', () => {
    for (const proibido of [
      /UPDATE vendas\b/i, /INSERT INTO venda_itens/i,
      /UPDATE produtos/i, /produto_estoque/i, /estoque_movimentacoes/i,
      /INSERT INTO pdv_venda_sync/i,
    ]) assert.doesNotMatch(ramo, proibido)
  })

  test('na linha de sync mexe SO em duas colunas', () => {
    assert.match(ramo, /UPDATE pdv_venda_sync\s*\n?\s*SET fingerprint_pagamentos = v_fp_pag, schema_version = 2/)
    for (const intocavel of [/SET[^;]*\bfingerprint\s*=/, /SET[^;]*\bitens\s*=/,
      /SET[^;]*estoque_aplicado\s*=/, /SET[^;]*aplicado_em\s*=/]) {
      assert.doesNotMatch(ramo, intocavel)
    }
  })
})

describe('identidade do pagamento falha alto, nunca em silencio', () => {
  test('NUNCA ON CONFLICT DO NOTHING em venda_pagamento', () => {
    // Aceitaria em silêncio um pagamento com o mesmo id e valor diferente —
    // exatamente o caso que precisa falhar.
    const trechos = SQL.split('INSERT INTO venda_pagamento').slice(1)
    assert.ok(trechos.length >= 2, 'ha dois caminhos de insercao')
    for (const t of trechos) {
      assert.doesNotMatch(t.slice(0, 600), /ON CONFLICT/i)
    }
  })

  test('id repetido com conteudo diferente vira conflito_pagamentos', () => {
    assert.match(SQL, /'estado','conflito_pagamentos'[\s\S]{0,200}mesmo id ja existe com conteudo diferente/)
  })

  test('composicao diferente da registrada vira conflito_pagamentos', () => {
    assert.match(SQL, /v_reg\.fingerprint_pagamentos IS DISTINCT FROM v_fp_pag/)
  })
})

describe('invariantes monetarias e a carteira', () => {
  test('a soma confere em centavos inteiros, nao em float', () => {
    assert.match(SQL, /round\(v_soma \* 100\) <> round\(coalesce\(\(p_payload->>'total'\)::numeric,0\) \* 100\)/)
  })

  test('valor nao positivo é recusado', () => {
    assert.match(SQL, /valor'\)::numeric, 0\) <= 0/)
  })

  test('CARTEIRA em v2 é RECUSADA ate o gatilho existir', () => {
    // criar_conta_carteira dispara no INSERT da venda lendo NEW.pagamentos,
    // e em v2 os pagamentos chegam depois. Aceitar criaria venda em carteira
    // sem conta a receber — perda financeira silenciosa.
    assert.match(SQL, /v_pag->>'forma' = 'carteira'/)
    assert.match(SQL, /'estado','payload_invalido'[\s\S]{0,200}carteira ainda nao suportado em v2/)
  })
})

describe('o que a migration NAO faz', () => {
  test('nenhum backfill', () => {
    assert.doesNotMatch(SQL, /INSERT INTO venda_pagamento\s*\([^)]*\)\s*SELECT/i)
    assert.doesNotMatch(SQL, /UPDATE pdv_venda_sync\s+SET[^;]*WHERE\s+fingerprint_pagamentos\s+IS\s+NULL/i)
  })

  test('nao encosta no ledger do Caixa', () => {
    for (const proibido of [/caixa_movimento/i, /caixa_sessao/i, /caixa_transferencia/i]) {
      assert.doesNotMatch(SQL, proibido)
    }
  })

  test('nao mexe em contas_receber nem recebimentos', () => {
    for (const proibido of [/contas_receber/i, /recebimentos/i, /saldo_devedor/i]) {
      assert.doesNotMatch(SQL, proibido)
    }
  })
})
