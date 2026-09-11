import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// FASE 0.6C.6A — O CONTRATO DA ROTA DE CONVERSÃO.
//
// A rota em si é medida em produção só até onde se pode medir sem credencial:
// sem token ela recusa, e recusa antes de falar com o banco. O resto do
// contrato — terminal revogado, flag desligada, terminal liberado — é decidido
// por `decidirAcesso`, e está provado em `orcamentos.test.ts` ("flag por
// operação") com a MESMA chave de flag que esta rota declara.
//
// O elo entre as duas provas é o que este arquivo fecha: herdar o teste do
// `decidirAcesso` só vale se a rota estiver ligada nele, com a mesma chave.
// Sem isto, "HERDADO" seria suposição.

const ROTA = resolve(import.meta.dirname, '../../src/app/api/pdv/orcamentos/converter/route.ts')
const fonte = readFileSync(ROTA, 'utf8')

describe('a rota recusa antes de tocar no banco', () => {
  // Um segredo LOCAL, só para o verificador ter o que rejeitar. Não assina
  // nada que a produção aceite, e o caminho de sucesso nem chega a ser
  // exercitado aqui: sem service role, o cliente do banco não existe.
  before(() => { process.env.PDV_TOKEN_SECRET = 'x'.repeat(48) })

  const pedido = (headers: Record<string, string> = {}) => new Request(
    'https://x/api/pdv/orcamentos/converter',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        orcamento_id: '1a4ca66e-da57-4736-a24d-2b7780f3fac5',
        venda_id: '11111111-2222-3333-4444-555555555555',
        revisao_base: 3,
      }),
    },
  )

  async function chamar(headers?: Record<string, string>) {
    const { POST } = await import('../../src/app/api/pdv/orcamentos/converter/route')
    const r = await POST(pedido(headers))
    return { status: r.status, corpo: await r.json() as Record<string, unknown> }
  }

  test('SEM CREDENCIAL: 401, e com corpo completo e plausível', async () => {
    // O corpo ser válido é o ponto: a recusa não depende de a entrada estar
    // malformada. Uma requisição perfeita sem token também não passa.
    const r = await chamar()
    assert.equal(r.status, 401)
    assert.equal(r.corpo.motivo, 'sem_token')
    assert.equal(r.corpo.ok, false)
  })

  test('cabeçalho sem Bearer não conta como credencial', async () => {
    const r = await chamar({ authorization: 'abc.def.ghi' })
    assert.equal(r.status, 401)
    assert.equal(r.corpo.motivo, 'sem_token')
  })

  test('Bearer com token forjado: 401 token_invalido', async () => {
    const r = await chamar({ authorization: 'Bearer nao.e.um.jwt.nosso' })
    assert.equal(r.status, 401)
    assert.equal(r.corpo.motivo, 'token_invalido')
  })

  test('a recusa não diz nada sobre o orçamento', async () => {
    // Sem isto, a rota seria um oráculo de existência: quem não tem credencial
    // descobriria quais ids existem pela diferença entre as mensagens.
    const r = await chamar({ authorization: 'Bearer nao.e.um.jwt.nosso' })
    assert.deepEqual(Object.keys(r.corpo).sort(), ['erro', 'motivo', 'ok'])
    assert.ok(!JSON.stringify(r.corpo).includes('1a4ca66e'))
  })

  test('chave de idempotência do cliente não compra acesso', async () => {
    const r = await chamar({ 'idempotency-key': 'qualquer:coisa' })
    assert.equal(r.status, 401)
  })
})

describe('o elo com o que já foi provado', () => {
  test('passa pelo molde protegido, não por um handler próprio', () => {
    assert.match(fonte, /operacaoProtegida\(/)
    assert.ok(!/createClient\(/.test(fonte), 'rota não monta cliente por conta própria')
    assert.ok(!/ANON_KEY/.test(fonte))
  })

  test('DECLARA A MESMA CHAVE DE FLAG que os testes de acesso provam', () => {
    // `orcamentos` é a chave testada em orcamentos.test.ts → "flag por
    // operação": flag de faltas não libera, {} não libera, revogado não passa,
    // empresa divergente não passa. Se esta linha mudar, aquelas provas deixam
    // de valer para esta rota, e este teste cai.
    assert.match(fonte, /flagDaOperacao:\s*'orcamentos'/)
    assert.match(fonte, /operacao:\s*'orcamentos\.converter'/)
  })

  test('A EMPRESA VEM DO CONTEXTO, NUNCA DO CORPO', () => {
    assert.match(fonte, /p_empresa_id:\s*ctx\.empresa_id/)
    assert.ok(!/p_empresa_id:\s*(corpo|body)/.test(fonte))
  })

  test('a chave de idempotência é derivada no servidor e sobrepõe a do cliente', () => {
    // O spread do corpo vem ANTES da chave. Um cliente que mande
    // `idempotency_key` não consegue empurrar a sua.
    const m = /corpoComChave\s*=\s*\{([^}]*)\}/.exec(fonte)
    assert.ok(m, 'a rota monta o corpo com a chave derivada')
    const dentro = m![1]
    assert.ok(dentro.indexOf('...corpo') < dentro.indexOf('idempotency_key'),
      'a chave derivada tem que vir depois do spread, senão a do cliente ganha')
    assert.match(fonte, /\$\{orcamentoId\}:conv:\$\{vendaId\}/)
  })

  test('erro do Postgres vira exceção (500), não um estado inventado', () => {
    // 500 é o que o PDV repete com a MESMA chave. Se um erro transitório
    // virasse `{estado: 'recusado'}`, o PDV marcaria a venda como perdida.
    assert.match(fonte, /if \(error\) throw new Error/)
  })
})

describe('o mapa de HTTP por estado', () => {
  const mapa = (() => {
    const m = /HTTP_POR_ESTADO[^=]*=\s*\{([\s\S]*?)\n\}/.exec(fonte)
    assert.ok(m, 'o mapa está no arquivo')
    const pares: Record<string, number> = {}
    for (const linha of m![1].split('\n')) {
      const p = /^\s*([a-z_]+):\s*(\d+)/.exec(linha)
      if (p) pares[p[1]] = Number(p[2])
    }
    return pares
  })()

  test('sucesso e replay são 200', () => {
    assert.equal(mapa.convertido, 200)
    assert.equal(mapa.ja_convertido, 200)
  })

  test('NENHUM CONFLITO MAPEIA PARA 2xx', () => {
    // Conflito como 2xx seria gravado como sucesso replayável em
    // `pdv_operacoes` e devolvido para sempre na mesma chave.
    for (const estado of ['conflito_conversao', 'conflito_versao', 'recusado_cancelado']) {
      assert.equal(mapa[estado], 409, `${estado} tem que ser 409`)
    }
  })

  test('não encontrado é 404, e o desconhecido cai em 500', () => {
    assert.equal(mapa.nao_encontrado, 404)
    assert.match(fonte, /\?\?\s*500/)
  })

  test('todos os estados que a RPC devolve estão no mapa', () => {
    // A lista é a da função `converter_orcamento_pdv` em produção. Um estado
    // fora do mapa viraria 500 e o PDV repetiria para sempre.
    for (const estado of ['convertido', 'ja_convertido', 'conflito_conversao',
      'conflito_versao', 'recusado_cancelado', 'nao_encontrado']) {
      assert.equal(typeof mapa[estado], 'number', `${estado} não está no mapa`)
    }
  })
})
