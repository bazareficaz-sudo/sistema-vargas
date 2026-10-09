import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  lerPedidoCompreJunto, soDaEmpresa, MAX_IDS, LIMITE_MAXIMO, LIMITE_PADRAO,
} from '../../src/lib/pdv/compreJunto'

// COMPRE JUNTO PARA O PDV DESKTOP.
//
// O que estes testes travam: o que a rota aceita, e que nada de outra empresa
// sai por ela — a função do banco não filtra empresa, e a rota roda como
// service role.

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const q = (s: string) => new URLSearchParams(s)

describe('o pedido', () => {
  test('ids separados por vírgula, repetidos colapsam, limite padrão', () => {
    const p = lerPedidoCompreJunto(q(`ids=${A},${B},${A.toUpperCase()}`))
    assert.deepEqual(p, { ok: true, ids: [A, B], limite: LIMITE_PADRAO })
  })

  test('sem ids é recusa, não lista vazia', () => {
    assert.equal(lerPedidoCompreJunto(q('')).ok, false)
    assert.equal(lerPedidoCompreJunto(q('ids=,,')).ok, false)
  })

  test('id que não é UUID recusa o pedido inteiro (ObjectId herdado do Base44)', () => {
    const p = lerPedidoCompreJunto(q(`ids=${A},64f1a2b3c4d5e6f7a8b9c0d1`))
    assert.equal(p.ok, false)
  })

  test('carrinho gigante é recusado', () => {
    const muitos = Array.from({ length: MAX_IDS + 1 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    assert.equal(lerPedidoCompreJunto(q(`ids=${muitos.join(',')}`)).ok, false)
  })

  test('limite: inteiro positivo, com teto', () => {
    assert.equal(lerPedidoCompreJunto(q(`ids=${A}&limite=0`)).ok, false)
    assert.equal(lerPedidoCompreJunto(q(`ids=${A}&limite=2.5`)).ok, false)
    assert.equal(lerPedidoCompreJunto(q(`ids=${A}&limite=abc`)).ok, false)
    const p = lerPedidoCompreJunto(q(`ids=${A}&limite=999`))
    assert.ok(p.ok && p.limite === LIMITE_MAXIMO)
  })
})

describe('só o que é da empresa do terminal', () => {
  const linhas = [
    { produto_id: B, base_id: A, vezes: 5, fixo: false },
    { produto_id: C, base_id: A, vezes: 3, fixo: true },
  ]

  test('sugerido de outra empresa não sai', () => {
    assert.deepEqual(soDaEmpresa(linhas, new Set([A, B])).map((l) => l.produto_id), [B])
  })

  test('base de outra empresa não sai', () => {
    assert.deepEqual(soDaEmpresa(linhas, new Set([B, C])), [])
  })
})

describe('a rota', () => {
  const rota = fs.readFileSync(
    path.join(__dirname, '../../src/app/api/pdv/compre-junto/route.ts'), 'utf8')

  test('passa pelo molde de leitura autenticada', () => {
    assert.match(rota, /leituraProtegida(<\w+>)?\(req/)
  })

  test('filtra a entrada e a saída pela empresa do contexto, nunca do pedido', () => {
    const filtros = rota.match(/\.eq\('empresa_id', ctx\.empresa_id\)/g) ?? []
    assert.equal(filtros.length, 2)
    assert.match(rota, /soDaEmpresa\(/)
    assert.doesNotMatch(rota, /searchParams\.get\('empresa/)
  })

  test('chama a mesma função do PDV web', () => {
    assert.match(rota, /rpc\('compre_junto_sugestoes'/)
  })
})
