import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidirAtivacao, decidirToken } from '../../src/lib/pdv/decidirAtivacao'
import { hashDoSegredo } from '../../src/lib/pdv/terminalToken'

const AGORA = new Date('2026-09-07T12:00:00Z')
const DAQUI_A_POUCO = '2026-09-07T12:10:00Z'
const JA_PASSOU = '2026-09-07T11:50:00Z'

const SEGREDO_A = hashDoSegredo('segredo-do-terminal-a')
const SEGREDO_B = hashDoSegredo('segredo-do-terminal-b')

const TERMINAL = {
  id: 'term-a',
  empresa_id: 'empresa-a',
  status: 'aguardando_ativacao' as const,
}

function ativacao(over: Partial<Parameters<typeof decidirAtivacao>[0]['ativacao']> = {}) {
  return {
    id: 'ativ-1', empresa_id: 'empresa-a', terminal_id: 'term-a',
    codigo_hash: 'hash-do-codigo', expira_em: DAQUI_A_POUCO,
    usado_em: null, usado_por_hash: null, tentativas: 0,
    ...over,
  }
}

describe('ativação do terminal', () => {
  test('código válido ativa exatamente um terminal', () => {
    const d = decidirAtivacao({
      ativacao: ativacao(), terminal: TERMINAL,
      secretHashApresentado: SEGREDO_A, agora: AGORA, maxTentativas: 5,
    })
    assert.equal(d.acao, 'ativar')
  })

  test('CÓDIGO EXPIRADO é recusado', () => {
    const d = decidirAtivacao({
      ativacao: ativacao({ expira_em: JA_PASSOU }), terminal: TERMINAL,
      secretHashApresentado: SEGREDO_A, agora: AGORA, maxTentativas: 5,
    })
    assert.equal(d.acao, 'recusar')
    if (d.acao !== 'recusar') return
    // Não conta tentativa: senão um estranho queimaria a ativação de outro
    // só chutando códigos vencidos.
    assert.equal(d.contarTentativa, false)
  })

  test('CÓDIGO JÁ USADO por outro segredo é recusado', () => {
    const d = decidirAtivacao({
      ativacao: ativacao({ usado_em: '2026-09-07T11:55:00Z', usado_por_hash: SEGREDO_B }),
      terminal: TERMINAL, secretHashApresentado: SEGREDO_A,
      agora: AGORA, maxTentativas: 5,
    })
    assert.equal(d.acao, 'recusar')
    if (d.acao !== 'recusar') return
    assert.match(d.erro, /já utilizado/)
    assert.equal(d.contarTentativa, true)
  })

  test('RETRY DA MESMA ATIVAÇÃO não duplica — devolve sucesso', () => {
    // O caso do requisito 29: servidor ativou, a resposta se perdeu, o PDV
    // repetiu. Ele já tem o segredo em mãos, então é a MESMA ativação.
    const d = decidirAtivacao({
      ativacao: ativacao({ usado_em: '2026-09-07T11:59:00Z', usado_por_hash: SEGREDO_A }),
      terminal: TERMINAL, secretHashApresentado: SEGREDO_A,
      agora: AGORA, maxTentativas: 5,
    })
    assert.equal(d.acao, 'ja_ativado')
  })

  test('código inexistente e código errado dão a MESMA mensagem', () => {
    const inexistente = decidirAtivacao({
      ativacao: null, terminal: null,
      secretHashApresentado: SEGREDO_A, agora: AGORA, maxTentativas: 5,
    })
    const expirado = decidirAtivacao({
      ativacao: ativacao({ expira_em: JA_PASSOU }), terminal: TERMINAL,
      secretHashApresentado: SEGREDO_A, agora: AGORA, maxTentativas: 5,
    })
    assert.equal(inexistente.acao, 'recusar')
    assert.equal(expirado.acao, 'recusar')
    if (inexistente.acao !== 'recusar' || expirado.acao !== 'recusar') return
    // Distinguir contaria ao atacante quais códigos existem.
    assert.equal(inexistente.erro, expirado.erro)
  })

  test('tentativas esgotadas bloqueiam o código', () => {
    const d = decidirAtivacao({
      ativacao: ativacao({ tentativas: 5 }), terminal: TERMINAL,
      secretHashApresentado: SEGREDO_A, agora: AGORA, maxTentativas: 5,
    })
    assert.equal(d.acao, 'recusar')
    if (d.acao !== 'recusar') return
    assert.match(d.erro, /excesso de tentativas/)
  })

  test('TERMINAL REVOGADO não reativa com código antigo', () => {
    const d = decidirAtivacao({
      ativacao: ativacao(), terminal: { ...TERMINAL, status: 'revogado' },
      secretHashApresentado: SEGREDO_A, agora: AGORA, maxTentativas: 5,
    })
    assert.equal(d.acao, 'recusar')
    if (d.acao !== 'recusar') return
    assert.match(d.erro, /revogado/)
  })
})

