import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  assinarToken, verificarToken, gerarCodigoAtivacao, normalizarCodigo,
  hashDoCodigo, prefixoDoCodigo, gerarSegredoTerminal, hashDoSegredo,
  segredoBemFormado, hashesIguais, TOKEN_VALIDADE_SEGUNDOS,
} from '../../src/lib/pdv/terminalToken'

// A cadeia que esta fase constrói:
//   credencial válida → terminal identificado → empresa determinada pelo
//   servidor → token assinado.
//
// O que se testa aqui é a parte criptográfica dela. A parte de banco (código
// usado, terminal revogado, idempotência) está em `terminal-ativacao.test.ts`.

const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'
const AGORA = 1_800_000_000

const CLAIMS = {
  sub: '11111111-1111-1111-1111-111111111111',
  terminal_id: '11111111-1111-1111-1111-111111111111',
  empresa_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenant_id: 'tttttttt-tttt-tttt-tttt-tttttttttttt',
  tipo: 'pdv_terminal' as const,
}

describe('token do terminal', () => {
  test('token válido volta com as claims intactas', () => {
    const t = assinarToken(CLAIMS, SEGREDO, AGORA)
    const v = verificarToken(t, SEGREDO, AGORA + 10)
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.claims.terminal_id, CLAIMS.terminal_id)
    assert.equal(v.claims.empresa_id, CLAIMS.empresa_id)
    assert.equal(v.claims.exp, AGORA + TOKEN_VALIDADE_SEGUNDOS)
  })

  test('TOKEN ADULTERADO é rejeitado', () => {
    // O ataque que importa: trocar a empresa no payload. Se passasse, toda a
    // fase seria inútil — o cliente voltaria a escolher a empresa.
    const t = assinarToken(CLAIMS, SEGREDO, AGORA)
    const [h, p, s] = t.split('.')
    const payload = JSON.parse(Buffer.from(p, 'base64').toString('utf8'))
    payload.empresa_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const forjado = Buffer.from(JSON.stringify(payload)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const v = verificarToken(`${h}.${forjado}.${s}`, SEGREDO, AGORA + 10)
    assert.equal(v.ok, false)
    if (v.ok) return
    assert.equal(v.erro, 'assinatura')
  })

  test('assinado com outro segredo é rejeitado', () => {
    const t = assinarToken(CLAIMS, 'outro-segredo', AGORA)
    const v = verificarToken(t, SEGREDO, AGORA + 10)
    assert.equal(v.ok, false)
  })

  test('TOKEN EXPIRADO é rejeitado', () => {
    const t = assinarToken(CLAIMS, SEGREDO, AGORA)
    const v = verificarToken(t, SEGREDO, AGORA + TOKEN_VALIDADE_SEGUNDOS + 1)
    assert.equal(v.ok, false)
    if (v.ok) return
    assert.equal(v.erro, 'expirado')
  })

  test('no instante exato da expiração já não vale', () => {
    const t = assinarToken(CLAIMS, SEGREDO, AGORA)
    const v = verificarToken(t, SEGREDO, AGORA + TOKEN_VALIDADE_SEGUNDOS)
    assert.equal(v.ok, false)
  })

  test('token de outro tipo não passa por token de terminal', () => {
    const t = assinarToken({ ...CLAIMS, tipo: 'outra_coisa' as 'pdv_terminal' }, SEGREDO, AGORA)
    const v = verificarToken(t, SEGREDO, AGORA + 10)
    assert.equal(v.ok, false)
    if (v.ok) return
    assert.equal(v.erro, 'tipo')
  })

  test('lixo não derruba o verificador', () => {
    for (const ruim of ['', 'a', 'a.b', 'a.b.c.d', '...', 'x.y.z']) {
      const v = verificarToken(ruim, SEGREDO, AGORA)
      assert.equal(v.ok, false)
    }
  })
})

describe('código de ativação', () => {
  test('formato legível em voz alta, sem caracteres ambíguos', () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigoAtivacao()
      assert.match(c, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
      // I, O, 0 e 1 fora: o código é ditado por telefone.
      assert.doesNotMatch(c, /[IO01]/)
    }
  })

  test('não repete em 500 gerações', () => {
    const vistos = new Set<string>()
    for (let i = 0; i < 500; i++) vistos.add(gerarCodigoAtivacao())
    assert.equal(vistos.size, 500)
  })

  test('o operador pode digitar de qualquer jeito', () => {
    const alvo = hashDoCodigo('AB7F-K93X')
    for (const digitado of ['ab7f-k93x', 'AB7FK93X', ' AB7F K93X ', 'ab7f k93x']) {
      assert.equal(hashDoCodigo(digitado), alvo, `falhou com "${digitado}"`)
    }
  })

  test('o hash não devolve o código', () => {
    const c = gerarCodigoAtivacao()
    const h = hashDoCodigo(c)
    assert.match(h, /^[0-9a-f]{64}$/)
    assert.ok(!h.includes(normalizarCodigo(c)))
  })

  test('o prefixo identifica sem revelar', () => {
    assert.equal(prefixoDoCodigo('AB7F-K93X'), 'AB7F')
    assert.equal(prefixoDoCodigo('ab7fk93x'), 'AB7F')
  })
})

describe('segredo do terminal', () => {
  test('256 bits, em hexadecimal', () => {
    const s = gerarSegredoTerminal()
    assert.match(s, /^[0-9a-f]{64}$/)
  })

  test('não repete', () => {
    const vistos = new Set<string>()
    for (let i = 0; i < 200; i++) vistos.add(gerarSegredoTerminal())
    assert.equal(vistos.size, 200)
  })

  test('o servidor guarda o hash, não o segredo', () => {
    const s = gerarSegredoTerminal()
    const h = hashDoSegredo(s)
    assert.notEqual(h, s)
    assert.equal(h, hashDoSegredo(s), 'mesmo segredo, mesmo hash')
  })

  test('segredo mal formado é recusado', () => {
    assert.equal(segredoBemFormado(gerarSegredoTerminal()), true)
    assert.equal(segredoBemFormado(hashDoSegredo('x')), true)
    for (const ruim of ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), 123, null, undefined, {}]) {
      assert.equal(segredoBemFormado(ruim), false, `aceitou ${JSON.stringify(ruim)}`)
    }
  })

  test('O QUE VAI NO FIO NÃO É O QUE FICA NO BANCO', () => {
    // O terminal manda o segredo em claro (dentro do TLS) e o servidor grava
    // o hash. Se fossem o mesmo valor, ler a linha no banco bastaria para se
    // fazer passar pelo terminal — a mesma falha do `senha_hash` legado, que
    // é credencial e cópia guardada ao mesmo tempo.
    const segredo = gerarSegredoTerminal()
    const guardado = hashDoSegredo(segredo)
    assert.notEqual(guardado, segredo)
    assert.equal(hashesIguais(guardado, hashDoSegredo(segredo)), true, 'o servidor reconhece quem tem o segredo')
    assert.equal(hashesIguais(guardado, segredo), false, 'quem só tem o hash não autentica')
  })

  test('comparação de hashes: igual passa, diferente não', () => {
    const a = hashDoSegredo('um')
    assert.equal(hashesIguais(a, a), true)
    assert.equal(hashesIguais(a, hashDoSegredo('outro')), false)
    // Vazio nunca casa — senão um campo nulo no banco autenticaria qualquer um.
    assert.equal(hashesIguais('', ''), false)
  })
})
