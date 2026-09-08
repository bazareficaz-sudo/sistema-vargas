import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  validarOrcamento, chaveDoOrcamento, httpDoEstado,
} from '../../src/lib/pdv/payloadOrcamento'
import { decidirAcesso, type LinhaTerminalAcesso } from '../../src/lib/pdv/decidirAcesso'
import { decidirIdempotencia } from '../../src/lib/pdv/decidirIdempotencia'

const EMPRESA_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const EMPRESA_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const TERMINAL_A = '11111111-1111-1111-1111-111111111111'
const ORC = '550e8400-e29b-41d4-a716-446655440000'

const item = (over = {}) => ({
  produto_nome: 'Parafuso 3/8', quantidade: 2, preco_unitario: 1.5, total: 3, ...over,
})
const corpo = (over: Record<string, unknown> = {}) => ({
  orcamento_id: ORC, revisao_base: 0,
  cabecalho: { cliente_nome: 'João', total: 3 },
  itens: [item()],
  ...over,
})

describe('a chave identifica a TENTATIVA, não o documento', () => {
  test('mesma revisão, mesma chave — o retry não duplica', () => {
    assert.equal(chaveDoOrcamento(ORC, 2), chaveDoOrcamento(ORC, 2))
  })

  test('REVISÃO NOVA, CHAVE NOVA — senão a edição viraria replay', () => {
    // O erro que este desenho evita: se a chave fosse só o id, a segunda
    // edição bateria na chave da primeira e voltaria como "já processado".
    // A edição simplesmente nunca aconteceria.
    assert.notEqual(chaveDoOrcamento(ORC, 2), chaveDoOrcamento(ORC, 3))
  })

  test('criação parte da revisão 0', () => {
    assert.equal(chaveDoOrcamento(ORC, 0), `${ORC}:r0`)
  })
})

describe('estado da RPC → status HTTP', () => {
  test('409 e 5xx precisam ser distinguíveis', () => {
    // É a distinção que mais importa para o cliente: 409 = pare e recarregue;
    // 5xx = insista com a mesma chave. Tratá-los igual duplicaria um deles.
    assert.equal(httpDoEstado('conflito_versao'), 409)
    assert.equal(httpDoEstado(undefined), 500)
  })

  test('criado e atualizado são sucesso', () => {
    assert.equal(httpDoEstado('criado'), 200)
    assert.equal(httpDoEstado('atualizado'), 200)
  })

  test('payload inválido é 400 — erro do cliente, não do servidor', () => {
    assert.equal(httpDoEstado('payload_invalido'), 400)
  })
})

describe('validação do comando', () => {
  test('comando completo passa', () => {
    const v = validarOrcamento(corpo())
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.comando.orcamento_id, ORC)
    assert.equal(v.comando.itens.length, 1)
  })

  test('ZERO ITENS É RECUSADO', () => {
    // É exatamente o estado corrompido que o defeito atual produz. Permiti-lo
    // tornaria o defeito indistinguível de um documento legítimo.
    const v = validarOrcamento(corpo({ itens: [] }))
    assert.equal(v.ok, false)
    if (v.ok) return
    assert.match(v.erro, /ao menos um item/)
  })

  test('id que não é UUID é recusado — sem ele não há idempotência', () => {
    for (const id of ['abc', '', null, 123, '507f1f77bcf86cd799439011']) {
      assert.equal(validarOrcamento(corpo({ orcamento_id: id })).ok, false)
    }
  })

  test('revisao_base precisa ser inteiro >= 0', () => {
    for (const r of [-1, 'x', null, 1.5]) {
      assert.equal(validarOrcamento(corpo({ revisao_base: r })).ok, false)
    }
    assert.equal(validarOrcamento(corpo({ revisao_base: 0 })).ok, true)
    assert.equal(validarOrcamento(corpo({ revisao_base: 7 })).ok, true)
  })

  test('item sem nome derruba o comando inteiro', () => {
    const v = validarOrcamento(corpo({ itens: [item(), { quantidade: 1 }] }))
    assert.equal(v.ok, false)
  })

  test('quantidade inválida é recusada, não silenciosamente corrigida', () => {
    assert.equal(validarOrcamento(corpo({ itens: [item({ quantidade: 0 })] })).ok, false)
    assert.equal(validarOrcamento(corpo({ itens: [item({ quantidade: -3 })] })).ok, false)
  })

  test('prefere produto_remote_id — cair no id local geraria item órfão', () => {
    const remoto = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    const v = validarOrcamento(corpo({
      itens: [item({ produto_id: 'id-local-qualquer', produto_remote_id: remoto })],
    }))
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.comando.itens[0].produto_id, remoto)
  })

  test('produto_id inválido vira nulo em vez de rebentar a FK', () => {
    const v = validarOrcamento(corpo({ itens: [item({ produto_id: '507f1f77bcf86cd799439011' })] }))
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.comando.itens[0].produto_id, null)
  })

  test('campo fora do contrato não passa para o comando', () => {
    const v = validarOrcamento(corpo({ cabecalho: { cliente_nome: 'X', empresa_id: EMPRESA_B, numero: 999 } }))
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.ok(!('empresa_id' in v.comando.cabecalho))
    assert.ok(!('numero' in v.comando.cabecalho))
  })

  test('data inválida vira nulo em vez de derrubar a transação', () => {
    const v = validarOrcamento(corpo({ cabecalho: { validade: '31/12/2026' } }))
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.comando.cabecalho.validade, null)
  })
})

