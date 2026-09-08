import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidirAcesso, type LinhaTerminalAcesso } from '../../src/lib/pdv/decidirAcesso'
import { validarFalta, validarAtualizacaoFalta } from '../../src/lib/pdv/payloadFalta'
import { decidirIdempotencia } from '../../src/lib/pdv/decidirIdempotencia'

const EMPRESA_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const EMPRESA_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const TERMINAL_A = '11111111-1111-1111-1111-111111111111'

const CLAIMS = {
  sub: TERMINAL_A, terminal_id: TERMINAL_A, empresa_id: EMPRESA_A,
  tenant_id: null, tipo: 'pdv_terminal' as const, iat: 0, exp: 9_999_999_999,
}

const TERMINAL: LinhaTerminalAcesso = {
  id: TERMINAL_A, empresa_id: EMPRESA_A, status: 'ativo',
  nome: 'Caixa', versao_pdv: '1.9.2', usar_rotas_novas: true,
  rotas_habilitadas: { faltas: true },
}

const acesso = (over: Partial<LinhaTerminalAcesso> = {}, operacao = 'faltas') =>
  decidirAcesso({
    claims: CLAIMS, terminal: { ...TERMINAL, ...over },
    tenantId: null, empresaAtiva: true, exigirFlag: true, operacao,
  })

describe('flag por operação — o rollout deixa de ser tudo-ou-nada', () => {
  test('Caixa com faltas ligada passa', () => {
    assert.equal(acesso().ok, true)
  })

  test('FLAG DE OUTRA OPERAÇÃO NÃO LIBERA FALTAS', () => {
    // O ponto todo da mudança: ligar uma rota não pode ligar as outras.
    const a = acesso({ rotas_habilitadas: { impressao: true } })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'rota_desligada')
    assert.equal(a.status, 409)
  })

  test('o booleano antigo NÃO libera faltas', () => {
    // `usar_rotas_novas` está `true` em todos os 6 terminais desde a 0.6A.
    // Se ele valesse aqui, ligar `faltas` teria acontecido sozinho no parque
    // inteiro no instante do deploy.
    const a = acesso({ rotas_habilitadas: {} })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'rota_desligada')
  })

  test('mapa ausente conta como desligado', () => {
    assert.equal(acesso({ rotas_habilitadas: null }).ok, false)
  })

  test('sem operação informada, cai no booleano antigo (impressão segue igual)', () => {
    const a = decidirAcesso({
      claims: CLAIMS, terminal: { ...TERMINAL, rotas_habilitadas: {} },
      tenantId: null, empresaAtiva: true, exigirFlag: true,
    })
    assert.equal(a.ok, true)
  })

  test('terminal revogado não passa nem com a flag ligada', () => {
    const a = acesso({ status: 'revogado' })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'terminal_revogado')
  })

  test('TERMINAL DE OUTRA EMPRESA NÃO OPERA AQUI', () => {
    const a = acesso({ empresa_id: EMPRESA_B })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'empresa_divergente')
  })
})

