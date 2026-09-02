import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dataISO, intervaloUTC, rotuloPeriodo, MAX_LINHAS } from '../../src/lib/ia/consultas/tipos'
import { CONSULTAS_VENDAS } from '../../src/lib/ia/consultas/vendas'

// O caso que motivou tudo, em 02/09/2026: "teve venda do produto 24150
// ontem?" recebeu "não tenho esse dado". O banco tinha — 2 vendas, 3
// unidades, R$ 7,50. O que faltava era o modelo poder PEDIR.

describe('data recusa em vez de adivinhar', () => {
  test('aceita AAAA-MM-DD', () => {
    assert.equal(dataISO('2026-09-01'), '2026-09-01')
  })

  test('recusa data relativa', () => {
    // Se "ontem" virasse hoje por conveniência, a resposta sairia sobre o dia
    // errado e ninguém saberia. Recusar força o modelo a converter.
    assert.equal(dataISO('ontem'), null)
    assert.equal(dataISO('01/09/2026'), null)
    assert.equal(dataISO(''), null)
    assert.equal(dataISO(null), null)
  })

  test('recusa formato quase certo', () => {
    assert.equal(dataISO('2026-9-1'), null)
    assert.equal(dataISO('2026-09-01T10:00:00Z'), null)
  })
})

describe('o intervalo cobre o dia inteiro em São Paulo', () => {
  test('um dia começa às 03:00 UTC e termina às 02:59 do dia seguinte', () => {
    // `created_at` é timestamptz. Comparar com a data pura erraria as três
    // primeiras horas: 01/09 23:00 em São Paulo já é 02/09 02:00 UTC.
    const { inicio, fim } = intervaloUTC('2026-09-01', '2026-09-01')
    assert.equal(inicio, '2026-09-01T03:00:00.000Z')
    assert.equal(fim, '2026-09-02T02:59:59.999Z')
  })

  test('intervalo de vários dias', () => {
    const { inicio, fim } = intervaloUTC('2026-08-01', '2026-08-31')
    assert.equal(inicio, '2026-08-01T03:00:00.000Z')
    assert.equal(fim, '2026-09-01T02:59:59.999Z')
  })
})

describe('o período volta escrito, para o modelo repetir', () => {
  test('um dia só', () => {
    assert.equal(rotuloPeriodo('2026-09-01', '2026-09-01'), 'em 01/09/2026')
  })
  test('intervalo', () => {
    assert.equal(rotuloPeriodo('2026-08-01', '2026-08-31'), 'de 01/08/2026 a 31/08/2026')
  })
})

describe('o catálogo é fechado e bem formado', () => {
  test('toda consulta tem nome, descrição e parâmetros', () => {
    for (const c of CONSULTAS_VENDAS) {
      assert.match(c.nome, /^[a-z_]+$/, `nome inválido: ${c.nome}`)
      assert.ok(c.descricao.length > 20, `${c.nome} sem descrição útil`)
      assert.equal(c.parametros.type, 'object')
      assert.equal(typeof c.executar, 'function')
    }
  })

  test('nenhum nome repetido — o modelo escolhe pelo nome', () => {
    const nomes = CONSULTAS_VENDAS.map(c => c.nome)
    assert.equal(new Set(nomes).size, nomes.length)
  })

  test('nenhuma consulta aceita empresa como parâmetro', () => {
    // O `empresaId` vem do servidor e NUNCA do modelo. Se entrasse aqui, uma
    // pergunta bem escrita alcançaria o dado de outra empresa.
    for (const c of CONSULTAS_VENDAS) {
      const chaves = Object.keys(c.parametros.properties).join(' ').toLowerCase()
      assert.doesNotMatch(chaves, /empresa|tenant|company/, `${c.nome} expõe a empresa`)
    }
  })

  test('nenhuma consulta aceita SQL ou tabela como parâmetro', () => {
    for (const c of CONSULTAS_VENDAS) {
      const chaves = Object.keys(c.parametros.properties).join(' ').toLowerCase()
      assert.doesNotMatch(chaves, /sql|query|tabela|table|where|select/, `${c.nome} aceita consulta livre`)
    }
  })

  test('as que dependem de período exigem `de` e `ate`', () => {
    for (const c of CONSULTAS_VENDAS) {
      if (!('de' in c.parametros.properties)) continue
      assert.ok(c.parametros.required?.includes('de'), `${c.nome} não exige de`)
      assert.ok(c.parametros.required?.includes('ate'), `${c.nome} não exige ate`)
    }
  })

  test('a consulta que responde a pergunta do dia existe', () => {
    const c = CONSULTAS_VENDAS.find(x => x.nome === 'vendas_de_um_produto')
    assert.ok(c, 'sem ela, "teve venda do produto X?" volta a ser irrespondível')
    assert.ok(c!.parametros.required?.includes('termo'))
  })
})

describe('período inválido volta como recusa, não como exceção', () => {
  const sbFalso = {
    from() {
      throw new Error('o banco NÃO pode ser consultado com período inválido')
    },
  }

  test('data ausente não chega ao banco', async () => {
    for (const c of CONSULTAS_VENDAS) {
      const r = await c.executar(sbFalso, 'empresa-1', {})
      assert.equal(r.linhas.length, 0)
      assert.ok(r.ressalvas?.[0], `${c.nome} recusou sem dizer por quê`)
    }
  })

  test('data inicial depois da final é recusada', async () => {
    const c = CONSULTAS_VENDAS[0]
    const r = await c.executar(sbFalso, 'empresa-1', { de: '2026-09-10', ate: '2026-09-01' })
    assert.match(r.ressalvas?.[0] ?? '', /posterior/i)
  })

  test('data relativa é recusada com instrução de formato', async () => {
    const c = CONSULTAS_VENDAS[0]
    const r = await c.executar(sbFalso, 'empresa-1', { de: 'ontem', ate: 'hoje' })
    assert.match(r.ressalvas?.[0] ?? '', /AAAA-MM-DD/)
  })
})

describe('limite de linhas', () => {
  test('existe e é modesto — resultado gigante vira prompt gigante', () => {
    assert.ok(MAX_LINHAS > 0 && MAX_LINHAS <= 100)
  })
})
