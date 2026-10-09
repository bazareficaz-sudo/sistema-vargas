import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tetoDeAtualizacao } from '../../src/lib/pdv/atualizacao'

// O teto de atualização do PDV: valor torto no banco nunca vira "libera tudo".

describe('teto de atualização', () => {
  test('versão x.y.z passa', () => {
    assert.equal(tetoDeAtualizacao('1.10.9'), '1.10.9')
    assert.equal(tetoDeAtualizacao(' 2.0.0 '), '2.0.0')
  })

  test('nulo, vazio ou malformado = não liberado', () => {
    for (const v of [null, undefined, '', 'latest', '*', '1.10', '1.10.9-beta', 'v1.10.9', 110, {}]) {
      assert.equal(tetoDeAtualizacao(v), null, String(v))
    }
  })
})

describe('a rota', () => {
  const rota = fs.readFileSync(
    path.join(__dirname, '../../src/app/api/pdv/atualizacao/route.ts'), 'utf8')

  test('autenticada pelo token do terminal, lê só a linha DESTE terminal', () => {
    assert.match(rota, /leituraProtegida\(req/)
    assert.match(rota, /\.eq\('id', ctx\.terminal_id\)/)
    assert.doesNotMatch(rota, /searchParams/)
  })

  test('devolve o teto passado pela validação', () => {
    assert.match(rota, /liberada_ate: tetoDeAtualizacao\(/)
  })
})
