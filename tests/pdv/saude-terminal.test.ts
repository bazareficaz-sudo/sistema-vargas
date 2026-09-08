import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  saudeDoTerminal, rotuloDePresenca,
  INTERVALO_HEARTBEAT_MS, TOLERANCIA_OFFLINE_MS, BATIDAS_ATE_OFFLINE,
  type LinhaSaude,
} from '../../src/lib/pdv/saudeTerminal'
import {
  compararVersoes, situacaoDaVersao, quemFicariaDeFora,
} from '../../src/lib/pdv/versaoMinima'

const AGORA = new Date('2026-09-08T18:00:00Z')
const atras = (ms: number) => new Date(AGORA.getTime() - ms).toISOString()

const BASE: LinhaSaude = {
  status: 'ativo',
  versao_pdv: '1.9.0',
  usar_rotas_novas: true,
  ativado_em: '2026-09-08T14:32:00Z',
  ultima_autenticacao_em: '2026-09-08T16:00:00Z',
  ultimo_heartbeat_em: atras(60_000),
}

describe('saúde do terminal', () => {
  test('bateu agora: online', () => {
    assert.equal(saudeDoTerminal(BASE, AGORA).presenca, 'online')
  })

  test('NUNCA BATEU é estado próprio, não "offline"', () => {
    // Confundir os dois esconderia o caso que motivou este módulo: um terminal
    // ativado que nunca deu sinal não é um terminal offline — é um terminal
    // que nunca provou funcionar.
    const s = saudeDoTerminal({ ...BASE, ultimo_heartbeat_em: null }, AGORA)
    assert.equal(s.presenca, 'nunca_bateu')
    assert.equal(s.minutosSemBater, null)
  })

  test('uma batida perdida ainda é online — o painel não pode piscar', () => {
    const s = saudeDoTerminal({ ...BASE, ultimo_heartbeat_em: atras(INTERVALO_HEARTBEAT_MS + 1000) }, AGORA)
    assert.equal(s.presenca, 'online')
  })

  test('no limite da tolerância ainda é online', () => {
    const s = saudeDoTerminal({ ...BASE, ultimo_heartbeat_em: atras(TOLERANCIA_OFFLINE_MS) }, AGORA)
    assert.equal(s.presenca, 'online')
  })

  test('passada a tolerância vira offline', () => {
    const s = saudeDoTerminal({ ...BASE, ultimo_heartbeat_em: atras(TOLERANCIA_OFFLINE_MS + 1000) }, AGORA)
    assert.equal(s.presenca, 'offline')
  })

  test('a tolerância são três batidas, não uma', () => {
    assert.equal(BATIDAS_ATE_OFFLINE, 3)
    assert.equal(TOLERANCIA_OFFLINE_MS, INTERVALO_HEARTBEAT_MS * 3)
  })

  test('VALIDAÇÃO PENDENTE: ativado, sem nenhuma autenticação posterior', () => {
    // É o estado do `Escritorio Silvano`: identidade gravada, reinício ainda
    // não exercido. Precisa de rótulo próprio para não ser lido como falha.
    const s = saudeDoTerminal({ ...BASE, ultima_autenticacao_em: null }, AGORA)
    assert.equal(s.validacaoPendente, true)
    assert.equal(s.autenticado, false)
  })

  test('quem já autenticou não fica pendente', () => {
    assert.equal(saudeDoTerminal(BASE, AGORA).validacaoPendente, false)
  })

  test('terminal revogado não é "validação pendente"', () => {
    const s = saudeDoTerminal({ ...BASE, status: 'revogado', ultima_autenticacao_em: null }, AGORA)
    assert.equal(s.validacaoPendente, false)
  })

  test('rótulos legíveis em cada escala de tempo', () => {
    const r = (ms: number | null) =>
      rotuloDePresenca(saudeDoTerminal({ ...BASE, ultimo_heartbeat_em: ms === null ? null : atras(ms) }, AGORA))
    assert.equal(r(null), 'nunca deu sinal')
    assert.equal(r(60_000), 'online')
    assert.equal(r(30 * 60_000), 'offline há 30 min')
    assert.equal(r(5 * 60 * 60_000), 'offline há 5 h')
    assert.equal(r(5 * 24 * 60 * 60_000), 'offline há 5 dias')
  })
})

describe('versão mínima — capacidade de observação, não de corte', () => {
  test('comparação de versões', () => {
    assert.equal(compararVersoes('1.9.0', '1.8.23'), 1)
    assert.equal(compararVersoes('1.8.23', '1.9.0'), -1)
    assert.equal(compararVersoes('1.9.0', '1.9.0'), 0)
    // 1.10 > 1.9 — comparação numérica, não alfabética
    assert.equal(compararVersoes('1.10.0', '1.9.0'), 1)
    assert.equal(compararVersoes('2.0', '2.0.0'), 0)
  })

  test('sem mínimo definido, ninguém fica de fora', () => {
    assert.equal(situacaoDaVersao('1.0.0', null), 'sem_minimo')
    assert.deepEqual(quemFicariaDeFora([{ nome: 'velho', versao_pdv: '1.0.0' }], null),
      { abaixo: [], desconhecida: [] })
  })

  test('DESCONHECIDA não é o mesmo que ABAIXO', () => {
    // Um terminal sem versão registrada nunca falou conosco pela rota nova.
    // Tratá-lo como reprovado misturaria "velho demais" com "nunca apareceu",
    // que pedem ações diferentes.
    assert.equal(situacaoDaVersao(null, '1.9.0'), 'desconhecida')
    assert.equal(situacaoDaVersao('1.8.23', '1.9.0'), 'abaixo')
  })

  test('o caso PDV-002: simula quem voltaria incompatível', () => {
    const parque = [
      { nome: 'Caixa', versao_pdv: '1.9.0' },
      { nome: 'Balcão 1', versao_pdv: '1.9.0' },
      { nome: 'Antigo desligado', versao_pdv: '1.8.23' },
      { nome: 'Nunca apareceu', versao_pdv: null },
    ]
    const r = quemFicariaDeFora(parque, '1.9.0')
    assert.deepEqual(r.abaixo, ['Antigo desligado'])
    assert.deepEqual(r.desconhecida, ['Nunca apareceu'])
  })

  test('a versão exata do piso atende', () => {
    assert.equal(situacaoDaVersao('1.9.0', '1.9.0'), 'atende')
  })
})
