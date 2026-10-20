import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  permitido, pedirRelatorio, listarRelatorios, baixarRelatorio,
  nomeDoArquivo, resumir, RecusadoPelaTrava, buscarPagamento, resumoDoPagamento,
  type Buscador,
} from '../../src/lib/financeiro/mercadoPagoRelatorio'

// A TRAVA QUE IMPEDE ESTE MÓDULO DE MOVER DINHEIRO.
//
// O token do Mercado Pago é a chave da conta: com ele dá para estornar
// pagamento, criar saque e transferir saldo. O dono da loja fixou a regra no
// começo do projeto — "nada que eu construir deve poder movimentar dinheiro no
// MP" —, e estes testes são o que transforma a regra em fato verificável.
//
// A diferença entre "eu não vou chamar esses endpoints" e "este módulo não
// consegue chamar esses endpoints" é a única que continua valendo depois que
// alguém mexer no arquivo.

function buscadorFalso(respostas: Record<string, { status: number; corpo: string }>) {
  const chamadas: { url: string; metodo: string; temBearer: boolean }[] = []
  const buscar: Buscador = async (url, init) => {
    chamadas.push({
      url,
      metodo: init?.method ?? 'GET',
      temBearer: String(init?.headers?.Authorization ?? '').startsWith('Bearer '),
    })
    const r = respostas[url] ?? { status: 404, corpo: 'nao encontrado' }
    return { ok: r.status < 400, status: r.status, text: async () => r.corpo }
  }
  return { buscar, chamadas }
}

describe('a lista de caminhos permitidos', () => {
  test('deixa passar os três passos do relatório', () => {
    assert.ok(permitido('POST', '/v1/account/release_report'))
    assert.ok(permitido('GET', '/v1/account/release_report/list'))
    assert.ok(permitido('GET', '/v1/account/release_report/arquivo-2026-10.csv'))
  })

  test('deixa passar LER um pagamento, acrescentado em 19/10/2026', () => {
    // Para descobrir PARA QUEM foram as 231 saidas da conta — R$ 29.421 em 30
    // dias, das quais uma unica esta lancada em Contas a Pagar. O relatorio
    // traz data, valor e id, mas nao o nome.
    assert.ok(permitido('GET', '/v1/payments/184959657662'))
  })

  test('mas RECUSA estorno de pagamento, que e o vizinho de porta', () => {
    // O caminho de leitura e `/v1/payments/:id`. Um `/refunds` no fim muda
    // tudo: deixa de ser ler e passa a ser devolver dinheiro. A ancora `$` na
    // expressao e o que separa os dois.
    assert.equal(permitido('POST', '/v1/payments/123/refunds'), false)
    assert.equal(permitido('GET', '/v1/payments/123/refunds'), false)
  })

  test('RECUSA criar pagamento, que e o mesmo caminho com outro metodo', () => {
    assert.equal(permitido('POST', '/v1/payments'), false)
    assert.equal(permitido('POST', '/v1/payments/123'), false)
  })

  test('RECUSA id que nao seja numero', () => {
    // So digitos. Qualquer outra coisa ali e tentativa de sair deste endpoint.
    assert.equal(permitido('GET', '/v1/payments/abc'), false)
    assert.equal(permitido('GET', '/v1/payments/123?x=1'), false)
    assert.equal(permitido('GET', '/v1/payments/..'), false)
  })

  test('RECUSA criar saque', () => {
    assert.equal(permitido('POST', '/v1/account/withdrawals'), false)
    assert.equal(permitido('POST', '/v1/withdrawals'), false)
  })

  test('RECUSA mover saldo e criar pagamento', () => {
    assert.equal(permitido('POST', '/v1/money_transfers'), false)
    assert.equal(permitido('POST', '/v1/payments'), false)
    assert.equal(permitido('POST', '/v1/orders'), false)
  })

  test('RECUSA POST onde só GET é permitido', () => {
    // A listagem é leitura. Se a documentação mudar e alguém trocar o método,
    // a trava obriga a passar pela lista.
    assert.equal(permitido('POST', '/v1/account/release_report/list'), false)
  })

  test('RECUSA travessia de caminho', () => {
    // Sem as âncoras e sem esta checagem, `..` sairia do relatório e chegaria
    // em qualquer endpoint da API.
    assert.equal(permitido('GET', '/v1/account/release_report/../../payments/1/refunds'), false)
    assert.equal(permitido('GET', '/v1/account/release_report/..%2Fpayments'), false)
  })

  test('RECUSA nome de arquivo com barra ou query', () => {
    assert.equal(permitido('GET', '/v1/account/release_report/a/b'), false)
    assert.equal(permitido('GET', '/v1/account/release_report/a.csv?x=1'), false)
  })

  test('e DELETE e PUT não existem aqui', () => {
    assert.equal(permitido('DELETE' as any, '/v1/account/release_report/schedule'), false)
    assert.equal(permitido('PUT' as any, '/v1/account/release_report/config'), false)
  })
})

