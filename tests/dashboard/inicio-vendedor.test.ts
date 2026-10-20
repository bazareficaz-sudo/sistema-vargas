import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { allItems } from '../../src/components/nav-config'
import { ATALHOS_VENDEDOR, atalhosVisiveis, resumoDespacho, resumoOrcamentos, saudacao } from '../../src/lib/inicio/inicioVendedor'
import { MODELOS_ACESSO, aplicarModelo } from '../../src/lib/auth/modelosAcesso'

const hrefsDoMenu = new Set(allItems().map(i => i.href))

describe('início do vendedor', () => {
  test('todo botão aponta para uma tela do menu', () => {
    for (const a of ATALHOS_VENDEDOR) assert.ok(hrefsDoMenu.has(a.href), a.href)
  })

  test('botão de tela bloqueada ou fora do plano some', () => {
    const v = atalhosVisiveis(ATALHOS_VENDEDOR, item => item.href !== '/dashboard/marketplaces/anuncios' && item.modulo !== 'whatsapp')
    assert.ok(!v.some(a => a.href === '/dashboard/marketplaces/anuncios'))
    assert.ok(!v.some(a => a.href.includes('whatsapp')))
    assert.ok(v.some(a => a.href === '/dashboard/orcamentos'))
  })

  test('despacho: sai hoje, atrasados e o que não conta', () => {
    const agora = new Date('2026-10-20T15:00:00Z') // 12h em Brasília
    const r = resumoDespacho([
      { status: 'confirmado', prazo_postagem: '2026-10-20T20:00:00Z' }, // hoje
      { status: 'confirmado', prazo_postagem: null },                   // sem prazo: hoje
      { status: 'confirmado', prazo_postagem: '2026-10-19T20:00:00Z' }, // atrasado
      { status: 'confirmado', prazo_postagem: '2026-10-23T02:59:59Z' }, // futuro
      { status: 'enviado', prazo_postagem: '2026-10-19T20:00:00Z' },    // já saiu
      { status: 'cancelado', prazo_postagem: null },
    ], agora)
    assert.deepEqual(r, { saemHoje: 2, atrasados: 1, abertos: 4 })
  })

  test('orçamentos em aberto e os que vencem hoje', () => {
    assert.deepEqual(resumoOrcamentos([
      { status: 'aberto', validade: '2026-10-20' }, { status: 'aberto', validade: '2026-10-25' },
      { status: 'convertido', validade: '2026-10-20' },
    ], '2026-10-20'), { abertos: 2, vencemHoje: 1 })
  })

  test('saudação pela hora de Brasília', () => {
    assert.equal(saudacao(new Date('2026-10-20T11:00:00Z')), 'Bom dia')     // 8h
    assert.equal(saudacao(new Date('2026-10-20T18:00:00Z')), 'Boa tarde')   // 15h
    assert.equal(saudacao(new Date('2026-10-20T23:30:00Z')), 'Boa noite')   // 20h30
  })
})

describe('modelos de acesso', () => {
  test('toda tela do modelo existe no menu', () => {
    for (const m of MODELOS_ACESSO) for (const t of m.telas) assert.ok(hrefsDoMenu.has(t), `${m.id}: ${t}`)
  })

  test('o modelo do vendedor inclui o Início e todos os botões dele', () => {
    const v = MODELOS_ACESSO.find(m => m.id === 'vendedor')!
    assert.ok(v.telas.includes('/dashboard/inicio'))
    for (const a of ATALHOS_VENDEDOR) assert.ok(v.telas.includes(a.href), a.href)
    assert.ok(!v.telas.includes('/dashboard'), 'Visão Geral é do gestor')
  })

  test('aplicar libera as telas do modelo, bloqueia as outras e liga as ações', () => {
    const v = MODELOS_ACESSO.find(m => m.id === 'vendedor')!
    const r = aplicarModelo({ ver_custos_margens: true, outra: true }, v, ['/dashboard', '/dashboard/inicio', '/dashboard/contas-pagar'])
    assert.equal(r['tela:/dashboard'], false)
    assert.equal(r['tela:/dashboard/inicio'], true)
    assert.equal(r['tela:/dashboard/contas-pagar'], false)
    assert.equal(r.gerenciar_marketplaces, true)
    assert.equal(r.ver_custos_margens, true) // o que o modelo não fala fica como estava
  })
})
