import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { decidirAcesso } from '../../src/lib/pdv/decidirAcesso'

// FASE 0.6D.3B — A RECUSA QUE AUTORIZA FALLBACK PRECISA SER PRE-WRITE.
//
// O Electron só pode voltar ao caminho legado depois de uma tentativa v1 em
// DOIS casos: `rota_desligada` e `sem_identidade`. A regra que torna isso
// seguro não é a mensagem — é o MOMENTO: nenhuma das duas pode ocorrer
// depois de a venda ter produzido qualquer efeito remoto.
//
// Se um dia `operacaoProtegida` passar a reservar a chave de idempotência,
// chamar a RPC ou gravar qualquer coisa ANTES de recusar por flag, o
// fallback vira duplicata: o servidor teria escrito, e o terminal mandaria
// tudo de novo pelo legado.
//
// Estes testes existem para quebrar nesse dia.

const raiz = path.join(__dirname, '..', '..')
const OPERACAO = fs.readFileSync(path.join(raiz, 'src', 'lib', 'pdv', 'operacaoProtegida.ts'), 'utf8')

describe('rota_desligada é decidida antes de qualquer escrita', () => {
  test('decidirAcesso recusa por flag sem tocar em banco nenhum', () => {
    // A decisão é pura: recebe claims e a linha do terminal, devolve veredito.
    const r = decidirAcesso({
      claims: {
        sub: 'a3c2f27c-c6b5-4a8b-885c-9f918c0d9181',
        terminal_id: 'a3c2f27c-c6b5-4a8b-885c-9f918c0d9181',
        empresa_id: 'a1000000-0000-0000-0000-000000000001',
        tenant_id: null, tipo: 'pdv_terminal', iat: 0, exp: 9_999_999_999,
      },
      terminal: {
        id: 'a3c2f27c-c6b5-4a8b-885c-9f918c0d9181',
        empresa_id: 'a1000000-0000-0000-0000-000000000001',
        status: 'ativo', nome: 'YOGA', versao_pdv: '1.10.4',
        usar_rotas_novas: true,
        rotas_habilitadas: { orcamentos: true },   // v1 NÃO habilitada
      },
      tenantId: null, empresaAtiva: true, exigirFlag: true,
      operacao: 'vendas_transacional_v1',
    })

    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.motivo, 'rota_desligada')
    assert.equal(r.status, 409, '409, não 5xx: o PDV precisa distinguir "não ligada" de "deu erro"')
  })

  test('com a flag ligada, o acesso passa', () => {
    const r = decidirAcesso({
      claims: {
        sub: 'a3c2f27c-c6b5-4a8b-885c-9f918c0d9181',
        terminal_id: 'a3c2f27c-c6b5-4a8b-885c-9f918c0d9181',
        empresa_id: 'a1000000-0000-0000-0000-000000000001',
        tenant_id: null, tipo: 'pdv_terminal', iat: 0, exp: 9_999_999_999,
      },
      terminal: {
        id: 'a3c2f27c-c6b5-4a8b-885c-9f918c0d9181',
        empresa_id: 'a1000000-0000-0000-0000-000000000001',
        status: 'ativo', nome: 'YOGA', versao_pdv: '1.10.4',
        usar_rotas_novas: true,
        rotas_habilitadas: { vendas_transacional_v1: true },
      },
      tenantId: null, empresaAtiva: true, exigirFlag: true,
      operacao: 'vendas_transacional_v1',
    })
    assert.equal(r.ok, true)
  })
})

describe('A ORDEM em operacaoProtegida — a garantia estrutural', () => {
  const pos = (trecho: string) => {
    const i = OPERACAO.indexOf(trecho)
    assert.notEqual(i, -1, `"${trecho}" sumiu de operacaoProtegida.ts`)
    return i
  }

  test('a recusa de acesso RETORNA antes do admin client', () => {
    assert.ok(pos('if (!acesso.ok) return respostaDeRecusa(acesso)') < pos('createAdminClient()'),
      'recusar depois de criar o client admin abriria espaço para escrita antes da recusa')
  })

  test('a recusa RETORNA antes de reservar a chave de idempotência', () => {
    assert.ok(pos('if (!acesso.ok) return respostaDeRecusa(acesso)') < pos("from('pdv_operacoes').insert"),
      'reservar a chave é a PRIMEIRA escrita da rota — recusar tem de vir antes')
  })

  test('a recusa RETORNA antes de executar o corpo da operação (a RPC)', () => {
    assert.ok(pos('if (!acesso.ok) return respostaDeRecusa(acesso)') < pos('opts.executar(ctx)'),
      'se `executar` rodasse antes, a RPC poderia commitar e ainda assim devolver rota_desligada — '
      + 'e o terminal cairia no legado sobre uma venda já gravada');
  })

  test('autenticar é a PRIMEIRA coisa da função', () => {
    // Antes dela não pode haver nada que escreva.
    const antes = OPERACAO.slice(pos('): Promise<Response> {'), pos('autenticarTerminalPdv'))
    assert.equal(/\.insert\(|\.update\(|\.upsert\(|\.rpc\(|\.delete\(/.test(antes), false,
      'nenhuma escrita pode acontecer antes da autenticação')
  })
})

// `sem_identidade` nasce no Electron, não aqui: `chamarProtegida` obtém o
// token ANTES de montar o request e, sem token, devolve na hora — a
// requisição HTTP não chega a existir, então o servidor não pode ter escrito
// nada. É pre-write por construção. A prova disso mora no repositório do PDV
// (`tests/negociacao-protocolo.test.js`), junto do arquivo que ela verifica —
// ler o outro repo daqui dependeria do caminho do worktree.