describe('baixar o arquivo', () => {
  test('nome com barra é recusado antes de virar requisição', async () => {
    const { buscar, chamadas } = buscadorFalso({})
    await assert.rejects(
      () => baixarRelatorio('../../payments/1/refunds', { token: 't', buscar }),
      RecusadoPelaTrava,
    )
    // O ponto do teste: NENHUMA requisição saiu.
    assert.equal(chamadas.length, 0)
  })

  test('nome válido baixa e manda o Bearer', async () => {
    const url = 'https://api.mercadopago.com/v1/account/release_report/rel.csv'
    const { buscar, chamadas } = buscadorFalso({ [url]: { status: 200, corpo: 'DATE;SOURCE_ID' } })
    const csv = await baixarRelatorio('rel.csv', { token: 'tok', buscar })
    assert.equal(csv, 'DATE;SOURCE_ID')
    assert.equal(chamadas[0].metodo, 'GET')
    assert.equal(chamadas[0].temBearer, true)
  })
})

describe('pedir o relatório', () => {
  const url = 'https://api.mercadopago.com/v1/account/release_report'

  test('202 é sucesso: o arquivo vem depois', async () => {
    const { buscar } = buscadorFalso({ [url]: { status: 202, corpo: '{}' } })
    const r = await pedirRelatorio('2026-10-20', '2026-10-20', { token: 't', buscar })
    assert.equal(r.aceito, true)
  })

  test('203 NÃO é sucesso, e isso é a pegadinha da API', async () => {
    // 203 quer dizer "não criei o relatório, pede com outras datas". Tratar
    // como sucesso deixaria o importador esperando para sempre um arquivo que
    // nunca vem.
    const { buscar } = buscadorFalso({
      [url]: { status: 203, corpo: '{"message":"use 2026-10-01 a 2026-10-31"}' },
    })
    const r = await pedirRelatorio('2026-10-20', '2026-10-20', { token: 't', buscar })
    assert.equal(r.aceito, false)
    assert.match(r.mensagem, /recusou o periodo/)
  })

  test('manda as datas com hora, como a API exige', async () => {
    const { buscar, chamadas } = buscadorFalso({ [url]: { status: 202, corpo: '{}' } })
    await pedirRelatorio('2026-10-20', '2026-10-21', { token: 't', buscar })
    assert.equal(chamadas[0].metodo, 'POST')
  })

  test('sem token, nem tenta', async () => {
    const { buscar, chamadas } = buscadorFalso({})
    await assert.rejects(() => pedirRelatorio('2026-10-20', '2026-10-20', { token: '', buscar }))
    assert.equal(chamadas.length, 0)
  })
})