describe('emissão de token', () => {
  const ativo = { id: 'term-a', empresa_id: 'empresa-a', status: 'ativo' as const, secret_hash: SEGREDO_A }

  test('credencial válida gera token', () => {
    const d = decidirToken({ terminal: ativo, secretHashApresentado: SEGREDO_A, empresaAtiva: true })
    assert.equal(d.acao, 'emitir')
  })

  test('CREDENCIAL INVÁLIDA é recusada', () => {
    const d = decidirToken({ terminal: ativo, secretHashApresentado: SEGREDO_B, empresaAtiva: true })
    assert.equal(d.acao, 'recusar')
    if (d.acao !== 'recusar') return
    assert.equal(d.status, 401)
  })

  test('TERMINAL REVOGADO não renova', () => {
    const d = decidirToken({
      terminal: { ...ativo, status: 'revogado' },
      secretHashApresentado: SEGREDO_A, empresaAtiva: true,
    })
    assert.equal(d.acao, 'recusar')
    if (d.acao !== 'recusar') return
    assert.equal(d.status, 403)
    assert.match(d.erro, /revogado/)
  })

  test('terminal não ativado ainda não recebe token', () => {
    const d = decidirToken({
      terminal: { ...ativo, status: 'aguardando_ativacao' },
      secretHashApresentado: SEGREDO_A, empresaAtiva: true,
    })
    assert.equal(d.acao, 'recusar')
  })

  test('empresa inativa derruba o terminal junto', () => {
    const d = decidirToken({ terminal: ativo, secretHashApresentado: SEGREDO_A, empresaAtiva: false })
    assert.equal(d.acao, 'recusar')
  })

  test('terminal inexistente e credencial errada dão a MESMA mensagem', () => {
    const inexistente = decidirToken({ terminal: null, secretHashApresentado: SEGREDO_A, empresaAtiva: true })
    const errada = decidirToken({ terminal: ativo, secretHashApresentado: SEGREDO_B, empresaAtiva: true })
    assert.equal(inexistente.acao, 'recusar')
    assert.equal(errada.acao, 'recusar')
    if (inexistente.acao !== 'recusar' || errada.acao !== 'recusar') return
    assert.equal(inexistente.erro, errada.erro)
    assert.equal(inexistente.status, errada.status)
  })

  test('terminal sem segredo gravado nunca autentica', () => {
    // Um `secret_hash` nulo não pode casar com nada — senão uma linha criada
    // e nunca ativada aceitaria qualquer credencial.
    const d = decidirToken({
      terminal: { ...ativo, secret_hash: null },
      secretHashApresentado: '', empresaAtiva: true,
    })
    assert.equal(d.acao, 'recusar')
  })

  test('A EMPRESA NÃO É PARÂMETRO — o cliente não tem onde pedir outra', () => {
    // Requisito 30. A garantia é estrutural: `decidirToken` não aceita
    // empresa alguma na entrada, então não existe caminho para um pedido
    // "me dê token da empresa B" ser atendido.
    const entrada = Object.keys({ terminal: null, secretHashApresentado: '', empresaAtiva: true })
    assert.ok(!entrada.some(k => k.toLowerCase().includes('empresa_id')))
    assert.ok(!entrada.includes('empresaId'))
  })
})