describe('flag por operação', () => {
  const CLAIMS = {
    sub: TERMINAL_A, terminal_id: TERMINAL_A, empresa_id: EMPRESA_A,
    tenant_id: null, tipo: 'pdv_terminal' as const, iat: 0, exp: 9_999_999_999,
  }
  const T: LinhaTerminalAcesso = {
    id: TERMINAL_A, empresa_id: EMPRESA_A, status: 'ativo', nome: 'Caixa',
    versao_pdv: '1.9.3', usar_rotas_novas: true, rotas_habilitadas: { orcamentos: true },
  }
  const a = (over: Partial<LinhaTerminalAcesso> = {}) => decidirAcesso({
    claims: CLAIMS, terminal: { ...T, ...over },
    tenantId: null, empresaAtiva: true, exigirFlag: true, operacao: 'orcamentos',
  })

  test('flag ligada passa', () => assert.equal(a().ok, true))

  test('FLAG DE FALTAS NÃO LIBERA ORÇAMENTOS', () => {
    const r = a({ rotas_habilitadas: { faltas: true } })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.motivo, 'rota_desligada')
    assert.equal(r.status, 409)
  })

  test('o booleano global não libera', () => {
    assert.equal(a({ rotas_habilitadas: {} }).ok, false)
  })

  test('terminal revogado não passa', () => {
    const r = a({ status: 'revogado' })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.motivo, 'terminal_revogado')
  })

  test('terminal de outra empresa não passa', () => {
    const r = a({ empresa_id: EMPRESA_B })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.motivo, 'empresa_divergente')
  })
})

describe('idempotência ponta a ponta', () => {
  const agora = new Date('2026-09-08T22:00:00Z')
  const linha = (status: 'em_andamento' | 'sucesso' | 'erro', seg: number, resposta: unknown = null) => ({
    status, resposta, criado_em: new Date(agora.getTime() - seg * 1000).toISOString(),
  })

  test('envio normal executa', () => {
    assert.equal(decidirIdempotencia(null, agora).acao, 'executar')
  })

  test('resposta perdida depois do commit → replay com o MESMO número', () => {
    const primeira = { ok: true, estado: 'criado', numero: 57, revisao: 1 }
    const d = decidirIdempotencia(linha('sucesso', 120, primeira), agora)
    assert.equal(d.acao, 'repetir_resposta')
    if (d.acao !== 'repetir_resposta') return
    // Nem novo orçamento, nem número novo queimado da sequência.
    assert.deepEqual(d.resposta, primeira)
  })

  test('fila drenada depois de horas offline → ainda um efeito', () => {
    const d = decidirIdempotencia(linha('sucesso', 8 * 3600, { ok: true, numero: 57 }), agora)
    assert.equal(d.acao, 'repetir_resposta')
  })

  test('CONFLITO NÃO É GRAVADO COMO SUCESSO — senão a chave o devolveria para sempre', () => {
    // Um 409 guardado como 'sucesso' voltaria mesmo depois de o cliente
    // rebasear. Gravado como 'erro', a mesma chave pode ser reexecutada.
    const d = decidirIdempotencia(linha('erro', 60), agora)
    assert.equal(d.acao, 'reexecutar')
  })

  test('erro transitório permite retry com a mesma chave', () => {
    assert.equal(decidirIdempotencia(linha('erro', 10), agora).acao, 'reexecutar')
  })

  test('duas revisões simultâneas: a segunda espera', () => {
    assert.equal(decidirIdempotencia(linha('em_andamento', 2), agora).acao, 'em_voo')
  })

  test('revisão nova usa chave nova, então não encosta na anterior', () => {
    // r2 concluída não interfere em r3: são linhas diferentes na tabela.
    const r2 = decidirIdempotencia(linha('sucesso', 300, { ok: true, revisao: 3 }), agora)
    const r3 = decidirIdempotencia(null, agora)
    assert.equal(r2.acao, 'repetir_resposta')
    assert.equal(r3.acao, 'executar')
  })
})
