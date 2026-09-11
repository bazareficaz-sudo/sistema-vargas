import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// FASE 0.6C.6A.1 — A ORDEM DOS TRIGGERS É POR NOME, E ISSO É FRÁGIL.
//
// `b_trg_venda_exige_arbitragem` protege a venda de orçamento contra
// `trg_bloquear_venda_duplicada`, que devolve NULL e descarta um INSERT em
// silêncio. As duas coisas disparam BEFORE INSERT na mesma tabela, e o
// Postgres não tem prioridade explícita para isso — decide por ordem
// alfabética do NOME do trigger. Funciona, e foi medido em produção (ver
// FASE-0.6C6A1-PORTAO-DA-VENDA-DE-ORCAMENTO.md, seção 4), mas é frágil: uma
// migration futura que crie um trigger BEFORE INSERT em `vendas` com nome que
// ordene antes de `b_trg_venda_exige_arbitragem` reabriria o buraco sem que
// ninguém precisasse tocar na função da arbitragem.
//
// Este teste não substitui a medição em produção — substitui a CONFIANÇA de
// que ela continua válida. Ele varre as migrations rastreadas neste repositório
// e falha se:
//
//   1. o trigger da arbitragem não existir, ou não for BEFORE INSERT;
//   2. a função da arbitragem contiver um RETURN NULL de descarte — ela só
//      pode terminar em RETURN NEW ou RAISE EXCEPTION;
//   3. QUALQUER outro trigger BEFORE INSERT em `vendas`, cuja função devolva
//      NULL como desfecho (o padrão de "descartar em silêncio"), ordene
//      alfabeticamente ANTES do nosso.
//
// LIMITE HONESTO: `trg_bloquear_venda_duplicada` foi criado fora das
// migrations rastreadas por este repositório (antecede esta pasta). O item 3
// não o encontra automaticamente — por isso ele está listado explicitamente
// abaixo, hardcoded, com a ordem confirmada na auditoria em produção. Se esse
// trigger for recriado por uma migration futura, ele passa a ser pego pelo
// item 3 também; até lá, a checagem explícita é o que sustenta a garantia.

const DIR_MIGRATIONS = resolve(import.meta.dirname, '../../supabase/migrations')
const ARQUIVOS = readdirSync(DIR_MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
const TODAS_AS_MIGRATIONS = ARQUIVOS
  .map(f => ({ arquivo: f, sql: readFileSync(resolve(DIR_MIGRATIONS, f), 'utf8') }))

const NOSSO_TRIGGER = 'b_trg_venda_exige_arbitragem'
const NOSSA_MIGRATION = TODAS_AS_MIGRATIONS.find(m => m.sql.includes(NOSSO_TRIGGER))

// Conhecido por auditoria em produção (consulta direta a pg_trigger/pg_proc),
// não por uma migration rastreada — ver o limite honesto acima.
const TRIGGER_LEGADO_QUE_DESCARTA_EM_SILENCIO = 'trg_bloquear_venda_duplicada'

describe('a arbitragem do orçamento não pode ser contornada pela ordem dos triggers', () => {
  test('o trigger da arbitragem existe numa migration rastreada', () => {
    assert.ok(NOSSA_MIGRATION, `${NOSSO_TRIGGER} não foi encontrado em nenhuma migration`)
  })

  test('é BEFORE INSERT OR UPDATE em vendas — não AFTER, não STATEMENT', () => {
    const m = new RegExp(
      `CREATE TRIGGER\\s+${NOSSO_TRIGGER}\\s+BEFORE\\s+INSERT\\s+OR\\s+UPDATE[^;]*ON\\s+public\\.vendas`,
      'i',
    ).exec(NOSSA_MIGRATION!.sql)
    assert.ok(m, 'o trigger precisa ser BEFORE INSERT OR UPDATE ON public.vendas')
  })

  test('a função da arbitragem nunca descarta em silêncio — só RETURN NEW ou RAISE', () => {
    const corpo = NOSSA_MIGRATION!.sql.slice(
      NOSSA_MIGRATION!.sql.indexOf('FUNCTION public.exigir_arbitragem_do_orcamento'),
      NOSSA_MIGRATION!.sql.indexOf('COMMENT ON FUNCTION public.exigir_arbitragem_do_orcamento'),
    )
    assert.ok(!/RETURN\s+NULL\s*;/i.test(corpo),
      'um RETURN NULL aqui descartaria a venda perdedora em silêncio — o cliente precisa do erro para marcar o conflito')
    assert.match(corpo, /RAISE EXCEPTION/i)
    assert.match(corpo, /RETURN NEW;/i)
  })

  test('NOME: ordena antes do trigger legado que devolve NULL', () => {
    // A garantia inteira depende deste fato puramente lexicográfico. Falha
    // aqui = a proteção para de valer em produção, mesmo sem ninguém ter
    // tocado na função da arbitragem.
    assert.ok(
      NOSSO_TRIGGER < TRIGGER_LEGADO_QUE_DESCARTA_EM_SILENCIO,
      `'${NOSSO_TRIGGER}' precisa ordenar antes de '${TRIGGER_LEGADO_QUE_DESCARTA_EM_SILENCIO}'`,
    )
  })

  test('NENHUMA migration rastreada cria, antes do nosso, um trigger BEFORE INSERT em vendas que devolva NULL', () => {
    // Varredura geral: para qualquer CREATE TRIGGER ... ON vendas (BEFORE
    // INSERT) cuja função EXECUTE aponte para algo que devolve NULL, o nome
    // dele tem que vir DEPOIS do nosso. Isto é o que pega uma migration FUTURA
    // que reintroduza o padrão de descarte silencioso, mesmo sem o autor saber
    // do nosso trigger.
    const suspeitos: string[] = []

    for (const { sql } of TODAS_AS_MIGRATIONS) {
      const triggers = [...sql.matchAll(
        /CREATE TRIGGER\s+(\w+)\s+BEFORE\s+INSERT[^;]*ON\s+public\.vendas[^;]*EXECUTE FUNCTION\s+public\.(\w+)/gi,
      )]
      for (const [, nomeTrigger, nomeFuncao] of triggers) {
        if (nomeTrigger === NOSSO_TRIGGER) continue
        // Acha a definição da função em QUALQUER migration (pode não estar na
        // mesma que criou o trigger).
        const defs = TODAS_AS_MIGRATIONS
          .map(m => m.sql)
          .filter(s => new RegExp(`FUNCTION public\\.${nomeFuncao}\\s*\\(`, 'i').test(s))
        const descarta = defs.some(s => {
          const inicio = s.search(new RegExp(`FUNCTION public\\.${nomeFuncao}\\s*\\(`, 'i'))
          const trecho = s.slice(inicio, inicio + 3000)
          return /RETURN\s+NULL\s*;/i.test(trecho)
        })
        if (descarta) suspeitos.push(nomeTrigger)
      }
    }

    for (const nome of suspeitos) {
      assert.ok(NOSSO_TRIGGER < nome,
        `trigger '${nome}' descarta em silêncio e precisa ordenar DEPOIS de '${NOSSO_TRIGGER}'`)
    }
  })
})