describe('achar o nome do arquivo na listagem', () => {
  test('procura nos campos plausíveis, porque a doc não diz qual é', () => {
    assert.equal(nomeDoArquivo({ file_name: 'a.csv' }), 'a.csv')
    assert.equal(nomeDoArquivo({ fileName: 'b.csv' }), 'b.csv')
    assert.equal(nomeDoArquivo({ report_id: 'c' }), 'c')
  })

  test('e devolve vazio em vez de chutar', () => {
    // Chutar o campo faria o passo 3 pedir um arquivo inexistente, e o
    // importador culparia o Mercado Pago por um erro nosso.
    assert.equal(nomeDoArquivo({ qualquer: 1 }), '')
    assert.equal(nomeDoArquivo(null), '')
  })

  test('a listagem aceita array solto e objeto com results', async () => {
    const url = 'https://api.mercadopago.com/v1/account/release_report/list'
    const a = buscadorFalso({ [url]: { status: 200, corpo: '[{"file_name":"x.csv","status":"processed"}]' } })
    assert.equal((await listarRelatorios({ token: 't', buscar: a.buscar }))[0].nomeArquivo, 'x.csv')

    const b = buscadorFalso({ [url]: { status: 200, corpo: '{"results":[{"file_name":"y.csv"}]}' } })
    assert.equal((await listarRelatorios({ token: 't', buscar: b.buscar }))[0].nomeArquivo, 'y.csv')
  })

  test('item sem nome é descartado, não vira string vazia na lista', async () => {
    const url = 'https://api.mercadopago.com/v1/account/release_report/list'
    const { buscar } = buscadorFalso({
      [url]: { status: 200, corpo: '[{"file_name":"x.csv"},{"nada":1}]' },
    })
    const r = await listarRelatorios({ token: 't', buscar })
    assert.equal(r.length, 1)
  })
})

describe('ler um pagamento', () => {
  test('id com barra é recusado antes de virar requisição', async () => {
    const { buscar, chamadas } = buscadorFalso({})
    await assert.rejects(
      () => buscarPagamento('123/refunds', { token: 't', buscar }),
      RecusadoPelaTrava,
    )
    assert.equal(chamadas.length, 0, 'nenhuma requisicao saiu')
  })

  test('id válido chama o GET certo', async () => {
    const url = 'https://api.mercadopago.com/v1/payments/184959657662'
    const { buscar, chamadas } = buscadorFalso({
      [url]: { status: 200, corpo: '{"id":184959657662,"description":"Posto Ipiranga","transaction_amount":200.5}' },
    })
    const p = await buscarPagamento('184959657662', { token: 't', buscar })
    assert.equal(chamadas[0].metodo, 'GET')
    assert.equal(p.description, 'Posto Ipiranga')
  })

  test('o resumo diz o que CHEGOU, em vez de supor', () => {
    // A forma da resposta ainda não foi vista. `camposPresentes` é o mapa
    // para ajustar o resto depois da primeira olhada — hoje já aconteceu três
    // vezes de o dado real contradizer o que a documentação sugeria.
    const r = resumoDoPagamento({
      id: 1, description: 'Posto Ipiranga', transaction_amount: 200.5,
      operation_type: 'money_transfer', collector: { nickname: 'POSTOIPIRANGA' },
    })
    assert.equal(r.descricao, 'Posto Ipiranga')
    assert.equal(r.recebedor, 'POSTOIPIRANGA')
    assert.equal(r.valor, 200.5)
    assert.deepEqual(r.camposPresentes,
      ['collector', 'description', 'id', 'operation_type', 'transaction_amount'])
  })

  test('resposta vazia não quebra o resumo', () => {
    const r = resumoDoPagamento(null)
    assert.equal(r.recebedor, null)
    assert.deepEqual(r.camposPresentes, [])
  })
})

describe('a mensagem de erro não vaza o token', () => {
  test('token de produção é omitido', () => {
    // Mensagem de erro vai para log, e log é lido por gente.
    const r = resumir('erro: APP_USR-1234567890-abcdef-xyz invalido')
    assert.ok(!r.includes('APP_USR-1234567890'))
    assert.match(r, /\[token omitido\]/)
  })

  test('token de teste também', () => {
    const r = resumir('TEST-99887766-aaaa')
    assert.ok(!r.includes('99887766'))
  })

  test('access_token em json também', () => {
    const r = resumir('{"access_token":"segredo-aqui"}')
    assert.ok(!r.includes('segredo-aqui'))
  })

  test('e o texto é cortado', () => {
    assert.ok(resumir('x'.repeat(5000)).length <= 300)
  })
})
