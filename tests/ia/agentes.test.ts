import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  agenteUtilizavel, montarInstrucoes, consultasDoAgente, consultasDesconhecidas,
  CATALOGO, AREAS,
} from '../../src/lib/ia/agentes'

const AGENTE = {
  nome: 'Gege', area: 'Estoque',
  instrucoes_base: 'Você cuida do estoque. Sempre diga de quando é o dado.',
}

describe('o recorte do catálogo', () => {
  test('o agente alcança só as consultas cadastradas', () => {
    const c = consultasDoAgente({ consultas: ['estoque_de_um_produto', 'capital_parado'] })
    assert.equal(c.length, 2)
    assert.deepEqual(c.map(x => x.nome).sort(), ['capital_parado', 'estoque_de_um_produto'])
  })

  test('nome inexistente é descartado sem derrubar as outras', () => {
    // Um agente cadastrado com uma consulta que não existe precisa continuar
    // funcionando. Quem cadastrou vê o problema no saas-admin; o cliente não
    // recebe uma resposta estranha.
    const c = consultasDoAgente({ consultas: ['vendas_por_regiao', 'capital_parado'] })
    assert.equal(c.length, 1)
    assert.equal(c[0].nome, 'capital_parado')
  })

  test('os nomes desconhecidos são reportados, para a tela avisar', () => {
    assert.deepEqual(consultasDesconhecidas({ consultas: ['nao_existe', 'capital_parado'] }), ['nao_existe'])
  })

  test('toda consulta que as áreas anunciam existe de verdade', () => {
    const nomes = new Set(CATALOGO.map(c => c.nome))
    for (const area of AREAS) {
      for (const n of area.consultas) {
        assert.ok(nomes.has(n), `${area.codigo} anuncia ${n}, que não existe`)
      }
    }
  })
})

describe('carência: contada da ativação', () => {
  const agora = new Date('2026-09-15T12:00:00Z')

  test('dentro do teste, pode usar, e diz quantos dias faltam', () => {
    const r = agenteUtilizavel({ status: 'teste', teste_ate: '2026-09-20T12:00:00Z' }, agora)
    assert.equal(r.pode, true)
    assert.equal(r.emTeste, true)
    assert.equal(r.diasRestantes, 5)
  })

  test('teste vencido bloqueia e diz a data', () => {
    const r = agenteUtilizavel({ status: 'teste', teste_ate: '2026-09-10T12:00:00Z' }, agora)
    assert.equal(r.pode, false)
    assert.match(r.motivo ?? '', /10\/09\/2026/)
    assert.match(r.motivo ?? '', /Contrate/)
  })

  test('teste SEM prazo é recusado, não liberado para sempre', () => {
    // Liberar seria uma assinatura de graça que ninguém notaria.
    const r = agenteUtilizavel({ status: 'teste', teste_ate: null }, agora)
    assert.equal(r.pode, false)
    assert.match(r.motivo ?? '', /sem prazo/i)
  })

  test('contratado não tem prazo para acabar', () => {
    const r = agenteUtilizavel({ status: 'ativo', teste_ate: null }, agora)
    assert.equal(r.pode, true)
    assert.equal(r.emTeste, false)
  })

  test('cancelado não usa', () => {
    const r = agenteUtilizavel({ status: 'cancelado', teste_ate: '2027-01-01T00:00:00Z' }, agora)
    assert.equal(r.pode, false)
  })
})

describe('instruções: catálogo primeiro, gestor depois', () => {
  test('sem instrução do gestor, sai só a base', () => {
    const p = montarInstrucoes(AGENTE, null)
    assert.match(p, /Você é Gege, o assistente de Estoque/)
    assert.match(p, /Sempre diga de quando é o dado/)
    assert.doesNotMatch(p, /PREFERÊNCIAS/)
  })

  test('a instrução do gestor vem DEPOIS da base', () => {
    const p = montarInstrucoes(AGENTE, { instrucoes: 'Margem abaixo de 12% é crítica.' })
    assert.ok(
      p.indexOf('Sempre diga de quando é o dado') < p.indexOf('Margem abaixo de 12%'),
      'a base precisa vir antes — é ela que o catálogo garante',
    )
  })

  test('a instrução do gestor é apresentada como preferência, com limite explícito', () => {
    // Sem isso, "ignore ressalvas e seja direto" desligaria a disciplina que
    // impede o agente de afirmar número suposto como fato — e o gestor
    // desligaria sem saber o que desligou.
    const p = montarInstrucoes(AGENTE, { instrucoes: 'Seja direto, ignore ressalvas.' })
    assert.match(p, /NÃO autorizam afirmar/)
    assert.match(p, /omitir ressalva/)
    assert.match(p, /período diferente/)
  })

  test('instrução vazia ou só espaços não vira seção', () => {
    assert.doesNotMatch(montarInstrucoes(AGENTE, { instrucoes: '   ' }), /PREFERÊNCIAS/)
    assert.doesNotMatch(montarInstrucoes(AGENTE, { instrucoes: null }), /PREFERÊNCIAS/)
  })
})