describe('payload da falta — lista fechada, não repasse', () => {
  test('o mínimo aceitável', () => {
    const v = validarFalta({ produto_nome: 'Parafuso 3/8' })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.falta.produto_nome, 'Parafuso 3/8')
    assert.equal(v.falta.quantidade_solicitada, 1)
    assert.equal(v.falta.status, 'pendente')
    assert.equal(v.falta.tipo, 'falta')
  })

  test('sem produto_nome é recusado', () => {
    for (const c of [{}, { produto_nome: '' }, { produto_nome: '   ' }, { produto_nome: 42 }]) {
      assert.equal(validarFalta(c).ok, false)
    }
  })

  test('CAMPO FORA DA LISTA É IGNORADO, não gravado', () => {
    // O legado fazia `.update(dados)` com o objeto inteiro — o cliente
    // escolhia o que escrever. Aqui a lista é fechada.
    const v = validarFalta({ produto_nome: 'X', empresa_id: EMPRESA_B, id: 'forjado', total: 999 })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.ok(!('empresa_id' in v.falta))
    assert.ok(!('id' in v.falta))
    assert.ok(!('total' in v.falta))
  })

  test('produto_id que não é UUID vira nulo em vez de quebrar', () => {
    // ObjectId de 24 chars herdado do Base44 rebentaria com "invalid input
    // syntax for type uuid" e travaria o registro por um vínculo velho.
    const v = validarFalta({ produto_nome: 'X', produto_id: '507f1f77bcf86cd799439011' })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.falta.produto_id, null)
  })

  test('preserva a semântica atual de tipo', () => {
    const t = (x: unknown) => (validarFalta({ produto_nome: 'X', tipo: x }) as { falta: { tipo: string } }).falta.tipo
    assert.equal(t('encomenda'), 'encomenda')
    assert.equal(t('falta'), 'falta')
    assert.equal(t('qualquer_outra_coisa'), 'falta')
    assert.equal(t(undefined), 'falta')
  })

  test('quantidade inválida cai no default de 1, como hoje', () => {
    const q = (x: unknown) => (validarFalta({ produto_nome: 'X', quantidade_solicitada: x }) as { falta: { quantidade_solicitada: number } }).falta.quantidade_solicitada
    assert.equal(q(0), 1)
    assert.equal(q(-5), 1)
    assert.equal(q('abc'), 1)
    assert.equal(q(3), 3)
  })

  test('texto vazio vira nulo, não string vazia', () => {
    const v = validarFalta({ produto_nome: 'X', cliente_nome: '  ', observacao: '' })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.falta.cliente_nome, null)
    assert.equal(v.falta.observacao, null)
  })

  test('atualização só aceita o par documentado', () => {
    const v = validarAtualizacaoFalta({ status: 'atendida', empresa_id: EMPRESA_B, preco_negociado: 1 })
    assert.ok('dados' in v)
    if (!('dados' in v)) return
    assert.deepEqual(v.dados, { status: 'atendida' })
  })

  test('atualização vazia é recusada', () => {
    assert.equal(validarAtualizacaoFalta({}).ok, false)
  })
})

describe('idempotência da falta — os seis casos', () => {
  const agora = new Date('2026-09-08T21:00:00Z')
  const linha = (status: 'em_andamento' | 'sucesso' | 'erro', segAtras: number, resposta: unknown = null) => ({
    status, resposta, criado_em: new Date(agora.getTime() - segAtras * 1000).toISOString(),
  })

  test('caso 1 — envio normal: executa', () => {
    assert.equal(decidirIdempotencia(null, agora).acao, 'executar')
  })

  test('caso 2 — mesmo request duas vezes: um efeito', () => {
    const d = decidirIdempotencia(linha('sucesso', 5, { ok: true, falta_id: 'f1' }), agora)
    assert.equal(d.acao, 'repetir_resposta')
  })

  test('caso 3 — resposta perdida: reenvio devolve o resultado já processado', () => {
    // O caso crítico. O PDV não sabe se gravou; reenvia com a MESMA chave e
    // recebe o mesmo resultado, em vez de criar a segunda linha.
    const d = decidirIdempotencia(linha('sucesso', 90, { ok: true, falta_id: 'f1' }), agora)
    assert.equal(d.acao, 'repetir_resposta')
    if (d.acao !== 'repetir_resposta') return
    assert.deepEqual(d.resposta, { ok: true, falta_id: 'f1' })
  })

  test('caso 4 — Electron fecha com pendente, abre e drena: um efeito', () => {
    // A chave é o `id` local, que estava no SQLite antes do fechamento.
    const d = decidirIdempotencia(linha('sucesso', 3600, { ok: true, falta_id: 'f1' }), agora)
    assert.equal(d.acao, 'repetir_resposta')
  })

  test('caso 5 — offline e depois online: a chave é a mesma', () => {
    // Offline não chega ao servidor, então a primeira linha nasce no retorno.
    assert.equal(decidirIdempotencia(null, agora).acao, 'executar')
  })

  test('caso 6 — token vence na fila: renova e envia, ainda um efeito', () => {
    // Renovar token não muda a chave; ela é do evento, não da sessão.
    const d = decidirIdempotencia(linha('sucesso', 43200, { ok: true, falta_id: 'f1' }), agora)
    assert.equal(d.acao, 'repetir_resposta')
  })

  test('tentativa anterior que falhou pode ser refeita', () => {
    assert.equal(decidirIdempotencia(linha('erro', 30), agora).acao, 'reexecutar')
  })

  test('duas simultâneas: a segunda espera, não duplica', () => {
    assert.equal(decidirIdempotencia(linha('em_andamento', 2), agora).acao, 'em_voo')
  })
})
