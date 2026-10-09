import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { loginDeOutroDia } from '../../src/lib/auth/viradaDia'

// O caso real (09/10/2026): saiu pelo botão "Sair" ontem, entrou hoje e foi
// derrubado em segundos com "sessão do dia anterior". O dia do login agora
// vem do servidor, então um login de HOJE nunca é tratado como de ontem.

const local = (a: number, m: number, d: number, h: number) => new Date(a, m - 1, d, h, 0, 0)

describe('loginDeOutroDia', () => {
  test('login feito hoje não derruba, a qualquer hora do dia', () => {
    assert.equal(loginDeOutroDia(local(2026, 10, 9, 8).toISOString(), local(2026, 10, 9, 8)), false)
    assert.equal(loginDeOutroDia(local(2026, 10, 9, 0).toISOString(), local(2026, 10, 9, 23)), false)
  })

  test('sessão aberta ontem e ainda viva hoje derruba', () => {
    assert.equal(loginDeOutroDia(local(2026, 10, 8, 18).toISOString(), local(2026, 10, 9, 7)), true)
  })

  test('sem data de login, ou data inválida, ninguém é derrubado', () => {
    assert.equal(loginDeOutroDia(null, local(2026, 10, 9, 8)), false)
    assert.equal(loginDeOutroDia(undefined), false)
    assert.equal(loginDeOutroDia('lixo', local(2026, 10, 9, 8)), false)
  })
})
