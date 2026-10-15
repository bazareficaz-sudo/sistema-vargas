import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { blocoAtendimento, type ConversaResumo } from '../../src/lib/getulio/atendimento'
import { APP_URL } from '../../src/lib/appUrl'

const quinta = new Date('2026-10-15T11:00:00Z') // 08h em São Paulo
const c = (id: string, extra: Partial<ConversaResumo>): ConversaResumo => ({
  id, telefone: '5521991203602', cliente_nome: null, nome_whatsapp: null,
  retorno_em: null, retorno_nota: null, etapa_em: null, ultima_entrada_em: null, ...extra,
})

describe('resumo: atendimento no WhatsApp', () => {
  test('nada a mostrar → sem bloco', () => {
    assert.equal(blocoAtendimento({ retornos: [], parados: [], aguardando: [] }, quinta), null)
  })
  test('três listas com nome, detalhe e link de cada conversa', () => {
    const t = blocoAtendimento({
      retornos: [c('r1', { cliente_nome: 'Maria Souza', retorno_em: '2026-10-15', retorno_nota: 'ver orçamento da tinta' }),
                 c('r2', { nome_whatsapp: '~Leilane', retorno_em: '2026-10-13' })],
      parados: [c('p1', { nome_whatsapp: 'João', etapa_em: '2026-10-10T18:00:00Z' })],
      aguardando: [c('a1', { telefone: '123456789012345', ultima_entrada_em: '2026-10-15T08:00:00Z' })],
    }, quinta)!
    assert.ok(t.startsWith('📲 *Atendimento no WhatsApp*'))
    assert.match(t, /\*Retornos para hoje \(2\)\*/)
    assert.match(t, /• Maria Souza — hoje: ver orçamento da tinta\n  .*\?c=r1/)
    assert.match(t, /• ~Leilane — atrasado 2 dias\n/)
    assert.match(t, /\*Orçamentos sem resposta \(1\)\*\n• João — enviado em 10\/10, sem resposta/)
    assert.match(t, /\*Esperando resposta da loja \(1\)\*\n• Número oculto — há 3 h/)
    assert.ok(t.includes(`${APP_URL}/dashboard/integracoes/whatsapp/conversas?c=a1`))
  })
  test('mais de 5: mostra 5 e o link do filtro', () => {
    const muitos = Array.from({ length: 8 }, (_, i) => c(`a${i}`, { nome_whatsapp: `P${i}`, ultima_entrada_em: '2026-10-15T08:00:00Z' }))
    const t = blocoAtendimento({ retornos: [], parados: [], aguardando: muitos }, quinta)!
    assert.equal((t.match(/\?c=/g) ?? []).length, 5)
    assert.ok(t.includes(`• …e mais 3: ${APP_URL}/dashboard/integracoes/whatsapp/conversas?f=aguardando`))
  })
})
